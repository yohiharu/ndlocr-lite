import { useMemo, type ReactNode } from "react";
import { DEFAULT_PAGE_KIND } from "../lib/kinds";
import { buildPageTree, countFolderPages, indentOf, pagesUnder, type FolderNode } from "../lib/pageTree";
import { STATUS_LABELS, type BatchPage } from "../lib/types";
import { startClassify } from "../store/classify";
import { resetKinds, resetOCRResults } from "../store/folder";
import { changePageKind, runBatchOCR, runPageOCR } from "../store/ocr";
import { isListLocked, useStore } from "../store/state";
import { showPage, toggleFolder } from "../store/viewer";


/* 一覧の行にあるボタン。行を開閉したりページを表示したりしないように、クリックを止める */

function RowButton({ label, className, disabled, run }: {
    label: string;
    className: string;
    disabled: boolean;
    run: () => void;
}) {

    return (

        <button
            type="button"
            className={className}
            disabled={disabled}
            onClick={event => {

                event.stopPropagation();

                run();

            }}
        >
            {label}
        </button>

    );

}


interface ListContext {
    collapsedFolders: ReadonlySet<string>;
    currentPageIndex: number;
    /* OCR中は結果を書いているフォルダと競合しないように、フォルダの読み込み中は一覧が入れ替わるので、変えられない */
    locked: boolean;
    classifyRunning: boolean;
    pageKinds: readonly string[];
}


function FolderRow({ folder, depth, context }: { folder: FolderNode; depth: number; context: ListContext }) {

    const collapsed =
        context.collapsedFolders.has(folder.key);

    const count =
        countFolderPages(folder);

    const pageIds = () =>
        pagesUnder(folder).map(batchPage => batchPage.id);


    return (

        <li
            className="folderItem"
            style={{ paddingLeft: indentOf(depth) }}
            onClick={() => toggleFolder(folder.key)}
        >

            <span className="folderCaret">{collapsed ? "▸" : "▾"}</span>

            <span className="folderName">{folder.name}</span>

            <span className={count.done === count.total ? "folderCount complete" : "folderCount"}>
                {`${count.done} / ${count.total}`}
            </span>

            {/* OCR は、このフォルダ配下の未処理・失敗したページだけを対象にする */}

            <div className="folderActions">

                <RowButton
                    label="OCR"
                    className="folderOCR"
                    disabled={context.locked || count.done === count.total}
                    run={() => void runBatchOCR(pageIds())}
                />

                <RowButton
                    label="種別判定"
                    className="folderClassify"
                    disabled={context.locked || context.classifyRunning || count.unclassified === 0}
                    run={() => startClassify(pageIds(), folder.key)}
                />

                {/* リセットは、消すもの（種別・OCRの結果や失敗）がないときは押せない */}

                <RowButton
                    label="種別リセット"
                    className="folderReset"
                    disabled={context.locked || count.unclassified === count.total}
                    run={() => void resetKinds(
                        pageIds(),
                        `「${folder.key}」の中のページの種別を外します。よろしいですか？`
                    )}
                />

                <RowButton
                    label="OCRリセット"
                    className="folderReset"
                    disabled={context.locked || count.pending === count.total}
                    run={() => void resetOCRResults(
                        pageIds(),
                        `「${folder.key}」の中のページのOCR結果を消します（種別は残します）。よろしいですか？`
                    )}
                />

            </div>

        </li>

    );

}


function PageRow({ batchPage, index, depth, context }: { batchPage: BatchPage; index: number; depth: number; context: ListContext }) {

    return (

        <li
            className={index === context.currentPageIndex ? "listItem current" : "listItem"}
            style={{ paddingLeft: indentOf(depth) }}
            onClick={() => showPage(index)}
        >

            <div className="listName">{batchPage.file.name}</div>

            <div className="pageMeta">

                <div className={`pageStatus ${batchPage.status}`}>
                    {batchPage.status === "error"
                        ? `失敗: ${batchPage.error}`
                        : STATUS_LABELS[batchPage.status]}
                </div>

                {/* 種別なしは、空の選択肢にする。種別を選ぶときに、そのページを開いてしまわないようにする */}

                <select
                    className="pageKind"
                    disabled={context.locked}
                    value={batchPage.kind}
                    onClick={event => event.stopPropagation()}
                    onChange={event => void changePageKind(batchPage.id, event.currentTarget.value)}
                >
                    <option value={DEFAULT_PAGE_KIND}></option>
                    {context.pageKinds.map(kind => (
                        <option key={kind} value={kind}>{kind}</option>
                    ))}
                </select>

                {/* ページを1枚だけOCRするボタン */}

                <RowButton
                    label={batchPage.status === "done" ? "再OCR" : "OCR"}
                    className="pageOCR"
                    disabled={context.locked}
                    run={() => void runPageOCR(batchPage.id)}
                />

                <RowButton
                    label="OCRリセット"
                    className="pageOCR dangerButton"
                    disabled={context.locked || batchPage.status === "pending"}
                    run={() => void resetOCRResults(
                        [batchPage.id],
                        `「${batchPage.file.name}」のOCR結果を消します（種別は残します）。よろしいですか？`
                    )}
                />

            </div>

        </li>

    );

}


/*
 * node の中身（サブフォルダ → ページ）を、depth の深さで並べる。
 * 閉じたフォルダの中は作らない
 */

function folderContents(node: FolderNode, depth: number, context: ListContext): ReactNode[] {

    const rows: ReactNode[] = [];

    node.folders.forEach(folder => {

        rows.push(
            <FolderRow
                key={`folder:${folder.key}`}
                folder={folder}
                depth={depth}
                context={context}
            />
        );

        if (!context.collapsedFolders.has(folder.key)) {

            rows.push(...folderContents(folder, depth + 1, context));

        }

    });

    node.pages.forEach(({ index, page }) => {

        rows.push(
            <PageRow
                key={`page:${page.id}`}
                batchPage={page}
                index={index}
                depth={depth}
                context={context}
            />
        );

    });

    return rows;

}


/*
 * ページ一覧は、フォルダの階層どおりに表示する
 */

export function PageList() {

    const batchPages =
        useStore(state => state.batchPages);

    const collapsedFolders =
        useStore(state => state.collapsedFolders);

    const currentPageIndex =
        useStore(state => state.currentPageIndex);

    const locked =
        useStore(isListLocked);

    const classifyRunning =
        useStore(state => state.classifyRunning);

    const pageKinds =
        useStore(state => state.pageKinds);

    const tree =
        useMemo(() => buildPageTree(batchPages), [batchPages]);


    return (

        <ul id="pageList">
            {folderContents(
                tree,
                0,
                { collapsedFolders, currentPageIndex, locked, classifyRunning, pageKinds }
            )}
        </ul>

    );

}
