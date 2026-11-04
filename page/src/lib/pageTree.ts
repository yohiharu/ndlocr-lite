import { DEFAULT_PAGE_KIND } from "./kinds";
import type { BatchPage } from "./types";


export interface FolderNode {
    /* フォルダのパス（例: 資料/1巻）。一番上（root）は空 */
    key: string;
    name: string;
    folders: Map<string, FolderNode>;
    /* index は一覧（batchPages）の中の位置 */
    pages: { index: number; page: BatchPage }[];
}


/*
 * フォルダの階層を作る。画像のないフォルダは、配下に画像があれば中間のフォルダとして出る。
 * batchPages は一覧と同じ順（配下のフォルダ → フォルダ内の画像）に並んでいるので、
 * フォルダも見つかった順に並ぶ
 */

export function buildPageTree(pages: readonly BatchPage[]): FolderNode {

    const root: FolderNode = {
        key: "",
        name: "",
        folders: new Map(),
        pages: []
    };


    pages.forEach((page, index) => {

        let node = root;

        page.dirPath
            .split("/")
            .forEach(name => {

                let child =
                    node.folders.get(name);

                if (!child) {

                    child = {
                        key: node.key ? `${node.key}/${name}` : name,
                        name,
                        folders: new Map(),
                        pages: []
                    };

                    node.folders.set(name, child);

                }

                node = child;

            });


        node.pages.push({
            index,
            page
        });

    });


    return root;

}


/* フォルダの中のページ（サブフォルダのページも含む）。一覧と同じく、サブフォルダのページが先 */

export function pagesUnder(node: FolderNode): BatchPage[] {

    return [
        ...[...node.folders.values()].flatMap(pagesUnder),
        ...node.pages.map(({ page }) => page)
    ];

}


export interface FolderCount {
    total: number;
    done: number;
    pending: number;
    unclassified: number;
}


/* フォルダ配下（サブフォルダを含む）のページ数と、完了・未処理・種別なしのページ数 */

export function countFolderPages(folder: FolderNode): FolderCount {

    let total = folder.pages.length;

    let done =
        folder.pages.filter(({ page }) =>
            page.status === "done"
        ).length;

    let pending =
        folder.pages.filter(({ page }) =>
            page.status === "pending"
        ).length;

    let unclassified =
        folder.pages.filter(({ page }) =>
            page.kind === DEFAULT_PAGE_KIND
        ).length;


    folder.folders.forEach(child => {

        const count =
            countFolderPages(child);

        total += count.total;

        done += count.done;

        pending += count.pending;

        unclassified += count.unclassified;

    });


    return { total, done, pending, unclassified };

}


/* 階層の深さに応じた左の余白（深さ 0 が一番上） */

export function indentOf(depth: number): string {

    return `${10 + depth * 16}px`;

}


/* 一致したページが閉じたフォルダの中にあると一覧に出ないので、開くフォルダ（上位のフォルダすべて）のパス */

export function ancestorFolderKeys(dirPath: string): string[] {

    const names =
        dirPath.split("/");

    return names.map((_, depth) =>
        names.slice(0, depth + 1).join("/")
    );

}
