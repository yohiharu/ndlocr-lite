"""OCR XML Viewer 用のFlaskサーバー。

画像をアップロードするとNDL古典籍OCR-Liteでテキスト化し、
OCR結果のXMLを返す。複数画像をまとめて送る /api/ocr/batch もある。
ページ（React で作り、page/dist/ にビルドしたもの）はこのサーバーから配信される。

起動例:
    ./page/start.sh   （uv で .venv を作成し、依存関係を入れてから起動する）
    → ブラウザで http://127.0.0.1:5000 を開く
"""
import argparse
import json
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

# ページのビルド結果（cd page && npm run build で作る。start.sh は必要なときに自動でビルドする）
DIST_DIR = os.path.join(PAGE_DIR, "dist")
DIST_ASSETS_DIR = os.path.join(DIST_DIR, "assets")

# ocr.py は src/ 直下のモジュールを import するため、パスを通す
sys.path.insert(0, SRC_DIR)
import ocr  # noqa: E402

logger = logging.getLogger(__name__)

# 受け付ける拡張子。src/ocr.py の process() が読める形式に合わせる。
# どれを処理するかはページの設定（対象の拡張子）で選ぶ
ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "tif", "tiff", "jp2", "bmp", "webp"}

# 画素に反映する回転（EXIF Orientation）の値。1 は回転なし、それ以外の値は不正として扱わない
EXIF_ORIENTATIONS = {2, 3, 4, 5, 6, 7, 8}

# /api/ocr/batch で一度に受け付ける最大枚数
BATCH_MAX_FILES = 50

# OCRモデルは同時に1処理ずつ実行する
ocr_lock = threading.Lock()

# 実行中の /api/ocr/batch ごとの中断フラグ（ジョブID → Event）。停止ボタンは /api/ocr/cancel で立てる
cancel_lock = threading.Lock()
cancel_events = {}

# 実行中でないジョブに届いた停止（ジョブID → 受け付けた時刻）。
# 処理の開始より先に届いた停止を、開始したときに反映するために持つ。
# 終わったジョブや始まらなかったジョブへの停止も入るので、PENDING_CANCEL_SECONDS を過ぎたら捨てる
pending_cancels = {}
PENDING_CANCEL_SECONDS = 60

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024


def start_cancel_event(job_id):
    """ジョブの中断フラグを作る。開始より先に停止が届いていたら、立てた状態で返す。"""
    with cancel_lock:
        event = threading.Event()
        if pending_cancels.pop(job_id, None) is not None:
            event.set()
        cancel_events[job_id] = event
        return event


def release_cancel_event(job_id):
    with cancel_lock:
        cancel_events.pop(job_id, None)


def request_cancel(job_id):
    """実行中のジョブなら中断フラグを立てる。実行中でなければ、開始したときに止まるよう覚えておく。"""
    now = time.monotonic()
    with cancel_lock:
        event = cancel_events.get(job_id)
        if event is not None:
            event.set()
            return

        for stale_id, requested_at in list(pending_cancels.items()):
            if now - requested_at > PENDING_CANCEL_SECONDS:
                del pending_cancels[stale_id]
        pending_cancels[job_id] = now


