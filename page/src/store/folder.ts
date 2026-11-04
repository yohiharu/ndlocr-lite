/* ==================================================
   フォルダの選択・読み込みと、リセット
================================================== */

import { isImageName } from "../lib/extensions";
import { loadDirectoryResult, RESULT_FILE_NAME, scanDirectory, type FolderScan, type ScannedDirectory, type ScannedPage } from "../lib/folder";
import { DEFAULT_PAGE_KIND } from "../lib/kinds";
import type { BatchDirectory, BatchPage } from "../lib/types";
import { stopClassify } from "./classify";
import { saveDirectoriesOf } from "./results";
import {
    currentPage,
    errorMessage,
    get,
    isAbortError,
    isOCRBusy,
    rejectWhileFolderLoading,
    SEARCH_INFO_INITIAL,
    set,
    showError,
    updatePages
} from "./state";
import { normalizePageKind } from "./settings";
import { showPage } from "./viewer";


/* ページ・ディレクトリの id（読み込みをまたいで重ならないように数え続ける） */

let nextPageId = 1;

let nextDirectoryId = 1;


export async function selectFolder(): Promise<void> {

    /* 読み込みの途中では選び直さない（ボタンも押せない） */

    if (get().folderLoading) {

        return;
    }


    if (isOCRBusy()) {

        showError(
            "OCRの完了後にフォルダを選択してください"
        );

        return;
    }


    /* 種別判定は、開いていたフォルダのものなので止める */

    stopClassify();


    /*
     * 結果をフォルダの中に書くため、書き込みできるフォルダ選択を使う。
     * 対応していないブラウザでは、結果を書けないので選択もしない
     */

    if (typeof window.showDirectoryPicker !== "function") {

        showError(
            "このブラウザではフォルダに結果を書けません。Chrome か Edge で http://127.0.0.1:5000 を開いてください"
        );

        return;
    }


    let rootHandle: FileSystemDirectoryHandle;

    try {

        rootHandle =
            await window.showDirectoryPicker({
                mode: "readwrite"
            });

    } catch (error) {

        /* 選択をキャンセルした場合はエラーにしない */

        if (!isAbortError(error)) {

            showError(errorMessage(error));

        }

        return;

    }


    /*
     * 読み込みが終わるまで、今の一覧のページを変える操作と、フォルダの選択を止める。
     * 止めないと、読み込みの途中で始めたOCRや種別の変更が、入れ替わる前の一覧に対して動く
     */

    set({ folderLoading: true });

    try {

        await loadFolder(rootHandle);

    } finally {

        set({ folderLoading: false });

    }

}


/* ==================================================
   前回の結果（ocr.json）を使うかの確認
================================================== */

let resolveReuse: ((choice: string) => void) | null = null;


/*
 * 前回の結果があることを伝え、使うか・やり直すか・キャンセルかを選んでもらう。
 * 戻り値は "reuse" / "redo" / "cancel"（Esc で閉じた場合は "cancel" か空）
 */

function askReuseChoice(count: number): Promise<string> {

    return new Promise(resolve => {

        resolveReuse = resolve;

        set(current => ({
            reuseMessage: `${count} 件のフォルダに、前回のOCR結果と種別（${RESULT_FILE_NAME}）があります。`,
            reuseRequest: current.reuseRequest + 1,
            reuseOpen: true
        }));

    });

}


/* 確認が閉じたとき（ReuseDialog から呼ぶ） */

export function reuseDialogClosed(choice: string): void {

    set({ reuseOpen: false });

    const resolve =
        resolveReuse;

    resolveReuse = null;

    resolve?.(choice);

}


/* ==================================================
   フォルダの読み込み
================================================== */

/* 読み込んだフォルダを、一覧のページ・ディレクトリにする */

function toBatchList(scan: FolderScan): { pages: BatchPage[]; directories: BatchDirectory[] } {

    const directoryIds = new Map<ScannedDirectory, number>(
        scan.directories.map(directory => [directory, nextDirectoryId++])
    );

    const pageIds = new Map<ScannedPage, number>(
        scan.pages.map(page => [page, nextPageId++])
    );

    const pages =
        scan.pages.map((page): BatchPage => ({
            id: pageIds.get(page)!,
            file: page.file,
            name: page.name,
            dirId: directoryIds.get(page.directory)!,
            dirPath: page.directory.path,
            status: page.status,
            error: page.error,
            xml: page.xml,
            json: page.json,
            searchData: page.searchData,
            kind: page.kind
        }));

    const directories =
        scan.directories.map((directory): BatchDirectory => ({
            id: directoryIds.get(directory)!,
            path: directory.path,
            handle: directory.handle,
            pageIds: directory.pages.map(page => pageIds.get(page)!),
            otherSavedPages: directory.otherSavedPages,
            saved: directory.saved
        }));

    return { pages, directories };

}


