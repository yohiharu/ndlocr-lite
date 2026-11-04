/* queued は、一括OCRの対象で、まだ送っていない（順番を待っている）ページ */

export type PageStatus = "pending" | "queued" | "running" | "done" | "error";

export const STATUS_LABELS: Record<PageStatus, string> = {
    pending: "未処理",
    queued: "待機中",
    running: "処理中",
    done: "完了",
    error: "失敗"
};


/* src/ocr.py の JSON と同じ形式のページの結果（contents / imginfo）。中身はサーバーが返したまま持つ */

export type PageJson = Record<string, unknown>;


/* 検索用に、行をつないだ1本の文字列と、各行がどこから始まるか */

export interface SearchLine {
    /* XML の LINE の通し番号（表示の .ocr-line の data-index と同じ） */
    index: number;
    chars: string[];
    origin: number[];
    originEnd: number[];
    start: number;
    length: number;
}

export interface SearchData {
    key: string;
    lines: SearchLine[];
}

export interface SearchSegment {
    chars: string[];
    startChar: number;
    endChar: number;
}

export interface SearchHit {
    pageIndex: number;
    lineIndexes: number[];
    segments: SearchSegment[];
}


/*
 * フォルダ内の画像（一覧のページ）。id は読み込みをまたいで重ならない。
 * 一覧の並び（batchPages の順）は、フォルダを読み込んでから変わらない
 */

export interface BatchPage {
    readonly id: number;
    readonly file: File;
    /* 選んだフォルダからのパス（例: 資料/1巻/001.jpg） */
    readonly name: string;
    readonly dirId: number;
    /* 画像のあるディレクトリのパス（例: 資料/1巻） */
    readonly dirPath: string;
    readonly status: PageStatus;
    readonly error: string;
    readonly xml: string;
    readonly json: PageJson | null;
    readonly searchData: SearchData | null;
    readonly kind: string;
}


/*
 * 画像のあるディレクトリ。直下に ocr.json を書く。
 * otherSavedPages は、前回の ocr.json にあって一覧にないページの記録（書き直すときに残す）。
 * saved は ocr.json の内容が最新かどうか
 */

export interface BatchDirectory {
    readonly id: number;
    readonly path: string;
    readonly handle: FileSystemDirectoryHandle;
    readonly pageIds: readonly number[];
    readonly otherSavedPages: readonly unknown[];
    readonly saved: boolean;
}