def build_ocr_args(output_dir, sourceimg=None, sourcedir=None, is_cancelled=None):
    """src/ocr.py の process() に渡す引数を作る。

    1枚なら sourceimg、フォルダ内の画像をまとめて処理するなら sourcedir を指定する。
    モデルのパスはカレントディレクトリに依存しないよう絶対パスで指定する。
    is_cancelled は画像と画像の間で呼ばれ、True を返すと残りの画像を処理せずに止める。
    """
    return SimpleNamespace(
        sourcedir=sourcedir,
        sourceimg=sourceimg,
        sourcepdf=None,
        output=output_dir,
        viz=False,
        is_cancelled=is_cancelled,
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
    if not os.path.isfile(os.path.join(DIST_DIR, "index.html")):
        logger.error("Page is not built: %s", DIST_DIR)
        return Response(
            "ページがビルドされていません。./page/start.sh で起動するか、"
            "cd page && npm install && npm run build を実行してください。\n",
            status=503,
            mimetype="text/plain; charset=utf-8",
        )
    return send_from_directory(DIST_DIR, "index.html")


@app.get("/assets/<path:filename>")
def page_assets(filename):
    return send_from_directory(DIST_ASSETS_DIR, filename)


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
        if not is_readable_image(image_path):
            logger.warning("OCR request rejected: unreadable image (file=%r)", file.filename)
            return jsonify(error="画像を読み込めません"), 400

        # 回転を反映してからOCRする（出力名は page のまま）。反映した回転はヘッダーで返す
        image_path, orientation = apply_exif_orientation(image_path)

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
    response = Response(xml_text, mimetype="application/xml; charset=utf-8")
    response.headers["X-Image-Orientation"] = str(orientation)
    return response


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
    """撮影時の回転情報（EXIF Orientation）を画素に反映し、OCRに使うパスと反映した回転（1〜8）を返す。

    スマホの写真は画素を横倒しのまま保存し、回転情報だけを持つことがある。
    process() は画素のまま読むため、文字の向きをそろえてからOCRする。回転が必要なときだけ PNG に書き直す。
    ブラウザが回転情報を表示に使うかは形式によって違う（Chrome は WebP の回転情報を使わない）ため、
    反映した回転を返し、ページ側は画像の回転情報を使わずに、この回転で表示する。
    回転情報がない・値が不正なときは、何もせず 1 を返す。
    """
    with Image.open(image_path) as image:
        orientation = image.getexif().get(Base.Orientation, 1)
        if orientation not in EXIF_ORIENTATIONS:
            return image_path, 1

        upright = ImageOps.exif_transpose(image).convert("RGB")

    upright_path = os.path.splitext(image_path)[0] + ".png"
    upright.save(upright_path)
    if upright_path != image_path:
        os.remove(image_path)
    return upright_path, orientation


@app.post("/api/ocr/batch")
def run_ocr_batch():
    """複数画像を1回の process() でまとめてOCRし、画像ごとの結果を返す。

    結果は画像ごとに xml（表示用）と json（src/ocr.py の出力と同じ形式）を返す。
    モデルの読み込みは process() の呼び出しごとに行われるため、
    1枚ずつ /api/ocr を呼ぶより、まとめて渡したほうが速い。
    読めない画像や形式違いは、その画像だけ error になり、他の画像は処理を続ける。
    job が送られたら /api/ocr/cancel で途中から止められる（残りの画像は処理しない）。
    """
    job_id = request.form.get("job", "")
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
        orientations = {}
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

            # 回転を反映してからOCRする。反映した回転は結果の imginfo で返す
            image_path, orientations[index] = apply_exif_orientation(image_path)
            accepted.append(index)

        process_error = None
        if accepted:
            cancel_event = start_cancel_event(job_id) if job_id else None
            args = build_ocr_args(
                output_dir,
                sourcedir=input_dir,
                is_cancelled=cancel_event.is_set if cancel_event else None,
            )
            try:
                with ocr_lock:
                    ocr.process(args)
            except Exception as error:
                # 途中まで出力された結果は返し、残りの画像にだけエラーを付ける
                logger.exception("Batch OCR failed")
                process_error = f"OCR処理に失敗しました: {error}"
            finally:
                if job_id:
                    release_cancel_event(job_id)

            if cancel_event and cancel_event.is_set():
                logger.info("Batch OCR stopped by request (job=%s)", job_id)

        for index in accepted:
            xml_path = os.path.join(output_dir, f"{index:04d}.xml")
            json_path = os.path.join(output_dir, f"{index:04d}.json")
            if not (os.path.isfile(xml_path) and os.path.isfile(json_path)):
                results.append({"index": index, "error": process_error or "OCR結果が生成されませんでした"})
                continue

            with open(xml_path, encoding="utf-8") as xml_file:
                xml_text = xml_file.read()
            with open(json_path, encoding="utf-8") as json_file:
                page_json = json.load(json_file)

            # 連番にリネームした一時ファイルのパスは返さず、アップロードされた元の名前を入れる
            imginfo = page_json["imginfo"]
            imginfo["img_name"] = files[index].filename
            imginfo.pop("img_path", None)
            # ページ側は、この回転で画像を表示して座標を合わせる
            imginfo["orientation"] = orientations[index]
            results.append({"index": index, "xml": xml_text, "json": page_json})

    results.sort(key=lambda result: result["index"])
    elapsed = time.perf_counter() - start_time
    logger.info("Batch OCR done (files=%d, elapsed=%.2f sec)", len(files), elapsed)
    return jsonify(results=results)


@app.post("/api/ocr/cancel")
def cancel_ocr_batch():
    """/api/ocr/batch の job を止める。処理中の画像は終わらせ、そのあとの画像は処理しない。"""
    job_id = request.form.get("job", "")
    if job_id:
        request_cancel(job_id)
        logger.info("Batch OCR cancel requested (job=%s)", job_id)
    return "", 204


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
