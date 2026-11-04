import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleClassifyKey, startClassify } from "./classify";
import { allPageIds, reuseDialogClosed, selectFolder } from "./folder";
import { changePageKind, requestStop, runBatchOCR, runPageOCR } from "./ocr";
import { waitForSaves } from "./results";
import { get, resetState, set } from "./state";


/* ---------- メモリ上のフォルダ（File System Access API の代わり） ---------- */

type Tree = { [name: string]: string | Tree };

interface MemFile {
    kind: "file";
    name: string;
    content: string;
    getFile(): Promise<File>;
    createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

interface MemDirectory {
    kind: "directory";
    name: string;
    entries: Map<string, MemFile | MemDirectory>;
    values(): AsyncGenerator<MemFile | MemDirectory>;
    getFileHandle(name: string, options?: { create?: boolean }): Promise<MemFile>;
}

function memFile(name: string, content: string): MemFile {

    return {
        kind: "file",
        name,
        content,
        async getFile() {
            return new File([this.content], name);
        },
        async createWritable() {
            let buffer = "";
            return {
                write: async (data: string) => {
                    buffer += data;
                },
                close: async () => {
                    this.content = buffer;
                }
            };
        }
    };

}

function memDirectory(name: string, tree: Tree): MemDirectory {

    const entries = new Map<string, MemFile | MemDirectory>(
        Object.entries(tree).map(([entryName, value]) => [
            entryName,
            typeof value === "string" ? memFile(entryName, value) : memDirectory(entryName, value)
        ])
    );

    return {
        kind: "directory",
        name,
        entries,
        async *values() {
            yield* entries.values();
        },
        async getFileHandle(fileName, options) {
            let handle = entries.get(fileName);
            if (!handle) {
                if (!options?.create) {
                    throw new DOMException("not found", "NotFoundError");
                }
                handle = memFile(fileName, "");
                entries.set(fileName, handle);
            }
            return handle as MemFile;
        }
    };

}

function readResult(directory: MemDirectory): { pages: Record<string, unknown>[] } {

    return JSON.parse((directory.entries.get("ocr.json") as MemFile).content);

}


/* ---------- OCR サーバーの代わり ---------- */

function xmlOf(name: string): string {

    return `<OCRDATASET><PAGE WIDTH="100" HEIGHT="200"><LINE X="1" Y="2" WIDTH="10" HEIGHT="100" ORDER="1" STRING="本文${name}"/></PAGE></OCRDATASET>`;

}

interface BatchCall {
    names: string[];
    job: string;
    signal: AbortSignal | null | undefined;
}

const calls: BatchCall[] = [];

const cancelled: string[] = [];

/* 応答を決める（既定は全件成功）。null を返すと、中断されるまで応答しない */

let respond: (call: BatchCall, index: number) => unknown = call => ({
    results: call.names.map((name, index) => ({ index, xml: xmlOf(name), json: { contents: [], imginfo: { img_name: name } } }))
});

function installFetch(): void {

    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {

        const form = init.body as FormData;

        if (url === "api/ocr/cancel") {

            cancelled.push(String(form.get("job")));

            return new Response(null, { status: 204 });
        }

        const call: BatchCall = {
            names: form.getAll("images").map(file => (file as File).name),
            job: String(form.get("job")),
            signal: init.signal
        };

        calls.push(call);

        const body = respond(call, calls.length - 1);

        if (body === null) {

            return new Promise<Response>((_, reject) => {

                init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));

            });
        }

        return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

    }));

}


async function loadFolder(root: MemDirectory, choice?: string): Promise<void> {

    window.showDirectoryPicker = async () => root as unknown as FileSystemDirectoryHandle;

    const loading = selectFolder();

    if (choice) {

        await vi.waitFor(() => expect(get().reuseOpen).toBe(true));

        reuseDialogClosed(choice);

    }

    await loading;

}


const statuses = () =>
    get().batchPages.map(page => `${page.name}:${page.status}${page.error ? `(${page.error})` : ""}`);


