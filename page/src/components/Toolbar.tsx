import { runOCR } from "../store/ocr";
import { currentPage, isListLocked, useStore, type AppState } from "../store/state";
import { fitPage, loadImage, setOpacity, setZoom, toggleImage } from "../store/viewer";


/*
 * OCR実行は、画像があり、その画像のOCRが動いていないときだけ押せる。
 * 一覧のページを開いているときは、一覧のOCR（一括・1ページ）が終わるまで押せない。
 * 一番上には状態を出さないので、開いている画像を処理している間はボタンに「処理中…」、
 * 一括OCRで順番を待っている間は「待機中…」と出す
 */

function ocrButtonDisabled(state: AppState): boolean {

    const current =
        currentPage(state);

    const isListPage =
        Boolean(current) && current?.file === state.imageFile;

    return !state.imageFile
        || state.singleOCRRunning
        || (isListPage && isListLocked(state));

}


function ocrButtonText(state: AppState): string {

    const current =
        currentPage(state);

    const isListPage =
        current !== undefined && current.file === state.imageFile;

    return state.singleOCRRunning || (isListPage && current.status === "running")
        ? "処理中…"
        : isListPage && current.status === "queued"
            ? "待機中…"
            : "▶ OCR実行";

}


/* 一番上には、表示中の一覧のページのパスだけを出す。一覧にない画像を開いているときは何も出さない */

function statusText(state: AppState): string {

    return currentPage(state)?.name ?? "";

}


export function Toolbar() {

    const ocrDisabled =
        useStore(ocrButtonDisabled);

    const ocrText =
        useStore(ocrButtonText);

    const status =
        useStore(statusText);

    const imageReady =
        useStore(state => state.imageReady);

    const opacityPercent =
        useStore(state => state.opacityPercent);

    const zoomPercent =
        useStore(state => state.zoomPercent);


    return (

        <div id="toolbar">

            {/* 左: 画像を選んでOCRする（作業の始まり）と、その状態 */}

            <div className="toolGroup">

                <label className="button">

                    画像を選択

                    <input
                        id="imageInput"
                        type="file"
                        accept="image/*"
                        onChange={event => loadImage(event.currentTarget.files?.[0])}
                    />

                </label>

                <button
                    id="ocrButton"
                    className="primaryButton"
                    disabled={ocrDisabled}
                    onClick={() => void runOCR()}
                >
                    {ocrText}
                </button>

            </div>


            {/* 表示中の一覧のページのパスだけを出す（一覧にない画像を開いているときは空） */}

            <span id="status">{status}</span>


            {/* 右: 表示の調整（画像・文字の重ね方 ｜ 倍率） */}

            <div id="viewTools">

                <div className="toolGroup">

                    {/* 画像を読み込めたときだけ押せる（画像がないのに白い紙を出さない） */}

                    <button
                        id="toggleImage"
                        disabled={!imageReady}
                        onClick={toggleImage}
                    >
                        画像表示
                    </button>

                    <span>
                        OCR透明度
                    </span>

                    <input
                        id="opacity"
                        type="range"
                        min="0"
                        max="100"
                        value={opacityPercent}
                        onChange={event => setOpacity(Number(event.currentTarget.value))}
                    />

                    <span id="opacityText">
                        {opacityPercent + "%"}
                    </span>

                </div>


                <div className="toolGroup">

                    <span>
                        倍率
                    </span>

                    <button
                        id="minusButton"
                        onClick={() => setZoom(zoomPercent - 10)}
                    >
                        −
                    </button>

                    <input
                        id="zoom"
                        type="range"
                        min="10"
                        max="200"
                        value={zoomPercent}
                        onChange={event => setZoom(Number(event.currentTarget.value))}
                    />

                    <button
                        id="plusButton"
                        onClick={() => setZoom(zoomPercent + 10)}
                    >
                        ＋
                    </button>

                    <span id="zoomText">
                        {zoomPercent + "%"}
                    </span>

                    {/* 画像を読み込めたときだけ押せる */}

                    <button
                        id="fitButton"
                        disabled={!imageReady}
                        onClick={fitPage}
                    >
                        全体表示
                    </button>

                </div>

            </div>

        </div>

    );

}
