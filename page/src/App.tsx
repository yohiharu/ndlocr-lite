import { useEffect } from "react";
import { InputPanel } from "./components/InputPanel";
import { DetailsPanel, DropMessage, ErrorBox, ReuseDialog } from "./components/Overlays";
import { Toolbar } from "./components/Toolbar";
import { Viewer } from "./components/Viewer";
import { handleClassifyKey } from "./store/classify";


export function App() {

    /* 種別判定中のキー操作（ほかのタブを開いていても、数字キー・→・Esc を使える） */

    useEffect(() => {

        document.addEventListener("keydown", handleClassifyKey);

        return () => {

            document.removeEventListener("keydown", handleClassifyKey);

        };

    }, []);


    return (

        <>

            {/* ツールバー */}

            <Toolbar />


            {/* メイン（ページ・検索 ｜ 表示） */}

            <div id="main">

                <InputPanel />

                <Viewer />

            </div>


            <DropMessage />

            <DetailsPanel />

            <ErrorBox />

            <ReuseDialog />

        </>

    );

}
