/*
 * ページの種別。ページの画面で登録し、ページごとに選んで ocr.json に保存する。検索でこの種別に絞れる。
 * 最初から用意した種別はない。登録した種別は、名前がそのまま ocr.json に入る値になり、登録した順で並ぶ。
 * 登録した種別はこのブラウザに保存する
 */

/*
 * 種別を付けていないページの値。最初はすべてこれ。
 * 前の版で書いた ocr.json の "unclassified" や、種別のない結果も、種別なしとして読む
 */

export const DEFAULT_PAGE_KIND = "unclassified";

/* 前の版で最初から用意していた種別。結果に残っていたら、この名前の種別として登録して読む */

export const LEGACY_PAGE_KINDS: Readonly<Record<string, string>> = {
    classic: "古典籍",
    metadata: "メタデータ"
};

export const PAGE_KINDS_KEY = "ocrViewer.pageKinds";

export const PAGE_KIND_NAME_MAX = 12;


/* 種別の名前として使えないときは、その理由。使えるときは空。kinds は登録済みの種別 */

export function pageKindNameError(name: string, kinds: readonly string[]): string {

    if (name === "") {

        return "種別の名前を入力してください";

    }

    if (name.length > PAGE_KIND_NAME_MAX) {

        return `種別の名前は${PAGE_KIND_NAME_MAX}文字までです`;

    }

    /*
     * 数字だけの名前は並びが変わり、__proto__ などは種別の表に入れられないので使わない
     * （前の版と、保存した種別・ocr.json を同じに扱うため、今も使わない）。
     * 種別なしの値や、前の版の種別の値とも重ならないようにする
     */

    if (
        /^\d+$/.test(name)
        || Object.hasOwn(Object.prototype, name)
        || name === DEFAULT_PAGE_KIND
        || Object.hasOwn(LEGACY_PAGE_KINDS, name)
    ) {

        return `「${name}」は種別の名前に使えません`;

    }

    if (kinds.includes(name)) {

        return `「${name}」はすでにあります`;

    }

    return "";

}


/*
 * ocr.json に入っていた種別を、使う種別にする。register は、まだ登録していない種別として登録するか。
 * 前の版の種別（classic など）は、その日本語の名前の種別として読む。
 * 未登録の種別（ほかのブラウザで登録したものなど）は、結果から消えないように登録する。
 * 種別のない結果や、種別に使えない値は、種別なしにする
 */

export function resolvePageKind(kind: unknown, kinds: readonly string[]): { kind: string; register: boolean } {

    if (typeof kind !== "string") {

        return { kind: DEFAULT_PAGE_KIND, register: false };

    }

    if (kind === DEFAULT_PAGE_KIND || kinds.includes(kind)) {

        return { kind, register: false };

    }

    const name =
        Object.hasOwn(LEGACY_PAGE_KINDS, kind)
            ? LEGACY_PAGE_KINDS[kind]
            : kind;

    if (kinds.includes(name)) {

        return { kind: name, register: false };

    }

    if (pageKindNameError(name, kinds) === "") {

        return { kind: name, register: true };

    }

    return { kind: DEFAULT_PAGE_KIND, register: false };

}


export function loadCustomPageKinds(): string[] {

    try {

        const saved: unknown =
            JSON.parse(
                localStorage.getItem(PAGE_KINDS_KEY) ?? "null"
            );

        if (Array.isArray(saved)) {

            /* 同じ名前が重なっていたら、先に出たほうの位置に1つだけ置く */

            return [
                ...new Set(
                    saved.filter((name): name is string =>
                        typeof name === "string"
                        && pageKindNameError(name, []) === ""
                    )
                )
            ];

        }

    } catch {

        /* 保存を読めないときは、既定の種別だけにする */

    }

    return [];

}


export function saveCustomPageKinds(kinds: readonly string[]): void {

    try {

        localStorage.setItem(
            PAGE_KINDS_KEY,
            JSON.stringify(kinds)
        );

    } catch {

        /* 保存できなくても、このページを開いているあいだは登録した種別を使える */

    }

}


/* 数字キーに対応する種別（登録した順に 1〜9）。対応する種別がなければ空 */

export function classifyKindOfKey(key: string, kinds: readonly string[]): string {

    const index =
        /^[1-9]$/.test(key) ? Number(key) - 1 : -1;

    return kinds[index] ?? "";

}


/* 判定中の表示に出す、数字キーの説明（例: 1: 挿絵　2: 図版） */

export function classifyKeyGuide(kinds: readonly string[]): string {

    return kinds
        .slice(0, 9)
        .map((kind, index) => `${index + 1}: ${kind}`)
        .join("　");

}
