"""OCR XML Viewer 用のFlaskサーバー。

画像をアップロードするとNDL古典籍OCR-Liteでテキスト化し、
OCR結果のXMLを返す。index.html はこのサーバーから配信される。

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

PAGE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(PAGE_DIR)
SRC_DIR = os.path.join(ROOT_DIR, "src")

# ocr.py は src/ 直下のモジュールを import するため、パスを通す
sys.path.insert(0, SRC_DIR)
import ocr  # noqa: E402

logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "tif", "tiff", "jp2", "bmp"}

# OCRモデルは同時に1処理ずつ実行する
ocr_lock = threading.Lock()

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024


def build_ocr_args(output_dir, image_path):
    """src/ocr.py の process() に渡す引数を作る。

    モデルのパスはカレントディレクトリに依存しないよう絶対パスで指定する。
    """
    return SimpleNamespace(
        sourcedir=None,
        sourceimg=image_path,
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

        args = build_ocr_args(work_dir, image_path)
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