beforeEach(() => {

    resetState();
    localStorage.clear();
    calls.length = 0;
    cancelled.length = 0;
    respond = call => ({
        results: call.names.map((name, index) => ({ index, xml: xmlOf(name), json: { contents: [], imginfo: { img_name: name } } }))
    });
    installFetch();

});

afterEach(async () => {

    await waitForSaves();
    vi.unstubAllGlobals();

});


describe("フォルダの読み込み", () => {

    it("一覧を作り、前回の結果があれば使うかを聞く", async () => {

        const root = memDirectory("book", {
            "2.jpg": "", "10.jpg": "", "memo.txt": "",
            sub: {
                "1.jpg": "",
                "ocr.json": JSON.stringify({ pages: [{ name: "1.jpg", kind: "classic", xml: xmlOf("1.jpg"), contents: [], imginfo: {} }] })
            }
        });

        await loadFolder(root, "reuse");

        expect(statuses()).toEqual(["book/sub/1.jpg:done", "book/2.jpg:pending", "book/10.jpg:pending"]);
        expect(get().batchPages[0].kind).toBe("古典籍");
        expect(get().pageKinds).toEqual(["古典籍"]);
        expect(get().batchDirectories.map(directory => directory.saved)).toEqual([true, false]);
        expect(get().folderLoading).toBe(false);

    });

    it("キャンセルしたら一覧を変えない", async () => {

        await loadFolder(memDirectory("a", { "1.jpg": "" }));

        await loadFolder(memDirectory("b", { "1.jpg": "", "ocr.json": "{\"pages\":[]}" }), "cancel");

        expect(statuses()).toEqual(["a/1.jpg:pending"]);

    });

});


describe("一括OCR", () => {

    it("10枚ずつ送り、失敗・結果なしを分け、フォルダごとに ocr.json を書く", async () => {

        const files = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`${i + 1}.jpg`, ""]));
        const root = memDirectory("book", { ...files, sub: { "a.jpg": "" } });

        await loadFolder(root);

        respond = (call, index) => ({
            results: call.names.flatMap((name, i): Record<string, unknown>[] => {
                if (index === 0 && i === 1) return [{ index: i, error: "画像を読み込めません" }];
                if (index === 1 && i === 2) return [];
                return [{ index: i, xml: xmlOf(name), json: { contents: [], imginfo: {} } }];
            })
        });

        await runBatchOCR(allPageIds());

        expect(calls.map(call => call.names.length)).toEqual([10, 3]);
        expect(statuses().filter(status => !status.endsWith(":done"))).toEqual([
            "book/1.jpg:error(画像を読み込めません)",
            "book/12.jpg:error(OCR結果がありません)"
        ]);
        expect(get().batchRunning).toBe(false);
        expect(get().batchDirectories.every(directory => directory.saved)).toBe(true);

        const result = readResult(root);

        expect(result.pages.map(page => page.name)).toEqual(Array.from({ length: 12 }, (_, i) => `${i + 1}.jpg`));
        /* 1回目の送信は sub/a.jpg・1.jpg・2.jpg… の順なので、2番目の 1.jpg が失敗 */
        expect(result.pages[0]).toEqual({ name: "1.jpg", kind: "unclassified", error: "画像を読み込めません" });
        expect(result.pages[1]).toMatchObject({ name: "2.jpg", kind: "unclassified", xml: xmlOf("2.jpg"), contents: [] });
        expect(result.pages[11]).toEqual({ name: "12.jpg", kind: "unclassified", error: "OCR結果がありません" });
        expect(readResult(root.entries.get("sub") as MemDirectory).pages).toHaveLength(1);

    });

    it("停止すると送信を中断してサーバーにも伝え、送っていないページは元に戻す", async () => {

        const files = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`${i + 1}.jpg`, ""]));
        const root = memDirectory("book", files);

        await loadFolder(root);

        respond = () => null;

        const running = runBatchOCR(allPageIds());

        await vi.waitFor(() => expect(calls).toHaveLength(1));

        expect(get().batchPages.map(page => page.status).filter(status => status === "queued")).toHaveLength(2);

        requestStop();

        await running;

        expect(cancelled).toEqual([calls[0].job]);
        expect(calls[0].signal?.aborted).toBe(true);
        expect(get().batchPages.every(page => page.status === "pending")).toBe(true);
        expect(root.entries.has("ocr.json")).toBe(false);

    });

    it("送信できないときは、そのページを失敗にしてエラーを出す", async () => {

        await loadFolder(memDirectory("book", { "1.jpg": "" }));

        vi.stubGlobal("fetch", vi.fn(async () => {
            throw new TypeError("Failed to fetch");
        }));

        await runBatchOCR(allPageIds());

        expect(statuses()).toEqual(["book/1.jpg:error(OCRサーバーに接続できません。page/server.py を起動し、http://127.0.0.1:5000 から開いてください)"]);
        expect(get().errorVisible).toBe(true);

    });

});


