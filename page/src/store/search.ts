/* ==================================================
   検索の操作
================================================== */

import { DEFAULT_PAGE_KIND } from "../lib/kinds";
import { ancestorFolderKeys } from "../lib/pageTree";
import { SEARCH_RESULT_LIMIT, searchPages } from "../lib/search";
import { get, set, showError, type DisplayedHit } from "./state";
import { showPage } from "./viewer";


/* チェックが付いている種別（種別なしは最後） */

function selectedSearchKinds(): string[] {

    const { pageKinds, uncheckedSearchKinds } = get();

    return [...pageKinds, DEFAULT_PAGE_KIND].filter(kind =>
        !uncheckedSearchKinds.has(kind)
    );

}


export function runSearch(text: string): void {

    const query =
        text.trim();

    if (!query) {

        showError(
            "検索する文字を入力してください"
        );

        return;
    }


    const kinds =
        selectedSearchKinds();

    if (kinds.length === 0) {

        set({
            searchInfo: "検索する種別を1つ以上選んでください",
            searchHits: []
        });

        return;
    }


    const { batchPages } = get();

    if (!batchPages.some(batchPage => batchPage.searchData)) {

        set({
            searchInfo: "OCR済みのページがありません。一括OCRを実行してください",
            searchHits: []
        });

        return;
    }


    const hits =
        searchPages(batchPages, query, kinds);

    const pageCount =
        new Set(
            hits.map(hit => hit.pageIndex)
        ).size;

    /* 種別なしのページは、名前だけを出す */

    const displayed =
        hits.slice(0, SEARCH_RESULT_LIMIT).map((hit): DisplayedHit => {

            const batchPage =
                batchPages[hit.pageIndex];

            return {
                ...hit,
                label: batchPage.kind === DEFAULT_PAGE_KIND
                    ? batchPage.name
                    : `${batchPage.name}（${batchPage.kind}）`
            };

        });

    set({
        searchInfo:
            `${hits.length} 件（${pageCount} ページ）`
            + (
                hits.length > SEARCH_RESULT_LIMIT
                    ? `、先頭 ${SEARCH_RESULT_LIMIT} 件を表示`
                    : ""
            ),
        searchHits: displayed
    });

}


export function showHit(hit: DisplayedHit): void {

    const batchPage =
        get().batchPages[hit.pageIndex];

    if (!batchPage) {
        return;
    }


    /* 一致したページが閉じたフォルダの中にあると一覧に出ないので、上位のフォルダを開く */

    set(current => {

        const collapsedFolders =
            new Set(current.collapsedFolders);

        ancestorFolderKeys(batchPage.dirPath).forEach(key => {

            collapsedFolders.delete(key);

        });

        return { collapsedFolders };

    });


    showPage(hit.pageIndex);


    /* 一致した行を強調し、最初の行が見えるようにスクロールする（表示している行だけ） */

    const shown = new Set(
        get().ocrLines.map(line => line.index)
    );

    const lineIndexes =
        hit.lineIndexes.filter(index =>
            shown.has(index)
        );

    set(current => ({
        selectedLines: new Set([...current.selectedLines, ...lineIndexes]),
        scrollRequest: lineIndexes.length > 0
            ? { lineIndex: lineIndexes[0], nonce: (current.scrollRequest?.nonce ?? 0) + 1 }
            : current.scrollRequest
    }));

}
