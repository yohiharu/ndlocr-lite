/* ==================================================
   表示（画像・OCR結果・倍率・OCR情報）の操作
================================================== */

import { lineDetailsText, parseOcrXml, savedOrientation, type OcrLine } from "../lib/ocrXml";
import { currentPage, get, set, showError, type TabId } from "./state";


const NO_LINES: readonly OcrLine[] = [];

const NO_SELECTION: ReadonlySet<number> = new Set();


/* ==================================================
   OCR結果（サーバーが返す XML）を表示する
================================================== */

/* orientation は、サーバーがOCRの前に画像に反映した回転（分からないときは null） */

export function parseXML(source: string, orientation: unknown = null): void {

    if (!source.trim()) {

        showError(
            "OCR結果がありません"
        );

        return;
    }


    const parsed =
        parseOcrXml(source);

    if (!parsed) {

        showError(
            "OCR結果を読み込めませんでした"
        );

        return;
    }


    /*
     * ページの大きさ（PAGE がないときは今の大きさのまま）と、画像の回転。
     * 画像も、OCRと同じ回転・大きさで重ねる。前の結果のOCR情報は閉じる
     */

    set(current => ({
        pageWidth: parsed.page ? parsed.page.width : current.pageWidth,
        pageHeight: parsed.page ? parsed.page.height : current.pageHeight,
        pageSizeFromXML: parsed.page !== null,
        imageOrientation: orientation,
        ocrLines: parsed.lines,
        detailsVisible: false,
        selectedLines: NO_SELECTION
    }));

    fitPage();

}


/* OCR結果を消す（結果がないので、PAGEの大きさも回転もない。画像の大きさで表示する） */

function clearOCRResult(): void {

    set({
        ocrLines: NO_LINES,
        detailsVisible: false,
        selectedLines: NO_SELECTION,
        pageSizeFromXML: false,
        imageOrientation: null
    });

}


/* ==================================================
   画像読み込み
================================================== */

export function loadImage(file: File | null | undefined): void {

    if (!file) {
        return;
    }


    if (!file.type.startsWith("image/")) {

        showError(
            "画像ファイルを指定してください"
        );

        return;
    }


    /*
     * 別の画像を開いたら、前の画像のOCR結果と大きさは使わず、開いた画像の大きさで表示する
     * （一覧のページは、このあと showPage がそのページの結果を出す）
     */

    if (file !== get().imageFile) {

        clearOCRResult();

    }


    /* 一覧のページ以外の画像を開いたら、そのページは表示していないことにする */

    const current =
        currentPage();

    if (current && current.file !== file) {

        set({ currentPageIndex: -1 });

    }


    const previousURL =
        get().imageURL;

    if (previousURL) {

        URL.revokeObjectURL(previousURL);

    }


    const imageURL =
        URL.createObjectURL(file);

    /* 画像表示は、読み込めてから押せるようにする（ブラウザで表示できない形式なら押せないまま） */

    set({
        imageFile: file,
        imageReady: false,
        imageURL,
        imageSrc: imageURL,
        imageVisible: true
    });

}


/*
 * 画像を読み込めたとき。
 * OCR結果にPAGEの大きさがあるときは、その大きさの領域いっぱいに画像を合わせる（OCRの座標はこの大きさ）。
 * OCR結果がないときは、前のページの大きさを使わず、画像の大きさで表示する
 */

export function imageLoaded(naturalWidth: number, naturalHeight: number): void {

    set({ imageReady: true });

    if (!get().pageSizeFromXML) {

        set({
            pageWidth: naturalWidth,
            pageHeight: naturalHeight
        });

        fitPage();

    }

}


/* 読み込めない画像（tif など）は出さない。壊れた画像の印や、中身のない白い紙を出さないため */

export function imageFailed(): void {

    set({ imageVisible: false });

}


export function toggleImage(): void {

    set(current => ({ imageVisible: !current.imageVisible }));

}


export function setOpacity(value: number): void {

    set({ opacityPercent: value });

}


/* ==================================================
   ズーム・全体表示
================================================== */

export function setZoom(percent: number): void {

    set({
        zoomPercent: Math.max(
            10,
            Math.min(
                200,
                percent
            )
        )
    });

}


/* 全体表示。倍率は、描画したあとに表示領域の大きさを測って決める（Viewer） */

export function fitPage(): void {

    set(current => ({ fitRequest: current.fitRequest + 1 }));

}


/* 表示領域の大きさ（余白を除く）に、ページ全体が入る倍率 */

export function fitPercent(viewportWidth: number, viewportHeight: number, pageWidth: number, pageHeight: number): number {

    const sx =
        (viewportWidth - 60) / pageWidth;

    const sy =
        (viewportHeight - 60) / pageHeight;

    const percent =
        Math.floor(
            Math.min(
                sx,
                sy
            ) * 100
        );

    return Math.max(
        10,
        Math.min(
            200,
            percent
        )
    );

}


/* ==================================================
   OCR情報
================================================== */

export function selectLine(line: OcrLine): void {

    set({
        selectedLines: new Set([line.index]),
        detailsVisible: true,
        detailsText: lineDetailsText(line)
    });

}


/*
 * OCR情報を閉じる。選んでいた行の強調も外す
 * ☓ボタンのほか、OCR結果を消すとき（別の画像・別のページ・リセット・再表示）にも閉じる
 */

export function closeDetails(): void {

    set({
        detailsVisible: false,
        selectedLines: NO_SELECTION
    });

}


/* ==================================================
   一覧のページを表示する
================================================== */

export function showPage(index: number): void {

    const batchPage =
        get().batchPages[index];

    if (!batchPage) {
        return;
    }


    /* 画像。ブラウザで画像として扱えない形式なら画像は出さない（OCR実行もできない） */

    set({
        currentPageIndex: index,
        imageFile: null,
        imageReady: false,
        imageVisible: false
    });

    if (batchPage.file.type.startsWith("image/")) {

        loadImage(batchPage.file);

    } else {

        /* 前のページの画像を、画像表示で出せないようにする */

        set({ imageSrc: null });

    }


    /* OCR結果。未処理のページは結果がないので、画像だけ表示する */

    if (batchPage.xml) {

        /* サーバーが反映した回転（前の版で書いた結果にはないので、そのときは null） */

        parseXML(
            batchPage.xml,
            savedOrientation(batchPage.json)
        );

    } else {

        clearOCRResult();

    }

}


/* ==================================================
   そのほかの画面の操作
================================================== */

export function setActiveTab(tab: TabId): void {

    set({ activeTab: tab });

}


export function setSettingsOpen(open: boolean): void {

    set({ settingsOpen: open });

}


export function setDropVisible(visible: boolean): void {

    set({ dropVisible: visible });

}


export function toggleFolder(key: string): void {

    set(current => {

        const collapsedFolders =
            new Set(current.collapsedFolders);

        if (collapsedFolders.has(key)) {

            collapsedFolders.delete(key);

        } else {

            collapsedFolders.add(key);

        }

        return { collapsedFolders };

    });

}
