/*
 * 1回の送信で渡す枚数とサイズ。
 * サーバーの上限（最大50枚、リクエスト100MB）より小さく取る。
 */

export const BATCH_MAX_FILES = 10;

export const BATCH_MAX_BYTES = 80 * 1024 * 1024;


/*
 * 件数に応じて、送信単位（配列）に分ける
 */

export function makeBatches<T extends { file: { size: number } }>(targets: readonly T[]): T[][] {

    const batches: T[][] = [];

    let current: T[] = [];

    let bytes = 0;


    targets.forEach(target => {

        const isFull =
            current.length >= BATCH_MAX_FILES
            || bytes + target.file.size > BATCH_MAX_BYTES;

        if (current.length > 0 && isFull) {

            batches.push(current);

            current = [];

            bytes = 0;

        }


        current.push(target);

        bytes += target.file.size;

    });


    if (current.length > 0) {

        batches.push(current);

    }


    return batches;

}
