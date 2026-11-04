/* ==================================================
   設定（対象の拡張子・種別の登録）
================================================== */

import { normalizeExtension, saveImageExtensions, SUPPORTED_EXTENSIONS } from "../lib/extensions";
import { pageKindNameError, resolvePageKind, saveCustomPageKinds } from "../lib/kinds";
import { get, rejectWhileFolderLoading, set, showError } from "./state";


/* 追加できた（すでにあった）ときは true。入力欄を空にする */

export function addImageExtension(text: string): boolean {

    const extension =
        normalizeExtension(text);

    if (extension === "") {

        showError(
            "拡張子を入力してください"
        );

        return false;

    }

    if (!SUPPORTED_EXTENSIONS.includes(extension)) {

        showError(
            `${extension} は対象にできません（使えるもの: ${SUPPORTED_EXTENSIONS.join(", ")}）`
        );

        return false;

    }

    const extensions =
        get().imageExtensions;

    if (!extensions.includes(extension)) {

        const next = [...extensions, extension];

        set({ imageExtensions: next });

        saveImageExtensions(next);

    }

    return true;

}


export function removeImageExtension(extension: string): void {

    const extensions =
        get().imageExtensions;

    /* 1つも残らないと対象が空になるので、最後の1つは外せないようにする */

    if (extensions.length === 1) {

        showError(
            "対象の拡張子は1つ以上必要です"
        );

        return;

    }

    const next =
        extensions.filter(item =>
            item !== extension
        );

    set({ imageExtensions: next });

    saveImageExtensions(next);

}


/* 種別を足して保存する */

function registerPageKind(name: string): void {

    const next = [...get().pageKinds, name];

    set({ pageKinds: next });

    saveCustomPageKinds(next);

}


/* 登録できたときは true。入力欄を空にする */

export function addPageKind(text: string): boolean {

    const name =
        text.trim();

    const error =
        pageKindNameError(name, get().pageKinds);

    if (error) {

        showError(error);

        return false;

    }

    registerPageKind(name);

    return true;

}


/* 登録した種別を外す。その種別のページがあるときは、種別が消えないように外さない */

export function removePageKind(kind: string): void {

    if (rejectWhileFolderLoading()) {

        return;
    }


    const count =
        get().batchPages.filter(batchPage =>
            batchPage.kind === kind
        ).length;

    if (count > 0) {

        showError(
            `「${kind}」のページが ${count} 件あるので外せません。先にそのページの種別を変えてください`
        );

        return;

    }

    const next =
        get().pageKinds.filter(item =>
            item !== kind
        );

    /* 検索の種別のチェックは外した種別ごと消える（もう一度登録したら、検索する状態で出す） */

    set(current => {

        const uncheckedSearchKinds =
            new Set(current.uncheckedSearchKinds);

        uncheckedSearchKinds.delete(kind);

        return {
            pageKinds: next,
            uncheckedSearchKinds
        };

    });

    saveCustomPageKinds(next);

}


/*
 * ocr.json の種別を使う種別にする。
 * 未登録の種別（ほかのブラウザで登録したものなど）は、結果から消えないようにここで登録する
 */

export function normalizePageKind(kind: unknown): string {

    const resolved =
        resolvePageKind(kind, get().pageKinds);

    if (resolved.register) {

        registerPageKind(resolved.kind);

    }

    return resolved.kind;

}


/* 検索する種別のチェック */

export function setSearchKindChecked(kind: string, checked: boolean): void {

    set(current => {

        const uncheckedSearchKinds =
            new Set(current.uncheckedSearchKinds);

        if (checked) {

            uncheckedSearchKinds.delete(kind);

        } else {

            uncheckedSearchKinds.add(kind);

        }

        return { uncheckedSearchKinds };

    });

}
