"""OCR XML Viewer 用のFlaskサーバー。

画像をアップロードするとNDL古典籍OCR-Liteでテキスト化し、
OCR結果のXMLを返す。複数画像をまとめて送る /api/ocr/batch もある。
index.html はこのサーバーから配信される。

起動例:
    ./page/start.sh   （uv で .venv を作成し、依存関係を入れてから起動する）
    → ブラウザで http://127.0.0.1:5000 を開く
"""
import argparse
import logging
import os
import sys
import tempfile
import threading
import time
from types import SimpleNamespace

from flask import Flask, Response, jsonify, request, send_from_directory
from PIL import Image, ImageOps
from PIL.ExifTags import Base

PAGE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(PAGE_DIR)
SRC_DIR = os.path.join(ROOT_DIR, "src")

# ocr.py は src/ 直下のモジュールを import するため、パスを通す
sys.path.insert(0, SRC_DIR)
import ocr  # noqa: E402

logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "tif", "tiff", "jp2", "bmp"}

# /api/ocr/batch で一度に受け付ける最大枚数
BATCH_MAX_FILES = 50

# OCRモデルは同時に1処理ずつ実行する
ocr_lock = threading.Lock()

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024


def build_ocr_args(output_dir, sourceimg=None, sourcedir=None):
    """src/ocr.py の process() に渡す引数を作る。

    1枚なら sourceimg、フォルダ内の画像をまとめて処理するなら sourcedir を指定する。
    モデルのパスはカレントディレクトリに依存しないよう絶対パスで指定する。
    """
    return SimpleNamespace(
        sourcedir=sourcedir,
        sourceimg=sourceimg,
        sourcepdf=None,
        output=output_dir,
        viz=False,
        det_weights=os.path.join(SRC_DIR, "model", "deim-s-1024x1024.onnx"),
        det_classes=os.path.join(SRC_DIR, "config", "ndl.yaml"),
        det_score_threshold=0.3,
        det_conf_threshold=0.3,
        det_iou_threshold=0.3,
        rec_weights30=os.path.join(SRC_DIR, "model", "parseq-ndl-24x256-30-tiny-189epoch-tegaki3-r8data-202604.onnx"),
        rec_weights50=os.path.join(SRC_DIR, "model", "parseq-ndl-24x384-50-tiny-300epoch-tegaki3-r8data-202604.onnx"),
        rec_weights=os.path.join(SRC_DIR, "model", "parseq-ndl-24x768-100-tiny-153epoch-tegaki3-r8data-202604.onnx"),
        rec_classes=os.path.join(SRC_DIR, "config", "NDLmoji.yaml"),
        device="cpu",
        enable_tcy=False,
    )


@app.get("/")
def index():
    return send_from_directory(PAGE_DIR, "index.html")


@app.post("/api/ocr")
def run_ocr():
    file = request.files.get("image")
    if file is None or file.filename == "":
        logger.warning("OCR request rejected: no image file in request")
        return jsonify(error="画像ファイルを指定してください"), 400

    extension = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if extension not in ALLOWED_EXTENSIONS:
        logger.warning("OCR request rejected: unsupported format (file=%r)", file.filename)
        return jsonify(error="対応していない画像形式です"), 400

    logger.info("OCR request received (file=%r)", file.filename)
    start_time = time.perf_counter()

    with tempfile.TemporaryDirectory() as work_dir:
        # 出力名は入力名から決まるため、固定名で保存する
        image_path = os.path.join(work_dir, f"page.{extension}")
        file.save(image_path)

        args = build_ocr_args(work_dir, sourceimg=image_path)
        try:
            logger.debug("Waiting for OCR lock (file=%r)", file.filename)
            with ocr_lock:
                ocr.process(args)
        except Exception as error:
            logger.exception("OCR failed (file=%r)", file.filename)
            return jsonify(error=f"OCR処理に失敗しました: {error}"), 500

        xml_path = os.path.join(work_dir, "page.xml")
        if not os.path.isfile(xml_path):
            logger.error("OCR finished but no XML was generated (file=%r)", file.filename)
            return jsonify(error="OCR結果が生成されませんでした"), 500

        with open(xml_path, encoding="utf-8") as xml_file:
            xml_text = xml_file.read()

    elapsed = time.perf_counter() - start_time
    logger.info(
        "OCR done (file=%r, xml=%d chars, elapsed=%.2f sec)",
        file.filename,
        len(xml_text),
        elapsed,
    )
    return Response(xml_text, mimetype="application/xml; charset=utf-8")


