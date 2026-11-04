import { describe, expect, it } from "vitest";
import { buildSearchData, normalizeForSearch, searchPages } from "./search";


function xmlOf(lines: { text: string; order?: number | null }[]): string {

    return "<OCRDATASET><PAGE WIDTH=\"100\" HEIGHT=\"100\">"
        + lines.map(line =>
            `<LINE STRING="${line.text}"${line.order === null || line.order === undefined ? "" : ` ORDER="${line.order}"`}/>`
        ).join("")
        + "</PAGE></OCRDATASET>";

}


describe("normalizeForSearch", () => {

    it("全角・半角、大文字・小文字、空白の違いをなくす", () => {

        expect(normalizeForSearch("ＡＢＣ　ｄｅｆ g").key).toBe("abcdefg");

    });

    it("半角カナの濁点・半濁点を前の文字と一緒に正規化する", () => {

        expect(normalizeForSearch("ｶﾞｷﾞﾊﾟ").key).toBe("ガギパ");
        expect(normalizeForSearch("が").key).toBe("が");

    });

    it("正規化した各文字が、元の何文字目から来たかを持つ", () => {

        const { key, origin, originEnd } = normalizeForSearch("a ｶﾞ㌀");

        /* ㌀ は NFKC で4文字（アパート）になる */

        expect(key).toBe("aガアパート");
        expect(origin).toEqual([0, 2, 4, 4, 4, 4]);
        expect(originEnd).toEqual([1, 4, 5, 5, 5, 5]);

    });

    it("サロゲートペアの文字をコードポイントで数える", () => {

        const { key, origin } = normalizeForSearch("𠮷野");

        expect(key).toBe("𠮷野");
        expect(origin).toEqual([0, 0, 1]);

    });

});


describe("buildSearchData", () => {

    it("ORDER の順に行をつなぎ、ORDER のない行は最後、文字のない行は除く", () => {

        const data = buildSearchData(xmlOf([
            { text: "三", order: 3 },
            { text: "なし", order: null },
            { text: "一", order: 1 },
            { text: "  ", order: 0 },
            { text: "二", order: 2 }
        ]));

        expect(data.key).toBe("一二三なし");
        expect(data.lines.map(line => line.index)).toEqual([2, 4, 0, 1]);
        expect(data.lines.map(line => line.start)).toEqual([0, 1, 2, 3]);

    });

    it("読めない XML は空", () => {

        expect(buildSearchData("<broken")).toEqual({ key: "", lines: [] });

    });

});


describe("searchPages", () => {

    const pages = [
        { searchData: buildSearchData(xmlOf([{ text: "行をまたぐ語", order: 1 }, { text: "句の検索", order: 2 }])), kind: "unclassified" },
        { searchData: null, kind: "unclassified" },
        { searchData: buildSearchData(xmlOf([{ text: "ああああ", order: 1 }])), kind: "挿絵" }
    ];

    it("行をまたいで一致し、行ごとに一致した文字の範囲を返す", () => {

        const hits = searchPages(pages, "語 句", ["unclassified", "挿絵"]);

        expect(hits).toHaveLength(1);
        expect(hits[0].pageIndex).toBe(0);
        expect(hits[0].lineIndexes).toEqual([0, 1]);
        expect(hits[0].segments.map(segment => [segment.startChar, segment.endChar])).toEqual([[5, 6], [0, 1]]);

    });

    it("一致は重ならないように数え、種別で絞る", () => {

        expect(searchPages(pages, "ああ", ["挿絵"])).toHaveLength(2);
        expect(searchPages(pages, "ああ", ["unclassified"])).toHaveLength(0);

    });

    it("空白だけの語句では何も探さない", () => {

        expect(searchPages(pages, " 　", ["unclassified", "挿絵"])).toEqual([]);

    });

});