describe("1ページのOCR", () => {

    it("再OCRが失敗したら、前の結果を残す", async () => {

        const root = memDirectory("book", { "1.jpg": "" });

        await loadFolder(root);

        const id = get().batchPages[0].id;

        await runPageOCR(id);

        expect(statuses()).toEqual(["book/1.jpg:done"]);

        respond = () => ({ results: [{ index: 0, error: "OCR処理に失敗しました" }] });

        await runPageOCR(id);

        expect(statuses()).toEqual(["book/1.jpg:done"]);
        expect(get().batchPages[0].xml).toBe(xmlOf("1.jpg"));
        expect(get().errorMessage).toBe("再OCRに失敗しました（前の結果を残します）: OCR処理に失敗しました");
        expect(readResult(root).pages[0]).toMatchObject({ xml: xmlOf("1.jpg") });

    });

    it("OCR中は、ほかのOCRを始めない", async () => {

        await loadFolder(memDirectory("book", { "1.jpg": "", "2.jpg": "" }));

        respond = () => null;

        const running = runPageOCR(get().batchPages[0].id);

        await vi.waitFor(() => expect(calls).toHaveLength(1));

        await runBatchOCR(allPageIds());

        expect(get().errorMessage).toBe("実行中のOCRの完了後に、もう一度実行してください");

        requestStop();

        await running;

        expect(statuses()).toEqual(["book/1.jpg:pending", "book/2.jpg:pending"]);

    });

});


describe("種別", () => {

    it("続けて変えても、ocr.json には最後の種別が残る", async () => {

        const root = memDirectory("book", { "1.jpg": "", "2.jpg": "" });

        await loadFolder(root);

        set({ pageKinds: ["挿絵", "図版"] });

        const [first, second] = get().batchPages.map(page => page.id);

        void changePageKind(first, "挿絵");
        void changePageKind(second, "図版");
        void changePageKind(first, "図版");

        await waitForSaves();

        expect(readResult(root).pages.map(page => page.kind)).toEqual(["図版", "図版"]);

    });

    it("種別判定は、数字キーで種別を付けて次へ進み、→で飛ばし、Esc で止める", async () => {

        const root = memDirectory("book", { "1.jpg": "", "2.jpg": "", "3.jpg": "" });

        await loadFolder(root);

        set({ pageKinds: ["挿絵", "図版"] });

        startClassify(allPageIds());

        const key = (name: string, options: KeyboardEventInit = {}) => {
            const event = new KeyboardEvent("keydown", { key: name, cancelable: true, ...options });
            handleClassifyKey(event);
            return event.defaultPrevented;
        };

        expect(get().currentPageIndex).toBe(0);
        expect(key("2")).toBe(true);
        expect(get().currentPageIndex).toBe(1);
        expect(key("1", { ctrlKey: true })).toBe(false);
        expect(key("ArrowRight")).toBe(true);
        expect(get().currentPageIndex).toBe(2);
        expect(key("Escape")).toBe(true);
        expect(get().classifyRunning).toBe(false);
        expect(key("1")).toBe(false);

        await waitForSaves();

        expect(get().batchPages.map(page => page.kind)).toEqual(["図版", "unclassified", "unclassified"]);
        expect(readResult(root).pages[0].kind).toBe("図版");

    });

});
