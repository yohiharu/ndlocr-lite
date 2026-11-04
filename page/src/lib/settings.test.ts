import { beforeEach, describe, expect, it } from "vitest";
import { makeBatches } from "./batches";
import { isImageName, loadImageExtensions, normalizeExtension } from "./extensions";
import {
    classifyKeyGuide,
    classifyKindOfKey,
    loadCustomPageKinds,
    pageKindNameError,
    resolvePageKind
} from "./kinds";


beforeEach(() => {

    localStorage.clear();

});


describe("拡張子", () => {

    it("「.PNG」も「png」も同じに扱う", () => {

        expect(normalizeExtension("  ..PNG ")).toBe("png");

    });

    it("最後の拡張子で、大文字・小文字を区別せずに判定する", () => {

        expect(isImageName("a.b.JPG", ["jpg"])).toBe(true);
        expect(isImageName("jpg", ["jpg"])).toBe(false);
        expect(isImageName("a.jpeg", ["jpg"])).toBe(false);

    });

    it("保存した拡張子のうち使えるものだけを読み、なければ jpg", () => {

        expect(loadImageExtensions()).toEqual(["jpg"]);

        localStorage.setItem("ocrViewer.imageExtensions", JSON.stringify(["gif", "png", 1, "tif"]));
        expect(loadImageExtensions()).toEqual(["png", "tif"]);

        localStorage.setItem("ocrViewer.imageExtensions", JSON.stringify(["gif"]));
        expect(loadImageExtensions()).toEqual(["jpg"]);

        localStorage.setItem("ocrViewer.imageExtensions", "{");
        expect(loadImageExtensions()).toEqual(["jpg"]);

    });

});


describe("種別の名前", () => {

    it("使えない名前は理由を返す", () => {

        expect(pageKindNameError("", [])).toBe("種別の名前を入力してください");
        expect(pageKindNameError("あ".repeat(13), [])).toBe("種別の名前は12文字までです");
        expect(pageKindNameError("123", [])).toBe("「123」は種別の名前に使えません");
        expect(pageKindNameError("constructor", [])).toBe("「constructor」は種別の名前に使えません");
        expect(pageKindNameError("unclassified", [])).toBe("「unclassified」は種別の名前に使えません");
        expect(pageKindNameError("classic", [])).toBe("「classic」は種別の名前に使えません");
        expect(pageKindNameError("挿絵", ["挿絵"])).toBe("「挿絵」はすでにあります");
        expect(pageKindNameError("挿絵", [])).toBe("");
        expect(pageKindNameError("１２", [])).toBe("");

    });

    it("ocr.json の種別を、使う種別にする", () => {

        expect(resolvePageKind("unclassified", [])).toEqual({ kind: "unclassified", register: false });
        expect(resolvePageKind("挿絵", ["挿絵"])).toEqual({ kind: "挿絵", register: false });
        expect(resolvePageKind("classic", [])).toEqual({ kind: "古典籍", register: true });
        expect(resolvePageKind("metadata", ["メタデータ"])).toEqual({ kind: "メタデータ", register: false });
        expect(resolvePageKind("見出し", [])).toEqual({ kind: "見出し", register: true });
        expect(resolvePageKind("toString", [])).toEqual({ kind: "unclassified", register: false });
        expect(resolvePageKind(undefined, [])).toEqual({ kind: "unclassified", register: false });
        expect(resolvePageKind(3, [])).toEqual({ kind: "unclassified", register: false });

    });

    it("保存した種別は、使えるものを重ねずに読む", () => {

        localStorage.setItem("ocrViewer.pageKinds", JSON.stringify(["挿絵", "図版", "挿絵", "1", null, "unclassified"]));

        expect(loadCustomPageKinds()).toEqual(["挿絵", "図版"]);

        localStorage.setItem("ocrViewer.pageKinds", "{");

        expect(loadCustomPageKinds()).toEqual([]);

    });

    it("数字キーは登録した順の種別（1〜9）", () => {

        const kinds = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];

        expect(classifyKindOfKey("1", kinds)).toBe("a");
        expect(classifyKindOfKey("9", kinds)).toBe("i");
        expect(classifyKindOfKey("0", kinds)).toBe("");
        expect(classifyKindOfKey("4", ["a"])).toBe("");
        expect(classifyKeyGuide(kinds)).toBe("1: a　2: b　3: c　4: d　5: e　6: f　7: g　8: h　9: i");

    });

});


describe("makeBatches", () => {

    const page = (size: number) => ({ file: { size } });

    it("10枚ずつに分ける", () => {

        expect(makeBatches(Array.from({ length: 23 }, () => page(1))).map(batch => batch.length)).toEqual([10, 10, 3]);

    });

    it("80MB を超えないように分ける（1枚で超えるときはその1枚だけ）", () => {

        const MB = 1024 * 1024;

        expect(makeBatches([page(50 * MB), page(30 * MB), page(1), page(90 * MB), page(1)]).map(batch => batch.length))
            .toEqual([2, 1, 1, 1]);

    });

    it("空なら送らない", () => {

        expect(makeBatches([])).toEqual([]);

    });

});
