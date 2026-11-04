import { useLayoutEffect, useRef } from "react";
import { reuseDialogClosed } from "../store/folder";
import { useStore } from "../store/state";
import { closeDetails } from "../store/viewer";


/* 画像ドロップ */

export function DropMessage() {

    const visible =
        useStore(state => state.dropVisible);

    return (

        <div id="dropMessage" className={visible ? "visible" : undefined}>
            ここに画像をドロップ
        </div>

    );

}


/* OCR詳細。見出しの右端に閉じるボタン（☓）を置く */

export function DetailsPanel() {

    const visible =
        useStore(state => state.detailsVisible);

    const text =
        useStore(state => state.detailsText);

    return (

        <div id="details" style={{ display: visible ? "block" : "none" }}>

            <div className="detailsHeader">

                <strong>
                    OCR情報
                </strong>

                <button
                    id="detailsClose"
                    type="button"
                    title="閉じる"
                    aria-label="OCR情報を閉じる"
                    onClick={closeDetails}
                >☓</button>

            </div>

            <pre id="detailsText">{text}</pre>

        </div>

    );

}


/* エラー（5秒で消える） */

export function ErrorBox() {

    const visible =
        useStore(state => state.errorVisible);

    const message =
        useStore(state => state.errorMessage);

    return (

        <div id="error" style={{ display: visible ? "block" : "none" }}>
            {message}
        </div>

    );

}


/* 前回の結果（ocr.json）があるときに、使うかやり直すかを選ぶ */

export function ReuseDialog() {

    const message =
        useStore(state => state.reuseMessage);

    const request =
        useStore(state => state.reuseRequest);

    const dialog =
        useRef<HTMLDialogElement>(null);


    useLayoutEffect(() => {

        const element =
            dialog.current;

        if (request === 0 || !element || element.open) {

            return;
        }

        /* Esc で閉じたときに、前に押したボタンの値が残らないようにする */

        element.returnValue = "";

        element.showModal();

    }, [request]);


    return (

        <dialog
            id="reuseDialog"
            ref={dialog}
            onClose={event => reuseDialogClosed(event.currentTarget.returnValue)}
        >

            <form method="dialog">

                <p id="reuseMessage">{message}</p>

                <p>
                    {"「既存の結果を使う」は、結果があるページを読み込み、\n結果がないページ（失敗したものを含む）だけOCRします。"}
                    <br />
                    {"「やり直す」は、すべてのページをOCRし直して ocr.json を上書きします。"}
                    <br />
                    {"種別は、どちらを選んでも読み込みます。"}
                </p>

                <div className="dialogActions">

                    <button value="reuse" className="primaryButton">
                        既存の結果を使う
                    </button>

                    <button value="redo">
                        やり直す
                    </button>

                    <button value="cancel">
                        キャンセル
                    </button>

                </div>

            </form>

        </dialog>

    );

}
