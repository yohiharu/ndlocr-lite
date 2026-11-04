/* ==================================================
   フォルダの読み込みと、結果（ocr.json）の読み書き
================================================== */

import { DEFAULT_PAGE_KIND } from "./kinds";
import { buildSearchData } from "./search";
import type { PageJson, PageStatus, SearchData } from "./types";

/* 結果は、画像があるディレクトリの直下にこの名前で書く */

export const RESULT_FILE_NAME = "ocr.json";


/*
 * 読み込み中のフォルダの中身。一覧に入れるまでは、ここで組み立てる（前回の結果もここに読む）。
 * resultHandle は前回の ocr.json（なければ null）、saved は ocr.json の内容が最新かどうか
 */

export interface ScannedPage {
    file: File;
    name: string;
    directory: ScannedDirectory;
    status: PageStatus;
    error: string;
    xml: string;
    json: PageJson | null;
    searchData: SearchData | null;
    kind: string;
}

export interface ScannedDirectory {
    path: string;
    handle: FileSystemDirectoryHandle;
    resultHandle: FileSystemFileHandle | null;
    pages: ScannedPage[];
    otherSavedPages: unknown[];
    saved: boolean;
}

export interface FolderScan {
    pages: ScannedPage[];
    directories: ScannedDirectory[];
}


/*
 * ファイル名の数字は自然順（2 < 10）に並べる
 */

export function compareNames(a: { name: string }, b: { name: string }): number {

    return a.name.localeCompare(
        b.name,
        undefined,
        { numeric: true }
    );

}


/*
 * ディレクトリ内の画像と、配下のディレクトリを再帰的に読む。
 * 画像のあるディレクトリは scan.directories に入れる（そのディレクトリ直下に結果を書くため）。
 * ページは一覧の表示と同じ順（配下のフォルダ → フォルダ内の画像）に並べる。
 * 一括OCR・種別判定・検索の結果はこの順に進む
 */

export async function scanDirectory(
    dirHandle: FileSystemDirectoryHandle,
    path: string,
    scan: FolderScan,
    isImageName: (name: string) => boolean
): Promise<void> {

    const fileHandles: FileSystemFileHandle[] = [];

    const subdirHandles: FileSystemDirectoryHandle[] = [];

    let resultHandle: FileSystemFileHandle | null = null;

    for await (const entry of dirHandle.values()) {

        /* 隠しファイル・隠しフォルダ（.DS_Store など）は対象にしない */

        if (entry.name.startsWith(".")) {

            continue;

        }

        if (entry.kind === "directory") {

            subdirHandles.push(entry as FileSystemDirectoryHandle);

        } else if (entry.name === RESULT_FILE_NAME) {

            resultHandle = entry as FileSystemFileHandle;

        } else if (isImageName(entry.name)) {

            fileHandles.push(entry as FileSystemFileHandle);

        }

    }


    fileHandles.sort(compareNames);

    subdirHandles.sort(compareNames);


    for (const subdirHandle of subdirHandles) {

        await scanDirectory(
            subdirHandle,
            `${path}/${subdirHandle.name}`,
            scan,
            isImageName
        );

    }


    if (fileHandles.length > 0) {

        const directory: ScannedDirectory = {
            path,
            handle: dirHandle,
            resultHandle,
            pages: [],
            otherSavedPages: [],
            saved: false
        };

        for (const fileHandle of fileHandles) {

            const page: ScannedPage = {
                file: await fileHandle.getFile(),
                name: `${path}/${fileHandle.name}`,
                directory,
                status: "pending",
                error: "",
                xml: "",
                json: null,
                searchData: null,
                kind: DEFAULT_PAGE_KIND
            };

            directory.pages.push(page);

            scan.pages.push(page);

        }

        scan.directories.push(directory);

    }

}


function isRecord(value: unknown): value is Record<string, unknown> {

    return typeof value === "object" && value !== null;

}


/*
 * 既存の ocr.json を読み、種別を戻す。
 * withOCR のときは、結果のあるページも OCR せずに済むように結果を戻す。
 * 結果がないページ（失敗したものを含む）は未処理のままにし、実行時に OCR する。
 * resolveKind は、ocr.json の種別を使う種別にする（未登録の種別はそこで登録する）
 */

export async function loadDirectoryResult(
    directory: ScannedDirectory,
    withOCR: boolean,
    resolveKind: (kind: unknown) => string
): Promise<void> {

    if (!directory.resultHandle) {

        return;
    }

    const file =
        await directory.resultHandle.getFile();

    const result: unknown =
        JSON.parse(await file.text());

    const savedList =
        isRecord(result) ? result.pages : undefined;

    if (!Array.isArray(savedList)) {

        throw new Error(`${RESULT_FILE_NAME} にページの一覧がありません`);

    }

    /* 名前のないページの記録は、どのページのものか分からないので使わない */

    const validPages =
        savedList.filter((savedPage): savedPage is Record<string, unknown> & { name: string } =>
            isRecord(savedPage)
            && typeof savedPage.name === "string"
        );

    const savedPages = new Map(
        validPages.map(savedPage => [savedPage.name, savedPage])
    );


    /* 一覧にないページの記録は、ocr.json を書き直すときに消さないよう、そのまま持っておく */

    const listedNames = new Set(
        directory.pages.map(page => page.file.name)
    );

    directory.otherSavedPages =
        validPages.filter(savedPage =>
            !listedNames.has(savedPage.name)
        );

    directory.pages.forEach(page => {

        const savedPage =
            savedPages.get(page.file.name);

        if (!savedPage) {

            return;

        }

        page.kind =
            resolveKind(savedPage.kind);

        /* xml のない結果（旧版で書いたもの）は表示できないので読み込まない */

        if (!withOCR || savedPage.error || typeof savedPage.xml !== "string" || !savedPage.xml) {

            return;

        }

        page.xml = savedPage.xml;
        page.json = {
            contents: savedPage.contents,
            imginfo: savedPage.imginfo
        };
        page.searchData = buildSearchData(savedPage.xml);
        page.status = "done";

    });


    /* すべてのページが読み込めたら、ocr.json はそのままで書き直さない */

    directory.saved =
        directory.pages.every(page =>
            page.status === "done"
        );

}


/*
 * ディレクトリの直下に書く結果。
 * ページごとに種別と、OCR結果（表示用の xml と、src/ocr.py の JSON と同じ contents / imginfo）か、
 * エラーを入れる。xml は「既存の結果を使う」で表示と検索に使う。
 * 結果は、持っていれば書く（再OCR中のページは、前の結果を書く）。
 * 前回の ocr.json にあって一覧にないページ（対象の拡張子から外した・名前を変えたなど）は、そのまま残す
 */

export function buildDirectoryResult(
    pages: readonly { file: File; kind: string; xml: string; json: PageJson | null; error: string }[],
    otherSavedPages: readonly unknown[]
): { pages: unknown[] } {

    return {
        pages: [
            ...pages.map(page =>
                page.xml
                    ? { name: page.file.name, kind: page.kind, xml: page.xml, ...page.json }
                    : { name: page.file.name, kind: page.kind, error: page.error }
            ),
            ...otherSavedPages
        ]
    };

}


export async function writeDirectoryResult(handle: FileSystemDirectoryHandle, result: unknown): Promise<void> {

    const fileHandle =
        await handle.getFileHandle(
            RESULT_FILE_NAME,
            { create: true }
        );

    const writable =
        await fileHandle.createWritable();

    await writable.write(
        JSON.stringify(result, null, 2)
    );

    await writable.close();

}
