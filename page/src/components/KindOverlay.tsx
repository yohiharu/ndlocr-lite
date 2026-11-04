import { kindOverlayClicked } from "../store/classify";
import { currentPage, isListLocked, useStore } from "../store/state";


/*
 * 表示中のページ（一覧のページ）の種別。画像の左上に重ねる。
 * 一覧のページを表示していないとき（画像を直接開いたとき）と、種別を1つも登録していないときは出さない
 */

export function KindOverlay() {

    const pageKinds =
        useStore(state => state.pageKinds);

    const kind =
        useStore(state => currentPage(state)?.kind);

    const shown =
        useStore(state => currentPage(state) !== undefined);

    /* OCR中は結果を書いているフォルダと競合しないように、フォルダの読み込み中は一覧が入れ替わるので、変えられない */

    const locked =
        useStore(isListLocked);


    return (

        <div id="kindOverlay" hidden={!shown || pageKinds.length === 0}>
            {pageKinds.map(pageKind => {

                const isActive =
                    pageKind === kind;

                return (

                    <button
                        key={pageKind}
                        type="button"
                        className={isActive ? "active" : undefined}
                        data-kind={pageKind}
                        aria-pressed={isActive}
                        disabled={locked}
                        onClick={() => kindOverlayClicked(pageKind)}
                    >
                        {pageKind}
                    </button>

                );

            })}
        </div>

    );

}