def is_readable_image(image_path):
    """画像を最後まで読めるか確認する。

    壊れた画像が1枚あると process() が同じ呼び出し内の他の画像も止めてしまうため、
    事前に弾いておく。
    """
    try:
        with Image.open(image_path) as image:
            image.load()
        return True
    except Exception:
        return False


def apply_exif_orientation(image_path):
    """撮影時の回転情報（EXIF Orientation）を画素に反映し、OCRに使うパスを返す。

    スマホの写真は画素を横倒しのまま保存し、回転情報だけを持つことがある。
    ブラウザは回転情報を見て表示するが、process() は画素のまま読むため、
    そのままだと OCR の座標が表示とずれる。回転が必要なときだけ PNG に書き直す。
    """
    with Image.open(image_path) as image:
        if image.getexif().get(Base.Orientation, 1) == 1:
            return image_path

        upright = ImageOps.exif_transpose(image).convert("RGB")

    upright_path = os.path.splitext(image_path)[0] + ".png"
    upright.save(upright_path)
    if upright_path != image_path:
        os.remove(image_path)
    return upright_path


@app.post("/api/ocr/batch")
def run_ocr_batch():
    """複数画像を1回の process() でまとめてOCRし、画像ごとの結果を返す。

    モデルの読み込みは process() の呼び出しごとに行われるため、
    1枚ずつ /api/ocr を呼ぶより、まとめて渡したほうが速い。
    読めない画像や形式違いは、その画像だけ error になり、他の画像は処理を続ける。
    """
    files = request.files.getlist("images")
    if not files:
        logger.warning("Batch OCR request rejected: no image files in request")
        return jsonify(error="画像ファイルを指定してください"), 400
    if len(files) > BATCH_MAX_FILES:
        return jsonify(error=f"一度に処理できるのは{BATCH_MAX_FILES}件までです"), 400

    logger.info("Batch OCR request received (files=%d)", len(files))
    start_time = time.perf_counter()
    results = []

    with tempfile.TemporaryDirectory() as work_dir:
        input_dir = os.path.join(work_dir, "input")
        output_dir = os.path.join(work_dir, "output")
        os.makedirs(input_dir)
        os.makedirs(output_dir)

        # 出力名は入力名から決まるため、連番の固定名で保存し、結果は index で対応づける
        accepted = []
        for index, file in enumerate(files):
            extension = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
            if extension not in ALLOWED_EXTENSIONS:
                logger.warning("Batch OCR skipped unsupported format (file=%r)", file.filename)
                results.append({"index": index, "error": "対応していない画像形式です"})
                continue

            image_path = os.path.join(input_dir, f"{index:04d}.{extension}")
            file.save(image_path)
            if not is_readable_image(image_path):
                # process() はフォルダ内の全画像を読むため、読めないものは残さない
                os.remove(image_path)
                logger.warning("Batch OCR skipped unreadable image (file=%r)", file.filename)
                results.append({"index": index, "error": "画像を読み込めません"})
                continue

            # ブラウザ側の表示と座標を合わせるため、回転を反映してからOCRする
            image_path = apply_exif_orientation(image_path)
            accepted.append(index)

        process_error = None
        if accepted:
            args = build_ocr_args(output_dir, sourcedir=input_dir)
            try:
                with ocr_lock:
                    ocr.process(args)
            except Exception as error:
                # 途中まで出力された結果は返し、残りの画像にだけエラーを付ける
                logger.exception("Batch OCR failed")
                process_error = f"OCR処理に失敗しました: {error}"

        for index in accepted:
            xml_path = os.path.join(output_dir, f"{index:04d}.xml")
            if not os.path.isfile(xml_path):
                results.append({"index": index, "error": process_error or "OCR結果が生成されませんでした"})
                continue

            with open(xml_path, encoding="utf-8") as xml_file:
                results.append({"index": index, "xml": xml_file.read()})

    results.sort(key=lambda result: result["index"])
    elapsed = time.perf_counter() - start_time
    logger.info("Batch OCR done (files=%d, elapsed=%.2f sec)", len(files), elapsed)
    return jsonify(results=results)


def main():
    parser = argparse.ArgumentParser(description="OCR XML Viewer server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5000)
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    logger.info("Starting server on http://%s:%d", args.host, args.port)

    app.run(host=args.host, port=args.port, threaded=True)


if __name__ == "__main__":
    main()
