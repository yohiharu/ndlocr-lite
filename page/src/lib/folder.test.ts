import { describe, expect, it } from "vitest";
import { buildDirectoryResult, loadDirectoryResult, scanDirectory, type FolderScan, type ScannedDirectory } from "./folder";
import { ancestorFolderKeys, buildPageTree, countFolderPages, pagesUnder } from "./pageTree";
import type { BatchPage } from "./types";


/* File System Access API のハンドルの代わり（読むだけ） */

type Tree = { [name: string]: string | Tree };

function fakeDirectory(name: string, tree: Tree): FileSystemDirectoryHandle {

    const entries = Object.entries(tree).map(([entryName, value]) =>
        typeof value === "string"
            ? { kind: "file", name: entryName, getFile: async () => new File([value], entryName) }
            : fakeDirectory(entryName, value)
    );

    return {
        kind: "directory",
        name,
        async *values() {
            yield* entries;
        }
    } as unknown as FileSystemDirectoryHandle;

}


describe("scanDirectory", () => {

    it("配下のフォルダ → フォルダ内の画像の順に、名前の自然順で並べ、隠しファイルと ocr.json を分ける", async () => {

        const scan: FolderScan = { pages: [], directories: [] };

        await scanDirectory(
            fakeDirectory("book", {
                "10.jpg": "", "2.jpg": "", ".hidden.jpg": "", "memo.txt": "", "ocr.json": "{}",
                b: { "1.jpg": "" },
                a10: { "1.jpg": "" },
                a2: { "x.JPG": "", "ocr.json": { "1.jpg": "" } },
                empty: {},
                ".git": { "1.jpg": "" }
            }),
            "book",
            scan,
            name => /\.jpg$/i.test(name)
        );

        expect(scan.pages.map(page => page.name)).toEqual([
            "book/a2/ocr.json/1.jpg",
            "book/a2/x.JPG",
            "book/a10/1.jpg",
            "book/b/1.jpg",
            "book/2.jpg",
            "book/10.jpg"
        ]);
        expect(scan.directories.map(directory => [directory.path, directory.resultHandle !== null])).toEqual([
            ["book/a2/ocr.json", false],
            ["book/a2", false],
            ["book/a10", false],
            ["book/b", false],
            ["book", true]
        ]);

    });

});


function scannedDirectory(names: string[], result: unknown): ScannedDirectory {

    const directory: ScannedDirectory = {
        path: "d",
        handle: {} as FileSystemDirectoryHandle,
        resultHandle: { getFile: async () => new File([JSON.stringify(result)], "ocr.json") } as unknown as FileSystemFileHandle,
        pages: [],
        otherSavedPages: [],
        saved: false
    };

    directory.pages = names.map(name => ({
        file: new File([""], name),
        name: `d/${name}`,
        directory,
        status: "pending",
        error: "",
        xml: "",
        json: null,
        searchData: null,
        kind: "unclassified"
    }));

    return directory;

}


describe("loadDirectoryResult", () => {

    const xml = "<A><PAGE WIDTH=\"1\" HEIGHT=\"1\"><LINE STRING=\"保存\"/></PAGE></A>";

    const saved = {
        pages: [
            { name: "1.jpg", kind: "classic", xml, contents: [1], imginfo: { orientation: 6 } },
            { name: "2.jpg", kind: "挿絵", error: "失敗" },
            { name: "gone.jpg", kind: "x", xml },
            { kind: "名前なし" },
            "garbage"
        ]
    };

    it("既存の結果を使うときは、結果と種別を戻し、一覧にないページの記録は残す", async () => {

        const directory = scannedDirectory(["1.jpg", "2.jpg"], saved);

        await loadDirectoryResult(directory, true, kind => `kind:${String(kind)}`);

        expect(directory.pages.map(page => [page.status, page.kind, page.xml !== ""])).toEqual([
            ["done", "kind:classic", true],
            ["pending", "kind:挿絵", false]
        ]);
        expect(directory.pages[0].json).toEqual({ contents: [1], imginfo: { orientation: 6 } });
        expect(directory.pages[0].searchData?.key).toBe("保存");
        expect(directory.otherSavedPages).toEqual([{ name: "gone.jpg", kind: "x", xml }]);
        expect(directory.saved).toBe(false);

    });

    it("やり直すときは種別だけを戻す", async () => {

        const directory = scannedDirectory(["1.jpg"], saved);

        await loadDirectoryResult(directory, false, kind => String(kind));

        expect(directory.pages[0]).toMatchObject({ status: "pending", kind: "classic", xml: "" });

    });

    it("すべて読み込めたら、書き直さない（saved）", async () => {

        const directory = scannedDirectory(["1.jpg"], saved);

        await loadDirectoryResult(directory, true, kind => String(kind));

        expect(directory.saved).toBe(true);

    });

    it("ページの一覧がない ocr.json はエラー", async () => {

        await expect(loadDirectoryResult(scannedDirectory(["1.jpg"], { results: [] }), true, String)).rejects.toThrow();
        await expect(loadDirectoryResult(scannedDirectory(["1.jpg"], null), true, String)).rejects.toThrow();

    });

});


describe("buildDirectoryResult", () => {

    it("結果があるページは xml と JSON、ないページはエラーを書き、一覧にないページの記録を最後に残す", () => {

        const result = buildDirectoryResult(
            [
                { file: new File([""], "1.jpg"), kind: "挿絵", xml: "<x/>", json: { contents: [], imginfo: { orientation: 1 } }, error: "" },
                { file: new File([""], "2.jpg"), kind: "unclassified", xml: "", json: null, error: "失敗" }
            ],
            [{ name: "old.jpg" }]
        );

        expect(JSON.stringify(result)).toBe(JSON.stringify({
            pages: [
                { name: "1.jpg", kind: "挿絵", xml: "<x/>", contents: [], imginfo: { orientation: 1 } },
                { name: "2.jpg", kind: "unclassified", error: "失敗" },
                { name: "old.jpg" }
            ]
        }));

    });

});


describe("ページの階層", () => {

    const page = (id: number, dirPath: string, status: BatchPage["status"], kind = "unclassified") =>
        ({ id, dirPath, status, kind } as BatchPage);

    const pages = [
        page(1, "book/a/x", "done"),
        page(2, "book/a", "pending", "挿絵"),
        page(3, "book/b", "error"),
        page(4, "book", "done")
    ];

    it("見つかった順にフォルダを作り、配下のページを数える", () => {

        const root = buildPageTree(pages);
        const book = root.folders.get("book")!;

        expect([...book.folders.keys()]).toEqual(["a", "b"]);
        expect(book.folders.get("a")!.folders.get("x")!.key).toBe("book/a/x");
        expect(pagesUnder(book).map(p => p.id)).toEqual([1, 2, 3, 4]);
        expect(countFolderPages(book)).toEqual({ total: 4, done: 2, pending: 1, unclassified: 3 });
        expect(countFolderPages(book.folders.get("a")!)).toEqual({ total: 2, done: 1, pending: 1, unclassified: 1 });

    });

    it("上位のフォルダのパス", () => {

        expect(ancestorFolderKeys("book/a/x")).toEqual(["book", "book/a", "book/a/x"]);

    });

});
