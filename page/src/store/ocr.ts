/* ==================================================
   OCR の実行（server.py の /api/ocr・/api/ocr/batch に送信）と、ページの種別の変更
================================================== */

import { makeBatches } from "../lib/batches";
import { buildSearchData } from "../lib/search";
import type { BatchPage, PageJson, PageStatus } from "../lib/types";
import { saveCompletedDirectories, saveDirectoriesOf, saveDirectoryQueued } from "./results";
import {
    currentPage,
    directoryById,
    errorMessage,
    get,
    isAbortError,
    isDirectoryFinished,
    isOCRBusy,
    pageById,
    rejectWhileFolderLoading,
    set,
    showError,
    updateDirectories,
    updatePages
} from "./state";
import { parseXML, showPage } from "./viewer";


const SERVER_UNREACHABLE =
    "OCRサーバーに接続できません。page/server.py を起動し、http://127.0.0.1:5000 から開いてください";


/* 送信中のOCR要求。停止ボタンで中断するために持つ（送信していないときは null） */

let activeRequest: { controller: AbortController; jobId: string } | null = null;


/* 失敗の応答の本文にあるエラー（JSON でない・エラーがないときは undefined） */

async function responseError(response: Response): Promise<unknown> {

    const body: unknown =
        await response.json()
            .catch(() => ({}));

    return (body as { error?: unknown } | null)?.error;

}


/* ==================================================
   OCR実行（一覧にない画像は /api/ocr に送信）
================================================== */

export async function runOCR(): Promise<void> {

    const imageFile =
        get().imageFile;

    if (!imageFile) {

        showError(
            "先に画像を選択してください"
        );

        return;
    }


    /* 一覧のページを開いているときは、そのページの結果として保存する */

    const batchPage =
        currentPage();

    if (batchPage && batchPage.file === imageFile) {

        await runPageOCR(batchPage.id);

        return;
    }


    /* 送っている間に別の画像を開いたら、その画像に結果を出さない */

    const target =
        imageFile;

    set({ singleOCRRunning: true });


    const formData =
        new FormData();

    formData.append(
        "image",
        target
    );


    try {

        const response =
            await fetch(
                "api/ocr",
                {
                    method: "POST",
                    body: formData
                }
            );


        if (!response.ok) {

            const error =
                await responseError(response);

            throw new Error(
                String(
                    error
                    || `OCRに失敗しました (${response.status})`
                )
            );

        }


        const source =
            await response.text();

        /* サーバーがOCRの前に反映した回転。この回転で画像を表示する（前の版のサーバーは返さない） */

        const orientation =
            Number(response.headers.get("X-Image-Orientation")) || null;

        if (get().imageFile === target) {

            parseXML(source, orientation);

        }

    } catch (error) {

        showError(
            error instanceof TypeError
                ? SERVER_UNREACHABLE
                : errorMessage(error)
        );

    } finally {

        set({ singleOCRRunning: false });

    }

}


/* ==================================================
   フォルダ一括OCR（/api/ocr/batch に送信）
================================================== */

/* 失敗したページには結果を持たせない（表示・検索・ocr.json が失敗と食い違わないように） */

function failedPage(error: string): Partial<BatchPage> {

    return {
        status: "error",
        error,
        xml: "",
        json: null,
        searchData: null
    };

}


/* ids のページをまとめて送り、結果をそれぞれのページに入れる */

