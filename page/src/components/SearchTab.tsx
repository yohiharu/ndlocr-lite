import { useState, type ReactNode } from "react";
import { DEFAULT_PAGE_KIND } from "../lib/kinds";
import { runSearch, showHit } from "../store/search";
import { setSearchKindChecked } from "../store/settings";
import { useStore, type DisplayedHit } from "../store/state";


/* 行をまたぐ語句は、一致した行ごとに改行して表示する */

function HitText({ hit }: { hit: DisplayedHit }) {

    const parts: ReactNode[] = [];

    hit.segments.forEach((segment, index) => {

        if (index > 0) {

            parts.push(<br key={`br:${index}`} />);

        }

        parts.push(
            segment.chars.slice(0, segment.startChar).join(""),
            <mark key={`mark:${index}`}>
                {segment.chars.slice(segment.startChar, segment.endChar).join("")}
            </mark>,
            segment.chars.slice(segment.endChar).join("")
        );

    });

    return <div className="listText">{parts}</div>;

}


export function SearchTab({ hidden }: { hidden: boolean }) {

    const pageKinds =
        useStore(state => state.pageKinds);

    const uncheckedSearchKinds =
        useStore(state => state.uncheckedSearchKinds);

    const searchInfo =
        useStore(state => state.searchInfo);

    const searchHits =
        useStore(state => state.searchHits);

    const [query, setQuery] =
        useState("");

    /* 種別を付けていないページも絞り込めるように、最後に「種別なし」を出す */

    const searchKinds: [string, string][] = [
        ...pageKinds.map((kind): [string, string] => [kind, kind]),
        [DEFAULT_PAGE_KIND, "種別なし"]
    ];


    return (

        <div id="searchTab" className="tabPanel" hidden={hidden}>

            <div className="tabActions">

                <input
                    id="searchInput"
                    type="search"
                    placeholder="単語・語句・字句"
                    value={query}
                    onChange={event => setQuery(event.currentTarget.value)}
                    onKeyDown={event => {

                        /* 変換確定の Enter では検索しない */

                        if (
                            event.key === "Enter"
                            && !event.nativeEvent.isComposing
                        ) {

                            runSearch(query);

                        }

                    }}
                />

                <button
                    id="searchButton"
                    onClick={() => runSearch(query)}
                >
                    検索
                </button>

            </div>


            <div className="searchKindRow">

                <span>検索する種別</span>

                <div id="searchKinds">
                    {searchKinds.map(([kind, label]) => (
                        <label key={kind}>
                            <input
                                type="checkbox"
                                value={kind}
                                checked={!uncheckedSearchKinds.has(kind)}
                                onChange={event => setSearchKindChecked(kind, event.currentTarget.checked)}
                            />
                            {label}
                        </label>
                    ))}
                </div>

            </div>


            <div id="searchInfo" className="tabInfo">
                {searchInfo}
            </div>


            <ul id="searchResults">
                {searchHits.map((hit, index) => (
                    <li
                        key={index}
                        className="listItem"
                        onClick={() => showHit(hit)}
                    >
                        <div className="listName">{hit.label}</div>
                        <HitText hit={hit} />
                    </li>
                ))}
            </ul>

        </div>

    );

}
