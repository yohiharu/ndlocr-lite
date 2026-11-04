/*
 * 一括OCRの対象にする拡張子。画面で追加・削除し、このブラウザに保存する。
 * SUPPORTED_EXTENSIONS は page/server.py の ALLOWED_EXTENSIONS と同じにする
 */

export const SUPPORTED_EXTENSIONS: readonly string[] = ["jpg", "jpeg", "png", "tif", "tiff", "jp2", "bmp", "webp"];

export const DEFAULT_EXTENSIONS: readonly string[] = ["jpg"];

export const EXTENSIONS_KEY = "ocrViewer.imageExtensions";


export function loadImageExtensions(): string[] {

    try {

        const saved: unknown =
            JSON.parse(
                localStorage.getItem(EXTENSIONS_KEY) ?? "null"
            );

        if (Array.isArray(saved)) {

            const valid =
                saved.filter((extension): extension is string =>
                    SUPPORTED_EXTENSIONS.includes(extension)
                );

            if (valid.length > 0) {
                return valid;
            }

        }

    } catch {

        /* 保存を読めないときは既定の一覧を使う */

    }

    return [...DEFAULT_EXTENSIONS];

}


export function saveImageExtensions(extensions: readonly string[]): void {

    try {

        localStorage.setItem(
            EXTENSIONS_KEY,
            JSON.stringify(extensions)
        );

    } catch {

        /* 保存できなくても、このページを開いているあいだは選んだ拡張子で動く */

    }

}


export function normalizeExtension(text: string): string {

    /* 「.PNG」「png」のどちらで入力されても同じ扱いにする */

    return text
        .trim()
        .replace(/^\.+/, "")
        .toLowerCase();

}


export function isImageName(name: string, extensions: readonly string[]): boolean {

    const dot =
        name.lastIndexOf(".");

    if (dot < 0) {
        return false;
    }

    return extensions.includes(
        name.slice(dot + 1).toLowerCase()
    );

}
