/* ==================================================
   種別判定：種別のないページを順に表示し、キーで種別を付けていく。
   数字キー（1〜9）: 登録した順の種別、→: 分類せずに次へ、Esc: 止める
   対象は全体、またはフォルダの中のページ（フォルダの行の「種別判定」）
================================================== */

import { classifyKeyGuide, classifyKindOfKey, DEFAULT_PAGE_KIND } from "../lib/kinds";
import { changePageKind } from "./ocr";
import { currentPage, get, isOCRBusy, pageById, rejectWhileFolderLoading, set, showError } from "./state";
import { showPage } from "./viewer";


/* 判定の対象（classifyQueue）のうち、まだ種別なしのページの数 */

function countUnclassified(): number {

    return get().classifyQueue.filter(id =>
        pageById(id)?.kind === DEFAULT_PAGE_KIND
    ).length;

}


/* 表示に使う判定の名前。フォルダを対象にしたときは、そのパスを付ける */

function classifyTitle(): string {

    const folder =
        get().classifyFolder;

    return folder
        ? `「${folder}」の種別判定`
        : "種別判定";

}


/* 位置 from 以降で、まだ種別なしのページの位置。なければ -1 */

function findPendingClassify(from: number): number {

    const queue =
        get().classifyQueue;

    for (let position = from; position < queue.length; position++) {

        if (pageById(queue[position])?.kind === DEFAULT_PAGE_KIND) {

            return position;

        }

    }

    return -1;

}


function showClassifyBar(text: string): void {

    set({
        classifyBarText: text,
        classifyBarHidden: false
    });

}


/* targetIds のうち、種別なしのページを順に判定する。folderKey は対象のフォルダ（全体のときは空） */

export function startClassify(targetIds: readonly number[], folderKey = ""): void {

    if (rejectWhileFolderLoading()) {

        return;
    }


    /* 付ける種別がないと判定できないので、先に登録してもらう */

    if (get().pageKinds.length === 0) {

        showError(
            "種別を登録してから、種別判定を始めてください"
        );

        /* 登録する欄は普段畳んでいるので、開いて入力できるようにする */

        set(current => ({
            settingsOpen: true,
            kindInputFocusRequest: current.kindInputFocusRequest + 1
        }));

        return;
    }

    set({
        classifyFolder: folderKey,
        classifyQueue: targetIds.filter(id =>
            pageById(id)?.kind === DEFAULT_PAGE_KIND
        )
    });

    if (get().classifyQueue.length === 0) {

        showClassifyBar(
            finishedClassifyText()
        );

        return;
    }

    set({ classifyRunning: true });

    showClassifyPage(0);

}


function showClassifyPage(position: number): void {

    set({ classifyPosition: position });

    const index =
        get().pageIndexById.get(get().classifyQueue[position]);

    if (index !== undefined) {

        showPage(index);

    }

    showClassifyBar(
        `${classifyTitle()}中 ・ 残り ${countUnclassified()} 件 ・ ${classifyKeyGuide(get().pageKinds)}　→: 後で　Esc: 止める`
    );

}


/* 次の種別なしのページへ。残りがなければ判定を終える */

export function advanceClassify(): void {

    const next =
        findPendingClassify(get().classifyPosition + 1);

    if (next === -1) {

        finishClassify();

        return;
    }

    showClassifyPage(next);

}


/* 表示中のページに種別を付けて、次へ。種別は一覧と同じく ocr.json にすぐ書く */

export function classifyDisplayed(kind: string): void {

    if (rejectWhileFolderLoading()) {

        return;
    }


    if (isOCRBusy()) {

        showError(
            "OCRの完了後に種別を付けてください"
        );

        return;
    }


    const batchPage =
        currentPage();

    if (!batchPage) {

        showError(
            "一覧のページを表示してから種別を選んでください"
        );

        return;
    }


    /* 保存は待たずに次へ進む（連続して押しても、保存は順番に書く） */

    void changePageKind(batchPage.id, kind);

    advanceClassify();

}


/* 判定が終わったときの表示。種別なしが残っていれば、その件数も出す */

function finishedClassifyText(): string {

    const remaining =
        countUnclassified();

    return remaining === 0
        ? `${classifyTitle()}が終わりました。種別のないページはありません`
        : `${classifyTitle()}が終わりました。種別のないページが ${remaining} 件残っています`;

}


function finishClassify(): void {

    set({ classifyRunning: false });

    showClassifyBar(
        finishedClassifyText()
    );

}


export function stopClassify(): void {

    set({
        classifyRunning: false,
        classifyBarHidden: true
    });

}


/* 種別判定の「種別判定を始める」ボタン。判定中は「次へ」で、分類せずに次の種別なしへ進む */

export function classifyButtonClicked(): void {

    if (get().classifyRunning) {

        advanceClassify();

    } else {

        startClassify(get().batchPages.map(batchPage => batchPage.id));

    }

}


/* 画像の上の種別ボタン */

export function kindOverlayClicked(kind: string): void {

    /* 種別判定中は、種別を付けて次の種別なしのページへ進む */

    if (get().classifyRunning) {

        classifyDisplayed(kind);

        return;
    }


    const batchPage =
        currentPage();

    /* 付いている種別をもう一度押すと、種別を外す */

    if (batchPage) {

        void changePageKind(
            batchPage.id,
            batchPage.kind === kind ? DEFAULT_PAGE_KIND : kind
        );

    }

}


/* 種別判定中のキー操作。文字入力やダイアログの中では、キーを種別に使わない */

export function handleClassifyKey(event: KeyboardEvent): void {

    const current = get();

    if (!current.classifyRunning || event.ctrlKey || event.metaKey || event.altKey || current.reuseOpen) {

        return;
    }

    /* Esc は、一覧の種別選択や入力欄にフォーカスがあっても止められるようにする */

    if (event.key === "Escape") {

        event.preventDefault();

        stopClassify();

        return;
    }

    if (event.target instanceof Element && event.target.matches("input, textarea, select")) {

        return;
    }

    const kind =
        classifyKindOfKey(event.key, current.pageKinds);

    if (kind) {

        event.preventDefault();

        classifyDisplayed(kind);

    } else if (event.key === "ArrowRight") {

        event.preventDefault();

        advanceClassify();

    }

}
