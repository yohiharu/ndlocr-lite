/* ==================================================
   結果（ocr.json）の書き込み
================================================== */

import { buildDirectoryResult, writeDirectoryResult } from "../lib/folder";
import type { BatchDirectory, BatchPage } from "../lib/types";
import {
    directoryById,
    errorMessage,
    get,
    isDirectoryFinished,
    pageById,
    pagesOfDirectory,
    showError,
    updateDirectories
} from "./state";


/* 書くときのディレクトリと、その中のページ */

interface DirectorySnapshot {
    directory: BatchDirectory;
    pages: BatchPage[];
}


function snapshotDirectory(dirId: number): DirectorySnapshot | undefined {

    const current = get();

    const directory =
        directoryById(dirId, current);

    return directory
        ? { directory, pages: pagesOfDirectory(directory, current) }
        : undefined;

}


/*
 * ocr.json の書き込みは1つずつ順番に行う。並行して書くと、後に閉じたほうが古い内容で上書きしてしまうため。
 * 書く内容は、順番が来たときのフォルダの状態を使う。
 * 順番が来る前に別のフォルダを読み込んで一覧が入れ替わっていたら、頼んだときの状態（fallback）を書く
 */

let resultSaveChain: Promise<unknown> = Promise.resolve();


export function saveDirectoryQueued(dirId: number, fallback: DirectorySnapshot | undefined = snapshotDirectory(dirId)): Promise<void> {

    const saving =
        resultSaveChain.then(async () => {

            const snapshot =
                snapshotDirectory(dirId) ?? fallback;

            if (!snapshot) {
                return;
            }

            await writeDirectoryResult(
                snapshot.directory.handle,
                buildDirectoryResult(snapshot.pages, snapshot.directory.otherSavedPages)
            );

        });

    resultSaveChain = saving.catch(() => {});

    return saving;

}


/* 頼んである書き込みがすべて終わるまで待つ（テスト用） */

export function waitForSaves(): Promise<unknown> {

    return resultSaveChain;

}


/*
 * 配下のページがすべて終わったディレクトリから順に結果を書く
 */

export async function saveCompletedDirectories(): Promise<void> {

    for (const { id } of get().batchDirectories) {

        const directory =
            directoryById(id);

        if (!directory || directory.saved || !isDirectoryFinished(id)) {

            continue;

        }


        try {

            await saveDirectoryQueued(id);

            updateDirectories([id], { saved: true });

        } catch (error) {

            showError(
                `${directory.path} に結果を書けませんでした: ${errorMessage(error)}`
            );

        }

    }

}


/*
 * 対象のページがあるフォルダの ocr.json を書き直す（リセットのあとの内容を残すため）
 */

export async function saveDirectoriesOf(pageIds: readonly number[]): Promise<void> {

    const current = get();

    const dirIds = [
        ...new Set(
            pageIds.flatMap(id => {

                const page =
                    pageById(id, current);

                return page ? [page.dirId] : [];

            })
        )
    ];

    updateDirectories(dirIds, { saved: false });

    /* 書き終わる前に一覧が入れ替わっても、このときの状態を書けるようにしておく */

    const snapshots = new Map(
        dirIds.map(dirId => [dirId, snapshotDirectory(dirId)])
    );


    for (const dirId of dirIds) {

        const snapshot =
            snapshots.get(dirId);

        try {

            await saveDirectoryQueued(dirId, snapshot);

            updateDirectories([dirId], { saved: isDirectoryFinished(dirId) });

        } catch (error) {

            showError(
                `${snapshot?.directory.path} に結果を書けませんでした: ${errorMessage(error)}`
            );

        }

    }

}
