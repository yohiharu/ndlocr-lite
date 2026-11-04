import { describe, expect, it } from "vitest";
import { backgroundImageLayout, lineDetailsText, lineLayout, parseOcrXml, savedOrientation, type OcrLine } from "./ocrXml";


function line(partial: Partial<OcrLine>): OcrLine {

    return { index: 0, x: 0, y: 0, width: 10, height: 100, conf: "", order: "", text: "あいう", ...partial };

}


describe("parseOcrXml", () => {

    it("PAGE の大きさと、文字のある行を読む（行の番号は文字のない行も数える）", () => {

        const parsed = parseOcrXml(
            "<OCRDATASET><PAGE WIDTH=\"800\" HEIGHT=\"600\">"
            + "<LINE X=\"1\" Y=\"2\" WIDTH=\"3\" HEIGHT=\"4\" CONF=\"0.5\" ORDER=\"7\" STRING=\"一\"/>"
            + "<LINE STRING=\"  \"/>"
            + "<LINE X=\"abc\" STRING=\"二\"/>"
            + "</PAGE></OCRDATASET>"
        );

        expect(parsed?.page).toEqual({ width: 800, height: 600 });
        expect(parsed?.lines).toEqual([
            { index: 0, x: 1, y: 2, width: 3, height: 4, conf: "0.5", order: "7", text: "一" },
            { index: 2, x: 0, y: 0, width: 0, height: 0, conf: "", order: "", text: "二" }
        ]);

    });

    it("PAGE の大きさがなければ既定の大きさ、PAGE がなければ null", () => {

        expect(parseOcrXml("<A><PAGE WIDTH=\"0\"/></A>")?.page).toEqual({ width: 6016, height: 4016 });
        expect(parseOcrXml("<A><LINE STRING=\"x\"/></A>")?.page).toBeNull();

    });

    it("読めない XML は null", () => {

        expect(parseOcrXml("<broken")).toBeNull();

    });

});


describe("lineLayout", () => {

    it("縦書きは 高さ / 文字数、横書きは 幅 / 文字数（行の高さまで）で、15〜180px に収める", () => {

        expect(lineLayout(line({ width: 10, height: 300, text: "あいう" }))).toEqual({ vertical: true, fontSize: 100 });
        expect(lineLayout(line({ width: 300, height: 20, text: "abc" }))).toEqual({ vertical: false, fontSize: 20 });
        expect(lineLayout(line({ width: 10, height: 30, text: "あいう" })).fontSize).toBe(15);
        expect(lineLayout(line({ width: 10, height: 3000, text: "あ" })).fontSize).toBe(180);
        expect(lineLayout(line({ width: 50, height: 50, text: "𠮷" })).vertical).toBe(false);

    });

});


describe("lineDetailsText", () => {

    it("行の情報を並べる", () => {

        expect(lineDetailsText(line({ x: 1, y: 2, width: 3, height: 4, conf: "0.9", order: "5", text: "文" })))
            .toBe("文字:\n文\n\n座標:\nX = 1\nY = 2\n\nサイズ:\nWIDTH = 3\nHEIGHT = 4\n\nCONF:\n0.9\n\nORDER:\n5");

    });

});


describe("backgroundImageLayout", () => {

    it("回転ごとに、正立した向きへ写す", () => {

        expect(backgroundImageLayout(true, 1, 600, 900)).toEqual({ imageOrientation: "none", width: "600px", height: "900px", transform: "none" });
        expect(backgroundImageLayout(true, 3, 600, 900).transform).toBe("matrix(-1, 0, 0, -1, 600, 900)");
        expect(backgroundImageLayout(true, 6, 600, 900)).toEqual({
            imageOrientation: "none",
            width: "900px",
            height: "600px",
            transform: "matrix(0, 1, -1, 0, 600, 0)"
        });
        expect(backgroundImageLayout(true, "8", 600, 900).transform).toBe("matrix(0, -1, 1, 0, 0, 900)");

    });

    it("回転が分からない・PAGE の大きさがないときは、何も指定しない", () => {

        const none = { imageOrientation: "", width: "", height: "", transform: "" };

        expect(backgroundImageLayout(true, null, 600, 900)).toEqual(none);
        expect(backgroundImageLayout(true, 9, 600, 900)).toEqual(none);
        expect(backgroundImageLayout(true, "toString", 600, 900)).toEqual(none);
        expect(backgroundImageLayout(false, 6, 600, 900)).toEqual(none);

    });

});


describe("savedOrientation", () => {

    it("imginfo.orientation（なければ null）", () => {

        expect(savedOrientation({ imginfo: { orientation: 6 } })).toBe(6);
        expect(savedOrientation({ imginfo: {} })).toBeNull();
        expect(savedOrientation({ imginfo: "x" })).toBeNull();
        expect(savedOrientation(null)).toBeNull();

    });

});
