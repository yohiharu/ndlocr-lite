/* ==================================================
   OCR結果（サーバーが返す XML）を読む
================================================== */

/* PAGE に大きさがないときの、ページの大きさ */

export const DEFAULT_PAGE_WIDTH = 6016;

export const DEFAULT_PAGE_HEIGHT = 4016;


export interface OcrLine {
    /* XML の LINE の通し番号（文字のない行も数える。検索の結果と対応づける） */
    index: number;
    x: number;
    y: number;
    width: number;
    height: number;
    conf: string;
    order: string;
    text: string;
}

export interface ParsedOcr {
    /* PAGE があるときだけ、その大きさ */
    page: { width: number; height: number } | null;
    lines: OcrLine[];
}


/* 読めない XML のときは null。文字のない行は表示しないので含めない */

export function parseOcrXml(source: string): ParsedOcr | null {

    const xml =
        new DOMParser().parseFromString(
            source,
            "application/xml"
        );

    if (xml.querySelector("parsererror")) {

        return null;
    }


    const pageNode =
        xml.querySelector("PAGE");

    const page =
        pageNode
            ? {
                width: Number(pageNode.getAttribute("WIDTH")) || DEFAULT_PAGE_WIDTH,
                height: Number(pageNode.getAttribute("HEIGHT")) || DEFAULT_PAGE_HEIGHT
            }
            : null;


    const lines: OcrLine[] = [];

    xml.querySelectorAll("LINE").forEach((line, index) => {

        const text =
            line.getAttribute("STRING")
            || "";

        if (!text.trim()) {
            return;
        }

        lines.push({
            index,
            x: Number(line.getAttribute("X")) || 0,
            y: Number(line.getAttribute("Y")) || 0,
            width: Number(line.getAttribute("WIDTH")) || 0,
            height: Number(line.getAttribute("HEIGHT")) || 0,
            conf: line.getAttribute("CONF") || "",
            order: line.getAttribute("ORDER") || "",
            text
        });

    });


    return { page, lines };

}


/*
 * 縦書きか横書きかと、文字の大きさ。
 * src/ocr.py と同じく、高さが幅より大きい行を縦書きにする。
 * 文字の大きさは、縦書きは 高さ / 文字数。横書きは 幅 / 文字数 で、行の高さを超えないようにする
 */

export function lineLayout(line: OcrLine): { vertical: boolean; fontSize: number } {

    const vertical =
        line.height > line.width;

    const chars =
        [...line.text].length;

    const fontSize =
        chars === 0
            ? 55
            : vertical
                ? line.height / chars
                : Math.min(line.width / chars, line.height);

    return {
        vertical,
        fontSize: Math.max(15, Math.min(180, fontSize))
    };

}


/* 行をクリックしたときに出す、OCR情報の文 */

export function lineDetailsText(line: OcrLine): string {

    return `文字:
${line.text}

座標:
X = ${line.x}
Y = ${line.y}

サイズ:
WIDTH = ${line.width}
HEIGHT = ${line.height}

CONF:
${line.conf}

ORDER:
${line.order}`;

}


/*
 * 画像の回転（EXIF Orientation）ごとに、回転前の画像を正立した向きへ写す変換。
 * W, H は正立した画像（= OCRの座標）の幅と高さ。5〜8 は回転前の画像の幅と高さが入れ替わる
 */

const ORIENTATION_TRANSFORMS: Record<string, (W: number, H: number) => string> = {
    1: () => "none",
    2: W => `matrix(-1, 0, 0, 1, ${W}, 0)`,
    3: (W, H) => `matrix(-1, 0, 0, -1, ${W}, ${H})`,
    4: (_W, H) => `matrix(1, 0, 0, -1, 0, ${H})`,
    5: () => "matrix(0, 1, 1, 0, 0, 0)",
    6: W => `matrix(0, 1, -1, 0, ${W}, 0)`,
    7: (W, H) => `matrix(0, -1, -1, 0, ${W}, ${H})`,
    8: (_W, H) => `matrix(0, -1, 1, 0, 0, ${H})`
};


export interface BackgroundImageLayout {
    imageOrientation: string;
    width: string;
    height: string;
    transform: string;
}


/*
 * 画像をページに重ねるときの、画像の向きと大きさ。
 * サーバーが反映した回転が分かるときは、ブラウザに画像の回転情報を使わせず、その回転で表示する
 * （ブラウザが回転情報を使うかは形式で違い、Chrome は WebP の回転情報を使わないため、OCRの座標とずれる）。
 * 分からないときは、ブラウザの表示のまま、ページの大きさに合わせる（どれも空 = 指定しない）。
 * orientation は ocr.json から読んだ値のこともあるので、型は決めずに受け取る
 */

export function backgroundImageLayout(
    pageSizeFromXML: boolean,
    orientation: unknown,
    pageWidth: number,
    pageHeight: number
): BackgroundImageLayout {

    const key =
        String(orientation);

    const transform =
        pageSizeFromXML && Object.hasOwn(ORIENTATION_TRANSFORMS, key)
            ? ORIENTATION_TRANSFORMS[key]
            : undefined;

    if (!transform) {

        return {
            imageOrientation: "",
            width: "",
            height: "",
            transform: ""
        };
    }


    const swapped =
        Number(orientation) >= 5;

    return {
        imageOrientation: "none",
        width: (swapped ? pageHeight : pageWidth) + "px",
        height: (swapped ? pageWidth : pageHeight) + "px",
        transform: transform(pageWidth, pageHeight)
    };

}


/* ページの結果（src/ocr.py の JSON）にある、サーバーが反映した回転。前の版で書いた結果にはないので、そのときは null */

export function savedOrientation(json: Record<string, unknown> | null): unknown {

    const imginfo =
        json?.imginfo as { orientation?: unknown } | null | undefined;

    return imginfo?.orientation ?? null;

}