/* 選んだフォルダを読み込み、一覧を入れ替える（前回の結果があれば、使うかを選んでもらう） */

async function loadFolder(rootHandle: FileSystemDirectoryHandle): Promise<void> {

    const scan: FolderScan = {
        pages: [],
        directories: []
    };

    try {

        await scanDirectory(
            rootHandle,
            rootHandle.name,
            scan,
            name => isImageName(name, get().imageExtensions)
        );

    } catch (error) {

        showError(
            `フォルダを読み込めません: ${errorMessage(error)}`
        );

        return;

    }


    if (scan.pages.length === 0) {

        showError(
            "フォルダに画像ファイルがありません"
        );

        return;
    }


    /* 前回の結果（ocr.json）があるフォルダは、使うかやり直すかを選んでもらう */

    const withResult = scan.directories.filter(directory =>
        directory.resultHandle
    );

    if (withResult.length > 0) {

        const choice =
            await askReuseChoice(withResult.length);

        if (choice !== "reuse" && choice !== "redo") {

            return;

        }

        /* 種別は「やり直す」でも残す。結果を読み込むのは「既存の結果を使う」のときだけ */

        for (const directory of withResult) {

            try {

                await loadDirectoryResult(
                    directory,
                    choice === "reuse",
                    normalizePageKind
                );

            } catch (error) {

                showError(
                    `${directory.path} の結果・種別を読めませんでした: ${errorMessage(error)}`
                );

            }

        }

    }


    const { pages, directories } =
        toBatchList(scan);

    set({
        batchPages: pages,
        batchDirectories: directories,
        pageIndexById: new Map(pages.map((page, index) => [page.id, index])),
        directoryIndexById: new Map(directories.map((directory, index) => [directory.id, index])),
        currentPageIndex: -1,
        collapsedFolders: new Set(),
        searchHits: [],
        searchInfo: SEARCH_INFO_INITIAL
    });

}


/* ==================================================
   リセット。対象のページの ocr.json も書き直す
================================================== */

/* 対象のページの種別を種別なしに戻す（対象は、全体または1つのフォルダの中のページ） */

export async function resetKinds(pageIds: readonly number[], message: string): Promise<void> {

    if (rejectWhileFolderLoading()) {

        return;
    }


    if (isOCRBusy()) {

        showError(
            "OCRの完了後にリセットしてください"
        );

        return;
    }


    if (!window.confirm(message)) {

        return;
    }


    /* 判定中は、種別を書き換えるので止める */

    stopClassify();

    updatePages(pageIds, { kind: DEFAULT_PAGE_KIND });

    await saveDirectoriesOf(pageIds);

}


/* 対象のページのOCR結果を消す（種別は残す）。対象は、全体または1つのフォルダの中のページ */

export async function resetOCRResults(pageIds: readonly number[], message: string): Promise<void> {

    if (rejectWhileFolderLoading()) {

        return;
    }


    if (isOCRBusy()) {

        showError(
            "OCRの完了後にリセットしてください"
        );

        return;
    }


    if (!window.confirm(message)) {

        return;
    }


    updatePages(pageIds, {
        status: "pending",
        error: "",
        xml: "",
        json: null,
        searchData: null
    });


    /* 検索結果は、消したOCR結果を指しているので空にする */

    set({
        searchHits: [],
        searchInfo: SEARCH_INFO_INITIAL
    });

    /* 表示中のページは、結果のない表示に変える */

    const current =
        currentPage();

    if (current && pageIds.includes(current.id)) {

        showPage(get().currentPageIndex);

    }

    await saveDirectoriesOf(pageIds);

}


/* 一覧全体を対象にする操作（ボタン） */

export function allPageIds(): number[] {

    return get().batchPages.map(batchPage => batchPage.id);

}
