/* ==================================================
   画面の状態。1つのストアに持ち、操作（actions）はここを読み書きする。
   非同期の処理（一括OCR・保存など）は、await のあとに get() で最新の状態を読み直す
================================================== */

import { useSyncExternalStore } from "react";
import { loadImageExtensions } from "../lib/extensions";
import { loadCustomPageKinds } from "../lib/kinds";
import { DEFAULT_PAGE_HEIGHT, DEFAULT_PAGE_WIDTH, type OcrLine } from "../lib/ocrXml";
import type { BatchDirectory, BatchPage, SearchHit } from "../lib/types";


export type TabId = "pagesTab" | "searchTab";


/* 検索結果の1件。label（ページのパスと種別）は検索したときのもの */

export interface DisplayedHit extends SearchHit {
    label: string;
}


export interface AppState {

    /* ---------- 表示 ---------- */

    pageWidth: number;
    pageHeight: number;
    /* 今の表示が XML の PAGE の大きさを使っているか。使っていなければ画像の大きさで表示する */
    pageSizeFromXML: boolean;
    /*
     * 表示中のOCR結果で、サーバーが画像に反映した回転（EXIF Orientation の 1〜8）。
     * 分からないとき（OCR結果がない・前の版の結果）は null で、ブラウザに任せて表示する
     */
    imageOrientation: unknown;
    zoomPercent: number;
    opacityPercent: number;
    /* 全体表示の要求。増えたら、表示領域の大きさを測って倍率を合わせる */
    fitRequest: number;
    /* 開いている画像 */
    imageFile: File | null;
    /* imageFile の URL（次の画像を開くときに解放する） */
    imageURL: string | null;
    /* 画像の要素に出している URL。null のときは何も出さない */
    imageSrc: string | null;
    imageVisible: boolean;
    /* 画像を読み込めた（画像表示・全体表示を押せる） */
    imageReady: boolean;
    ocrLines: readonly OcrLine[];
    /* 強調している行（OCRの行の data-index） */
    selectedLines: ReadonlySet<number>;
    detailsVisible: boolean;
    detailsText: string;
    /* 検索で見つけた行へのスクロールの要求 */
    scrollRequest: { lineIndex: number; nonce: number } | null;
    /* 一覧にない画像（単一画像）のOCRが動いている */
    singleOCRRunning: boolean;
    dropVisible: boolean;
    errorMessage: string;
    errorVisible: boolean;

    /* ---------- 左のパネル ---------- */

    activeTab: TabId;
    settingsOpen: boolean;
    /* 種別の入力欄にフォーカスする要求 */
    kindInputFocusRequest: number;
    imageExtensions: readonly string[];
    /* 登録した種別（登録した順） */
    pageKinds: readonly string[];
    /* 検索で外している種別（それ以外の種別は検索する） */
    uncheckedSearchKinds: ReadonlySet<string>;

    /* ---------- フォルダ一括OCR ---------- */

    batchPages: readonly BatchPage[];
    batchDirectories: readonly BatchDirectory[];
    pageIndexById: ReadonlyMap<number, number>;
    directoryIndexById: ReadonlyMap<number, number>;
    currentPageIndex: number;
    batchRunning: boolean;
    /* フォルダを読み込んでいる（フォルダの選択から、一覧を入れ替えるまで） */
    folderLoading: boolean;
    /* 1ページだけのOCRが動いている（同時に1つだけ） */
    pageOCRRunning: boolean;
    stopRequested: boolean;
    /* ページ一覧で閉じているフォルダ。フォルダのパス（例: 資料/1巻）で管理し、再描画しても残す */
    collapsedFolders: ReadonlySet<string>;

    /* ---------- 種別判定 ---------- */

    /* 開始時に種別なしだったページ（id）と、表示中の位置 */
    classifyQueue: readonly number[];
    classifyPosition: number;
    classifyRunning: boolean;
    /* 種別判定の対象のフォルダのパス（例: 資料/1巻）。全体を対象にしたときは空 */
    classifyFolder: string;
    classifyBarText: string;
    classifyBarHidden: boolean;

    /* ---------- 検索 ---------- */

    searchInfo: string;
    searchHits: readonly DisplayedHit[];

    /* ---------- 前回の結果（ocr.json）を使うかの確認 ---------- */

    reuseMessage: string;
    /* 確認を出す要求。増えたら確認を開く */
    reuseRequest: number;
    reuseOpen: boolean;
}


export const SEARCH_INFO_INITIAL = "一括OCRの完了後に検索できます";


export function createInitialState(): AppState {

    return {
        pageWidth: DEFAULT_PAGE_WIDTH,
        pageHeight: DEFAULT_PAGE_HEIGHT,
        pageSizeFromXML: false,
        imageOrientation: null,
        zoomPercent: 30,
        opacityPercent: 100,
        fitRequest: 0,
        imageFile: null,
        imageURL: null,
        imageSrc: null,
        imageVisible: false,
        imageReady: false,
        ocrLines: [],
        selectedLines: new Set(),
        detailsVisible: false,
        detailsText: "",
        scrollRequest: null,
        singleOCRRunning: false,
        dropVisible: false,
        errorMessage: "",
        errorVisible: false,

        activeTab: "pagesTab",
        settingsOpen: false,
        kindInputFocusRequest: 0,
        imageExtensions: loadImageExtensions(),
        pageKinds: loadCustomPageKinds(),
        uncheckedSearchKinds: new Set(),

        batchPages: [],
        batchDirectories: [],
        pageIndexById: new Map(),
        directoryIndexById: new Map(),
        currentPageIndex: -1,
        batchRunning: false,
        folderLoading: false,
        pageOCRRunning: false,
        stopRequested: false,
        collapsedFolders: new Set(),

        classifyQueue: [],
        classifyPosition: -1,
        classifyRunning: false,
        classifyFolder: "",
        classifyBarText: "",
        classifyBarHidden: true,

        searchInfo: SEARCH_INFO_INITIAL,
        searchHits: [],

        reuseMessage: "",
        reuseRequest: 0,
        reuseOpen: false
    };

}


