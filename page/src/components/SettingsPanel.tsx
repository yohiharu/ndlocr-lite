import { useEffect, useRef, useState } from "react";
import { SUPPORTED_EXTENSIONS } from "../lib/extensions";
import { addImageExtension, addPageKind, removeImageExtension, removePageKind } from "../store/settings";
import { useStore } from "../store/state";
import { setSettingsOpen } from "../store/viewer";


/* 登録したもの（拡張子・種別）の1つ。×で外す */

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {

    return (

        <span className="extensionChip">
            {label}
            <button
                type="button"
                title={`${label} を外す`}
                onClick={onRemove}
            >
                ×
            </button>
        </span>

    );

}


/* 拡張子と種別の設定は、普段は畳んでおき、一覧を広く使う */

export function SettingsPanel() {

    const open =
        useStore(state => state.settingsOpen);

    const imageExtensions =
        useStore(state => state.imageExtensions);

    const pageKinds =
        useStore(state => state.pageKinds);

    const focusRequest =
        useStore(state => state.kindInputFocusRequest);

    const [extensionText, setExtensionText] =
        useState("");

    const [kindText, setKindText] =
        useState("");

    const kindInput =
        useRef<HTMLInputElement>(null);


    /* 種別判定を始めようとして種別がなかったときは、開いた欄の入力欄にフォーカスする */

    useEffect(() => {

        if (focusRequest > 0) {

            kindInput.current?.focus();

        }

    }, [focusRequest]);


    return (

        <details
            id="pageSettings"
            className="settingsPanel"
            open={open}
            onToggle={event => setSettingsOpen(event.currentTarget.open)}
        >

            <summary>
                設定（対象の拡張子・種別の登録）
            </summary>


            <div className="extensionSettings">

                <div>
                    対象の拡張子（次にフォルダを選択したときから反映）
                </div>

                <div id="extensionChips">
                    {imageExtensions.map((extension, index) => (
                        <Chip
                            key={`${index}:${extension}`}
                            label={extension}
                            onRemove={() => removeImageExtension(extension)}
                        />
                    ))}
                </div>

                <form
                    id="extensionForm"
                    className="extensionForm"
                    onSubmit={event => {

                        event.preventDefault();

                        if (addImageExtension(extensionText)) {

                            setExtensionText("");

                        }

                    }}
                >

                    <input
                        id="extensionInput"
                        list="extensionCandidates"
                        placeholder="例: png"
                        autoComplete="off"
                        spellCheck={false}
                        value={extensionText}
                        onChange={event => setExtensionText(event.currentTarget.value)}
                    />

                    <button type="submit">
                        追加
                    </button>

                </form>

                <datalist id="extensionCandidates">
                    {SUPPORTED_EXTENSIONS.map(extension => (
                        <option key={extension} value={extension} />
                    ))}
                </datalist>

            </div>


            <div className="extensionSettings">

                <div>
                    種別（ここで登録した種別をページに付けられます）
                </div>

                <div id="kindChips">
                    {pageKinds.map(kind => (
                        <Chip
                            key={kind}
                            label={kind}
                            onRemove={() => removePageKind(kind)}
                        />
                    ))}
                </div>

                <form
                    id="kindForm"
                    className="extensionForm"
                    onSubmit={event => {

                        event.preventDefault();

                        if (addPageKind(kindText)) {

                            setKindText("");

                        }

                    }}
                >

                    <input
                        id="kindInput"
                        ref={kindInput}
                        placeholder="例: 挿絵"
                        maxLength={12}
                        autoComplete="off"
                        spellCheck={false}
                        value={kindText}
                        onChange={event => setKindText(event.currentTarget.value)}
                    />

                    <button type="submit">
                        登録
                    </button>

                </form>

            </div>

        </details>

    );

}
