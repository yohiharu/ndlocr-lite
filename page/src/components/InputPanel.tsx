import { useStore, type TabId } from "../store/state";
import { setActiveTab } from "../store/viewer";
import { PagesTab } from "./PagesTab";
import { SearchTab } from "./SearchTab";


const TABS: { id: TabId; label: string }[] = [
    { id: "pagesTab", label: "ページ" },
    { id: "searchTab", label: "検索" }
];


/* 左のパネル（ページ・検索） */

export function InputPanel() {

    const activeTab =
        useStore(state => state.activeTab);


    return (

        <section id="inputPanel">

            <nav id="tabs">
                {TABS.map(tab => (
                    <button
                        key={tab.id}
                        className={tab.id === activeTab ? "tab active" : "tab"}
                        data-tab={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                    >
                        {tab.label}
                    </button>
                ))}
            </nav>


            {/* ページ（フォルダの一括OCR） */}

            <PagesTab hidden={activeTab !== "pagesTab"} />


            {/* 検索 */}

            <SearchTab hidden={activeTab !== "searchTab"} />

        </section>

    );

}