/* ==================================================
   ストア
================================================== */

type Listener = () => void;

let state: AppState = createInitialState();

const listeners = new Set<Listener>();


export function get(): AppState {

    return state;

}


export function set(patch: Partial<AppState> | ((current: AppState) => Partial<AppState>)): void {

    const next =
        typeof patch === "function" ? patch(state) : patch;

    state = { ...state, ...next };

    listeners.forEach(listener => listener());

}


export function subscribe(listener: Listener): () => void {

    listeners.add(listener);

    return () => {

        listeners.delete(listener);

    };

}


/* テストで、状態を最初に戻す */

export function resetState(): void {

    state = createInitialState();

    listeners.forEach(listener => listener());

}


/*
 * 状態の一部を読む。selector は状態の中の値（または数・文字列など）をそのまま返すこと
 * （毎回新しい配列・オブジェクトを作って返すと、描画が止まらなくなる）
 */

export function useStore<T>(selector: (current: AppState) => T): T {

    return useSyncExternalStore(
        subscribe,
        () => selector(state)
    );

}


/* ==================================================
   状態から分かること
================================================== */

/*
 * 一括OCR か 1ページのOCR が動いている間は、フォルダや結果を書いている操作を止める
 */

export function isOCRBusy(current: AppState = state): boolean {

    return current.batchRunning || current.pageOCRRunning;

}


/*
 * OCR中か、フォルダを読み込んでいる間。
 * 読み込みの途中で一覧が新しいフォルダに入れ替わるため、今の一覧のページを変える操作（OCR・種別・リセット・判定）と、
 * フォルダの選択を止める
 */

export function isListLocked(current: AppState = state): boolean {

    return isOCRBusy(current) || current.folderLoading;

}


/* 表示中の一覧のページ（一覧にない画像を開いているときは undefined） */

export function currentPage(current: AppState = state): BatchPage | undefined {

    return current.batchPages[current.currentPageIndex];

}


export function pageById(id: number, current: AppState = state): BatchPage | undefined {

    const index =
        current.pageIndexById.get(id);

    return index === undefined ? undefined : current.batchPages[index];

}


export function directoryById(id: number, current: AppState = state): BatchDirectory | undefined {

    const index =
        current.directoryIndexById.get(id);

    return index === undefined ? undefined : current.batchDirectories[index];

}


export function pagesOfDirectory(directory: BatchDirectory, current: AppState = state): BatchPage[] {

    return directory.pageIds.flatMap(id => {

        const page =
            pageById(id, current);

        return page ? [page] : [];

    });

}


/* ディレクトリ配下のページがすべて終わった（成功か失敗）かどうか */

export function isDirectoryFinished(dirId: number, current: AppState = state): boolean {

    const directory =
        directoryById(dirId, current);

    return directory !== undefined
        && pagesOfDirectory(directory, current).every(page =>
            page.status === "done"
            || page.status === "error"
        );

}


/* ==================================================
   一覧のページ・ディレクトリを書き換える（id が今の一覧にないものは何もしない）
================================================== */

export function updatePages(
    ids: Iterable<number>,
    patch: Partial<BatchPage> | ((page: BatchPage) => Partial<BatchPage>)
): void {

    set(current => {

        let pages: BatchPage[] | null = null;

        for (const id of ids) {

            const index =
                current.pageIndexById.get(id);

            if (index === undefined) {
                continue;
            }

            pages ??= [...current.batchPages];

            const page = pages[index];

            pages[index] = {
                ...page,
                ...(typeof patch === "function" ? patch(page) : patch)
            };

        }

        return pages ? { batchPages: pages } : {};

    });

}


export function updateDirectories(ids: Iterable<number>, patch: Partial<BatchDirectory>): void {

    set(current => {

        let directories: BatchDirectory[] | null = null;

        for (const id of ids) {

            const index =
                current.directoryIndexById.get(id);

            if (index === undefined) {
                continue;
            }

            directories ??= [...current.batchDirectories];

            directories[index] = {
                ...directories[index],
                ...patch
            };

        }

        return directories ? { batchDirectories: directories } : {};

    });

}


/* ==================================================
   エラー表示
================================================== */

/* 前のエラーのタイマーで、あとから出したエラーが早く消えないように、タイマーは1つだけにする */

let errorTimer: ReturnType<typeof setTimeout> | undefined;


export function showError(message: string): void {

    set({
        errorMessage: message,
        errorVisible: true
    });

    clearTimeout(errorTimer);

    errorTimer = setTimeout(() => {

        set({ errorVisible: false });

    }, 5000);

}


/* フォルダの読み込み中なら、理由を出して true を返す（ボタン以外から呼ばれたとき用） */

export function rejectWhileFolderLoading(): boolean {

    if (state.folderLoading) {

        showError(
            "フォルダの読み込みが終わってから、もう一度操作してください"
        );

    }

    return state.folderLoading;

}


/* 投げられたものの名前とメッセージ（Error 以外が投げられても落ちないように） */

export function isAbortError(error: unknown): boolean {

    return (error as { name?: unknown } | null)?.name === "AbortError";

}

export function errorMessage(error: unknown): string {

    return String((error as { message?: unknown } | null)?.message);

}