async function requestBatchOCR(ids: readonly number[]): Promise<void> {

    const formData =
        new FormData();

    ids.forEach(id => {

        const batchPage =
            pageById(id);

        if (batchPage) {

            formData.append(
                "images",
                batchPage.file
            );

        }

    });


    /* 停止のとき、この要求を中断し、サーバーにも同じ識別子で残りを止めるよう伝える */

    const jobId =
        `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    formData.append(
        "job",
        jobId
    );

    const controller =
        new AbortController();

    activeRequest = { controller, jobId };


    let response: Response;

    try {

        response =
            await fetch(
                "api/ocr/batch",
                {
                    method: "POST",
                    body: formData,
                    signal: controller.signal
                }
            );

    } catch (error) {

        if (isAbortError(error)) {

            throw error;

        }

        throw new Error(SERVER_UNREACHABLE);

    }


    if (!response.ok) {

        const error =
            await responseError(response);

        throw new Error(
            String(
                error
                || `OCRに失敗しました (${response.status})`
            )
        );

    }


    const body =
        await response.json() as {
            results: { index: number; error?: unknown; xml?: unknown; json?: PageJson }[];
        };


    body.results.forEach(result => {

        const id =
            ids[result.index];

        if (id === undefined) {

            return;
        }

        if (result.error) {

            updatePages([id], failedPage(String(result.error)));

            return;
        }

        const xml =
            typeof result.xml === "string" ? result.xml : "";

        updatePages([id], {
            xml,
            json: result.json ?? null,
            searchData: buildSearchData(xml),
            status: "done"
        });

    });


    /* 結果が返ってこなかったページは失敗にする */

    updatePages(ids, batchPage =>
        batchPage.status === "running"
            ? failedPage("OCR結果がありません")
            : {}
    );

}


/* 対象は、全体（一括OCR）か1つのフォルダの中のページ（フォルダ行のOCR） */

export async function runBatchOCR(targetIds: readonly number[]): Promise<void> {

    if (rejectWhileFolderLoading()) {

        return;
    }


    if (isOCRBusy()) {

        showError(
            "実行中のOCRの完了後に、もう一度実行してください"
        );

        return;
    }


    set({
        batchRunning: true,
        stopRequested: false
    });


    /* 未処理と失敗したページを対象にする（停止後の再実行で続きから処理できる） */

    const targets =
        targetIds.flatMap(id => {

            const batchPage =
                pageById(id);

            return batchPage && batchPage.status !== "done" ? [batchPage] : [];

        });

    const targetIdList =
        targets.map(batchPage => batchPage.id);


    /* 対象のページは、送るまで「待機中」と出す。止めて送らなかったときに戻せるよう、元の状態を覚えておく */

    const statusBeforeQueue = new Map<number, PageStatus>(
        targets.map(batchPage => [batchPage.id, batchPage.status])
    );

    updatePages(targetIdList, { status: "queued" });


    /*
     * この実行で結果（成功・失敗）が変わったページのディレクトリ。
     * 停止や失敗で終わっても、終わるときに途中までの結果を書く
     */

    const changedDirectories = new Set<number>();


    for (const batch of makeBatches(targets)) {

        if (get().stopRequested) {
            break;
        }


        const batchIds =
            batch.map(batchPage => batchPage.id);

        updatePages(batchIds, { status: "running" });

        /* 再実行で結果が変わるので、そのディレクトリの結果は書き直す */

        updateDirectories(
            batch.map(batchPage => batchPage.dirId),
            { saved: false }
        );


        let aborted = false;

        try {

            await requestBatchOCR(batchIds);

        } catch (error) {

            /* 停止で中断したページは、失敗ではなく未処理に戻す（続きから再実行できる） */

            aborted =
                isAbortError(error);

            updatePages(batchIds, {
                status: aborted ? "pending" : "error",
                error: aborted ? "" : errorMessage(error)
            });

            if (!aborted) {

                showError(errorMessage(error));

            }

        } finally {

            activeRequest = null;

        }


        /* 停止で中断した送信のページは未処理に戻しただけなので、書き直すものはない */

        if (!aborted) {

            batch.forEach(batchPage => {

                changedDirectories.add(batchPage.dirId);

            });

        }


        /* ディレクトリ配下のページがすべて終わったら、その直下に結果を書く */

        await saveCompletedDirectories();


        /* 表示中のページがこの送信で完了したら、結果を表示する */

        const current =
            currentPage();

        if (
            current
            && current.status === "done"
            && batchIds.includes(current.id)
        ) {

            showPage(get().currentPageIndex);

        }

    }


    /* 停止して送らなかったページは、待機中から元の状態（未処理・失敗）に戻す */

    updatePages(targetIdList, batchPage =>
        batchPage.status === "queued"
            ? { status: statusBeforeQueue.get(batchPage.id) }
            : {}
    );


    /* 停止や失敗で残ったディレクトリも、配下が終わっていれば書く */

    await saveCompletedDirectories();


    /*
     * 配下がまだ終わっていないディレクトリ（停止したなど）も、完了したページの結果を書いておく。
     * タブを閉じても失われず、次は「既存の結果を使う」で続きからOCRできる
     */

    await saveDirectoriesOf(
        targetIdList.filter(id => {

            const batchPage =
                pageById(id);

            return batchPage !== undefined
                && changedDirectories.has(batchPage.dirId)
                && !directoryById(batchPage.dirId)?.saved;

        })
    );


    set({ batchRunning: false });

}


/*
 * 一覧の1ページだけをOCRする。一括OCRと同じ送信を1枚で使い、結果はそのページに入れて、
 * フォルダの ocr.json にすぐ書く（種別を変えたときと同じ）
 */

export async function runPageOCR(pageId: number): Promise<void> {

    if (rejectWhileFolderLoading()) {

        return;
    }


    if (isOCRBusy()) {

        showError(
            "実行中のOCRの完了後に、もう一度実行してください"
        );

        return;
    }


    const batchPage =
        pageById(pageId);

    if (!batchPage) {

        return;
    }

    const dirId =
        batchPage.dirId;

    const directoryPath =
        directoryById(dirId)?.path;

    /*
     * 実行前の状態。停止したときと、完了していたページの再OCRが失敗したときは、この状態に戻す
     * （前の結果を消さない）。実行中も前の結果は持ったままにし、その間に ocr.json を書いても残るようにする
     */

    const before = {
        status: batchPage.status,
        error: batchPage.error,
        xml: batchPage.xml,
        json: batchPage.json,
        searchData: batchPage.searchData
    };

    /* 前の一括OCRを止めたままでも、このOCRの表示が「停止中」にならないように戻す */

    set({
        pageOCRRunning: true,
        stopRequested: false
    });

    updatePages([pageId], {
        status: "running",
        error: ""
    });


    try {

        await requestBatchOCR([pageId]);

        /* サーバーがこのページだけ失敗を返したとき */

        const result =
            pageById(pageId);

        if (result?.status === "error") {

            failPageOCR(pageId, before, result.error);

        }

    } catch (error) {

        /* 停止で中断したときは、実行前の状態（結果があれば結果）に戻す */

        if (isAbortError(error)) {

            updatePages([pageId], before);

        } else {

            failPageOCR(pageId, before, errorMessage(error));

        }

    } finally {

        set({ pageOCRRunning: false });

        activeRequest = null;

    }


    /* 書けなかったときは、ファイルの内容と違うので保存済みとしない */

    updateDirectories([dirId], { saved: false });

    try {

        await saveDirectoryQueued(dirId);

        updateDirectories([dirId], { saved: isDirectoryFinished(dirId) });

    } catch (error) {

        showError(
            `${directoryPath} に結果を書けませんでした: ${errorMessage(error)}`
        );

    }


    /* 表示中のページなら、結果を表示する */

    if (currentPage()?.id === pageId) {

        showPage(get().currentPageIndex);

    }

}


/*
 * 1ページのOCRが失敗したとき。完了していたページ（再OCR）は前の結果を残して完了のままにし、
 * それ以外は失敗にする。どちらもエラーを出す
 */

function failPageOCR(pageId: number, before: Partial<BatchPage>, message: string): void {

    if (before.status === "done") {

        updatePages([pageId], before);

        showError(
            `再OCRに失敗しました（前の結果を残します）: ${message}`
        );

        return;
    }


    updatePages([pageId], failedPage(message));

    showError(message);

}


/* 停止ボタン。送信中のOCRは待たずに中断し、サーバーにも残りの画像を処理しないよう伝える */

export function requestStop(): void {

    set({ stopRequested: true });

    if (activeRequest) {

        activeRequest.controller.abort();

        const cancelForm =
            new FormData();

        cancelForm.append(
            "job",
            activeRequest.jobId
        );

        /* 届かなくても、画面はすでに中断している */

        fetch(
            "api/ocr/cancel",
            {
                method: "POST",
                body: cancelForm
            }
        ).catch(() => {});

    }

}


/*
 * 種別を変えたら、そのフォルダの ocr.json をすぐ書く。
 * OCRを実行しなくても種別が残るように、ここで保存する
 */

export async function changePageKind(pageId: number, kind: string): Promise<void> {

    const batchPage =
        pageById(pageId);

    if (!batchPage) {

        return;
    }

    const dirId =
        batchPage.dirId;

    const directoryPath =
        directoryById(dirId)?.path;

    /* 一覧の選択と、画像の上のボタンを、すぐ合わせる */

    updatePages([pageId], { kind });

    /* 書けなかったときは、ファイルの内容と違うので保存済みとしない */

    updateDirectories([dirId], { saved: false });

    try {

        await saveDirectoryQueued(dirId);

        updateDirectories([dirId], { saved: isDirectoryFinished(dirId) });

    } catch (error) {

        showError(
            `${directoryPath} に種別を書けませんでした: ${errorMessage(error)}`
        );

    }

}
