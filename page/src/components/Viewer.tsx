import { memo, useEffect, useLayoutEffect, useRef } from "react";
import { backgroundImageLayout, lineLayout, type OcrLine } from "../lib/ocrXml";
import { useStore } from "../store/state";
import { fitPercent, imageFailed, imageLoaded, loadImage, selectLine, setDropVisible, setZoom } from "../store/viewer";
import { KindOverlay } from "./KindOverlay";


/* OCRの1行。クリックすると、その行のOCR情報を出す */

function OcrLineView({ line, selected }: { line: OcrLine; selected: boolean }) {

    const { vertical, fontSize } =
        lineLayout(line);

    const className =
        "ocr-line"
        + (vertical ? "" : " horizontal")
        + (selected ? " selected" : "");

    return (

        <div
            className={className}
            style={{
                left: line.x + "px",
                top: line.y + "px",
                fontSize: fontSize + "px",
                width: Math.max(line.width, 1) + "px",
                height: Math.max(line.height, 1) + "px"
            }}
            data-x={line.x}
            data-y={line.y}
            data-width={line.width}
            data-height={line.height}
            data-conf={line.conf}
            data-order={line.order}
            data-index={line.index}
            onClick={event => {

                event.stopPropagation();

                selectLine(line);

            }}
        >
            {line.text}
        </div>

    );

}


/* OCRの行は多いので、行・強調・透明度が変わったときだけ描き直す */

const OcrLayer = memo(function OcrLayer({ lines, selectedLines, opacityPercent }: {
    lines: readonly OcrLine[];
    selectedLines: ReadonlySet<number>;
    opacityPercent: number;
}) {

    return (

        <div id="ocrLayer" style={{ opacity: opacityPercent / 100 }}>
            {lines.map(line => (
                <OcrLineView
                    key={line.index}
                    line={line}
                    selected={selectedLines.has(line.index)}
                />
            ))}
        </div>

    );

});


/* 表示領域（原画像とOCR結果を重ねて表示する） */

export function Viewer() {

    const pageWidth = useStore(state => state.pageWidth);
    const pageHeight = useStore(state => state.pageHeight);
    const pageSizeFromXML = useStore(state => state.pageSizeFromXML);
    const imageOrientation = useStore(state => state.imageOrientation);
    const zoomPercent = useStore(state => state.zoomPercent);
    const opacityPercent = useStore(state => state.opacityPercent);
    const fitRequest = useStore(state => state.fitRequest);
    const imageSrc = useStore(state => state.imageSrc);
    const imageVisible = useStore(state => state.imageVisible);
    const ocrLines = useStore(state => state.ocrLines);
    const selectedLines = useStore(state => state.selectedLines);
    const scrollRequest = useStore(state => state.scrollRequest);

    const viewport = useRef<HTMLElement>(null);
    const page = useRef<HTMLDivElement>(null);

    const handledFit = useRef(fitRequest);
    const handledScroll = useRef(scrollRequest?.nonce ?? 0);
    const dragCounter = useRef(0);


    /*
     * 全体表示。新しいページの大きさ・OCRの行を描いたあとに、表示領域の大きさを測って倍率を決める。
     * このあと同じ描画で、検索で見つけた行へスクロールするので、新しい倍率は要素にもすぐ当てておく
     */

    useLayoutEffect(() => {

        if (handledFit.current === fitRequest || !viewport.current || !page.current) {

            return;
        }

        handledFit.current = fitRequest;

        const percent =
            fitPercent(
                viewport.current.clientWidth,
                viewport.current.clientHeight,
                pageWidth,
                pageHeight
            );

        page.current.style.transform = `scale(${percent / 100})`;

        setZoom(percent);

        viewport.current.scrollLeft = 0;

        viewport.current.scrollTop = 0;

    }, [fitRequest, pageWidth, pageHeight]);


    /* 検索で見つけた行が見えるようにスクロールする */

    useLayoutEffect(() => {

        if (!scrollRequest || handledScroll.current === scrollRequest.nonce) {

            return;
        }

        handledScroll.current = scrollRequest.nonce;

        page.current
            ?.querySelector(`.ocr-line[data-index="${scrollRequest.lineIndex}"]`)
            ?.scrollIntoView({
                block: "center",
                inline: "center"
            });

    }, [scrollRequest]);


    /*
     * 表示領域の外（ツールバー・左の一覧など）にファイルを落としたときは、受け付けない。
     * 既定のままだと、ブラウザがそのファイルを開き、ページから離れて読み込んだ一覧や結果が消えるため。
     * 文字のドラッグ（検索欄への貼り付けなど）は止めない
     */

    useEffect(() => {

        const isFileDragOutsideViewport = (event: DragEvent) =>
            event.dataTransfer !== null
            && [...event.dataTransfer.types].includes("Files")
            && !(event.target instanceof Node && viewport.current?.contains(event.target));

        const onDragOver = (event: DragEvent) => {

            if (isFileDragOutsideViewport(event)) {

                event.preventDefault();

                /* 落とせない場所であることを、カーソルで示す */

                event.dataTransfer!.dropEffect = "none";

            }

        };

        const onDrop = (event: DragEvent) => {

            if (isFileDragOutsideViewport(event)) {

                event.preventDefault();

            }

        };

        document.addEventListener("dragover", onDragOver);

        document.addEventListener("drop", onDrop);

        return () => {

            document.removeEventListener("dragover", onDragOver);

            document.removeEventListener("drop", onDrop);

        };

    }, []);


    const imageLayout =
        backgroundImageLayout(pageSizeFromXML, imageOrientation, pageWidth, pageHeight);


    return (

        <div id="viewerFrame">

            <section
                id="viewport"
                ref={viewport}
                tabIndex={0}
                onDragEnter={event => {

                    event.preventDefault();

                    dragCounter.current++;

                    setDropVisible(true);

                }}
                onDragOver={event => {

                    event.preventDefault();

                }}
                onDragLeave={event => {

                    event.preventDefault();

                    dragCounter.current--;

                    if (dragCounter.current <= 0) {

                        setDropVisible(false);

                        dragCounter.current = 0;

                    }

                }}
                onDrop={event => {

                    event.preventDefault();

                    dragCounter.current = 0;

                    setDropVisible(false);

                    const image =
                        [...event.dataTransfer.files].find(file =>
                            file.type.startsWith("image/")
                        );

                    if (image) {

                        loadImage(image);

                    }

                }}
            >

                <div
                    id="page"
                    ref={page}
                    style={{
                        width: pageWidth + "px",
                        height: pageHeight + "px",
                        transform: `scale(${zoomPercent / 100})`
                    }}
                >

                    {/*
                      * サーバーが反映した回転が分かるときは、ブラウザに画像の回転情報を使わせず、その回転で表示する。
                      * 読み込めない画像（tif など）は出さない（imageFailed）
                      */}

                    <img
                        id="backgroundImage"
                        alt=""
                        src={imageSrc ?? undefined}
                        className={imageVisible ? "visible" : undefined}
                        style={imageLayout}
                        onLoad={event => imageLoaded(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
                        onError={imageFailed}
                    />

                    <OcrLayer
                        lines={ocrLines}
                        selectedLines={selectedLines}
                        opacityPercent={opacityPercent}
                    />

                </div>

            </section>


            {/* 一覧のページを表示しているときだけ出す。スクロールしても動かないよう、表示領域の外に置く */}

            <KindOverlay />

        </div>

    );

}
