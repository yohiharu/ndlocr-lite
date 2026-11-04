import { DEFAULT_PAGE_KIND } from "../lib/kinds";
import { classifyButtonClicked, stopClassify } from "../store/classify";
import { allPageIds, resetKinds, resetOCRResults, selectFolder } from "../store/folder";
import { requestStop, runBatchOCR } from "../store/ocr";
import { isListLocked, isOCRBusy, useStore, type AppState } from "../store/state";
import { PageList } from "./PageList";
import { SettingsPanel } from "./SettingsPanel";


/* 一括OCRの進み具合。フォルダを読み込んでいる間は、そのことを出す */

function batchProgressText(state: AppState): string {

    if (state.folderLoading) {

        return "フォルダを読み込んでいます…";
    }

    const { batchPages, batchDirectories } = state;

    const count = (status: string) =>
        batchPages.filter(batchPage =>
            batchPage.status === status
        ).length;

    const saved =
        batchDirectories.filter(directory =>
            directory.saved
        ).length;

    const summary =
        batchPages.length === 0
            ? "フォルダを選択してください"
            : `完了 ${count("done")} / ${batchPages.length} 件（失敗 ${count("error")} 件）・結果保存 ${saved} / ${batchDirectories.length} フォルダ`;


    if (!isOCRBusy(state)) {

        return summary;
    }


    /* 一括OCR中は、まだ順番を待っているページの数も出す */

    const queued =
        count("queued");

    return (state.stopRequested ? "停止中… " : "処理中… ")
        + summary
        + (queued > 0 ? `・待機 ${queued} 件` : "");

}


export function PagesTab({ hidden }: { hidden: boolean }) {

    const locked =
        useStore(isListLocked);

    const busy =
        useStore(isOCRBusy);

    const folderLoading =
        useStore(state => state.folderLoading);

    const pageCount =
        useStore(state => state.batchPages.length);

    const progress =
        useStore(batchProgressText);

    const classifyRunning =
        useStore(state => state.classifyRunning);

    const classifyBarText =
        useStore(state => state.classifyBarText);

    const classifyBarHidden =
        useStore(state => state.classifyBarHidden);

    /* リセットは、OCR中と、消すもの（種別・OCRの結果や失敗）がないときは使えない */

    const allUnclassified =
        useStore(state => state.batchPages.every(batchPage =>
            batchPage.kind === DEFAULT_PAGE_KIND
        ));

    const allPending =
        useStore(state => state.batchPages.every(batchPage =>
            batchPage.status === "pending"
        ));


    return (

        <div id="pagesTab" className="tabPanel" hidden={hidden}>

            {/* 上から作業の順に並べる。実行と停止は隣同士に置き、進み具合はそのすぐ下に出す */}

            <div className="controlRow">

                <span className="controlLabel">対象</span>

                <div className="controlButtons">

                    {/* 読み込みの途中で、もう一度フォルダを選ばない */}

                    <button
                        id="folderButton"
                        disabled={folderLoading}
                        onClick={() => void selectFolder()}
                    >
                        フォルダを選択
                    </button>

                </div>

            </div>


            <div className="controlRow">

                <span className="controlLabel">OCR</span>

                <div className="controlButtons">

                    <button
                        id="batchButton"
                        className="primaryButton"
                        disabled={locked || pageCount === 0}
                        onClick={() => void runBatchOCR(allPageIds())}
                    >
                        ▶ 一括OCR実行
                    </button>

                    {/* 停止は、一括OCRのほか、1ページだけのOCR中も使える */}

                    <button
                        id="stopButton"
                        className="stopButton"
                        disabled={!busy}
                        onClick={requestStop}
                    >
                        ■ 停止
                    </button>

                </div>

                <div id="batchProgress" className="tabInfo">
                    {progress}
                </div>

            </div>


            <div className="controlRow">

                <span className="controlLabel">種別判定</span>

                <div className="controlButtons">

                    {/* 判定中は「次へ」になり、止めるのは別のボタン（Esc でも止められる） */}

                    <button
                        id="classifyButton"
                        className="primaryButton"
                        disabled={!classifyRunning && (locked || pageCount === 0)}
                        onClick={classifyButtonClicked}
                    >
                        {classifyRunning ? "次へ" : "種別判定を始める"}
                    </button>

                    {/* 判定中だけ押せる。ほかのタブを開いていても Esc で止められる */}

                    <button
                        id="classifyStopButton"
                        className="stopButton"
                        disabled={!classifyRunning}
                        onClick={stopClassify}
                    >
                        ■ 停止
                    </button>

                </div>

                <div id="classifyBar" className="tabInfo classifyBar" hidden={classifyBarHidden}>
                    {classifyBarText}
                </div>

            </div>


            <SettingsPanel />


            <PageList />


            {/* 消す操作は、実行のボタンから離して一番下に置く */}

            <div className="controlRow panelFooter">

                <span className="controlLabel">リセット</span>

                <div className="controlButtons">

                    <button
                        id="resetKindButton"
                        className="dangerButton"
                        disabled={locked || allUnclassified}
                        onClick={() => void resetKinds(
                            allPageIds(),
                            "すべてのページの種別を外します。よろしいですか？"
                        )}
                    >
                        種別をリセット
                    </button>

                    <button
                        id="resetOCRButton"
                        className="dangerButton"
                        disabled={locked || allPending}
                        onClick={() => void resetOCRResults(
                            allPageIds(),
                            "すべてのページのOCR結果を消します（種別は残します）。よろしいですか？"
                        )}
                    >
                        OCR結果をリセット
                    </button>

                </div>

            </div>

        </div>

    );

}
