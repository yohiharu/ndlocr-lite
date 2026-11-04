/* ==================================================
   検索（全角・半角、大文字・小文字、空白の違いを無視）
================================================== */

import type { SearchData, SearchHit, SearchLine } from "./types";

export const SEARCH_RESULT_LIMIT = 500;


export function normalizeForSearch(text: string): { key: string; origin: number[]; originEnd: number[] } {

    /*
     * key: 検索用の文字列（NFKC・小文字・空白なし）
     * origin / originEnd: key の各文字が text の何文字目から何文字目の手前まで（コードポイント）か
     *
     * 濁点・半濁点（半角カナの ﾞ ﾟ や結合文字）は前の文字と一緒に正規化する。
     * 1文字ずつだと ｶﾞ が「カ＋結合濁点」になり、ガ と一致しないため
     */

    let key = "";

    const origin: number[] = [];

    const originEnd: number[] = [];

    const chars = [...text];


    let index = 0;

    while (index < chars.length) {

        let end = index + 1;

        while (
            end < chars.length
            && /[\p{M}ﾞﾟ]/u.test(chars[end])
        ) {
            end++;
        }


        const normalized =
            chars.slice(index, end)
                .join("")
                .normalize("NFKC")
                .toLowerCase();

        if (!/\s/.test(normalized)) {

            key += normalized;

            for (let i = 0; i < normalized.length; i++) {

                origin.push(index);

                originEnd.push(end);

            }

        }

        index = end;

    }


    return { key, origin, originEnd };

}


export function buildSearchData(source: string): SearchData {

    const xml =
        new DOMParser()
            .parseFromString(
                source,
                "application/xml"
            );


    /* 読み順（ORDER）に並べる。ORDER が無い行は最後 */

    const lines =
        [...xml.querySelectorAll("LINE")]
            .map((line, index) => {

                const order =
                    parseFloat(
                        line.getAttribute("ORDER") ?? ""
                    );

                return {
                    index,
                    text: line.getAttribute("STRING") || "",
                    order: Number.isNaN(order) ? Infinity : order
                };

            })
            .filter(line =>
                line.text.trim()
            )
            .sort((a, b) =>
                a.order - b.order
            );


    /* 行をつないだ1本の文字列で、各行がどこから始まるかを覚えておく */

    let key = "";

    const searchLines = lines.map((line): SearchLine => {

        const normalized =
            normalizeForSearch(line.text);

        const searchLine = {
            index: line.index,
            chars: [...line.text],
            origin: normalized.origin,
            originEnd: normalized.originEnd,
            start: key.length,
            length: normalized.key.length
        };

        key += normalized.key;

        return searchLine;

    });


    return { key, lines: searchLines };

}


export function makeHit(pageIndex: number, searchData: SearchData, start: number, end: number): SearchHit {

    /* 一致した範囲にかかる行。行をまたぐ語句は複数行になる */

    const lines =
        searchData.lines.filter(line =>
            start < line.start + line.length
            && line.start < end
        );


    /* 行ごとに、一致した部分の文字位置（chars の何文字目から何文字目まで）を持つ */

    const segments =
        lines.map(line => {

            const from =
                Math.max(start, line.start) - line.start;

            const to =
                Math.min(end, line.start + line.length) - line.start;

            return {
                chars: line.chars,
                startChar: line.origin[from],
                endChar: line.originEnd[to - 1]
            };

        });


    return {
        pageIndex,
        lineIndexes: lines.map(line => line.index),
        segments
    };

}


/* pages の並び（一覧の順）に、一致したところをすべて返す。kinds は検索する種別 */

export function searchPages(
    pages: readonly { searchData: SearchData | null; kind: string }[],
    query: string,
    kinds: readonly string[]
): SearchHit[] {

    const needle =
        normalizeForSearch(query).key;

    const hits: SearchHit[] = [];

    if (!needle) {
        return hits;
    }


    pages.forEach((page, pageIndex) => {

        if (!page.searchData) {
            return;
        }

        /* 種別で絞る。選ばれている種別のページだけを検索する */

        if (!kinds.includes(page.kind)) {
            return;
        }

        const { key } =
            page.searchData;

        let start =
            key.indexOf(needle);

        while (start >= 0) {

            hits.push(
                makeHit(
                    pageIndex,
                    page.searchData,
                    start,
                    start + needle.length
                )
            );

            start = key.indexOf(
                needle,
                start + needle.length
            );

        }

    });


    return hits;

}
