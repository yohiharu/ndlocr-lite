#!/usr/bin/env bash
# OCR XML Viewer を一発で起動する。
#
# 初回のみ uv の導入（未導入の場合）、仮想環境 .venv の作成、依存関係のインストールを行い、
# 2回目以降はそのまま server.py を起動する（--open 指定時のみブラウザでページを開く）。
# Python は uv が 3.10〜3.13 のものを見つけ、無ければ取得するため、システムの Python 環境は問わない。
# （onnxruntime 1.23.2・numpy 2.2.2 などが 3.13 までの wheel しか出していないため、3.14 以降は使わない）
#
# 使い方:
#     ./page/start.sh          # http://127.0.0.1:5000 で起動
#     ./page/start.sh 8080     # ポートを指定して起動
#     ./page/start.sh --open   # 起動後にブラウザで開く
#
# 終了は Ctrl+C。

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$ROOT_DIR/.venv"
VENV_PY="$VENV_DIR/bin/python"
REQ_FILE="$ROOT_DIR/requirements.txt"
DEPS_STAMP="$VENV_DIR/.deps-installed"
PYTHON_SPEC=">=3.10,<3.14"
HOST="0.0.0.0"
PORT="5000"
OPEN_BROWSER=0

die() {
    echo "[ERROR] $*" >&2
    exit 1
}

usage() {
    echo "使い方: ./page/start.sh [ポート番号] [--open]"
    echo "    ポート番号  待ち受けるポート（1〜65535、既定は 5000）"
    echo "    --open      起動後にブラウザで開く"
}

for arg in "$@"; do
    case "$arg" in
        --open) OPEN_BROWSER=1 ;;
        --no-browser) OPEN_BROWSER=0 ;;
        -h|--help) usage; exit 0 ;;
        -*) usage >&2; die "不明なオプションです: $arg" ;;
        *) PORT="$arg" ;;
    esac
done

# ポート番号は 1〜65535 の数字だけ受け付ける（桁数を先に見て、比較であふれないようにする）
if ! [[ "$PORT" =~ ^[0-9]{1,5}$ ]] || [ "$((10#$PORT))" -lt 1 ] || [ "$((10#$PORT))" -gt 65535 ]; then
    die "ポート番号は 1〜65535 の数字で指定してください: $PORT"
fi
PORT="$((10#$PORT))"

# ブラウザで開くURL。フォルダの結果を書き込む機能はセキュアコンテキストが必要なため、
# 0.0.0.0 ではなく 127.0.0.1 で開く
URL="http://127.0.0.1:$PORT"

cd "$ROOT_DIR"

# 0. uv の用意（未導入なら公式インストーラで導入する）
# 公式インストーラの導入先は ~/.local/bin。シェルの設定ファイルは変更しない
export PATH="$PATH:$HOME/.local/bin"
if ! command -v uv >/dev/null 2>&1; then
    echo "[INFO] uv が見つからないため、公式インストーラで導入します"
    if command -v curl >/dev/null 2>&1; then
        curl -LsSf https://astral.sh/uv/install.sh | UV_NO_MODIFY_PATH=1 sh
    elif command -v wget >/dev/null 2>&1; then
        wget -qO- https://astral.sh/uv/install.sh | UV_NO_MODIFY_PATH=1 sh
    else
        die "curl か wget が必要です。uv（https://docs.astral.sh/uv/）を導入してから再実行してください。"
    fi
    command -v uv >/dev/null 2>&1 || die "uv の導入に失敗しました。"
fi

# 1. 仮想環境の作成（Python 3.10〜3.13 を uv が用意する）
# 既存の .venv の Python が対応範囲外（3.14 以降などで作られたもの）なら作り直す
if [ ! -x "$VENV_PY" ]; then
    echo "[INFO] 仮想環境を作成します: $VENV_DIR"
    uv venv --clear --python "$PYTHON_SPEC" "$VENV_DIR"
elif ! "$VENV_PY" -c 'import sys; sys.exit(not ((3, 10) <= sys.version_info[:2] < (3, 14)))' 2>/dev/null; then
    echo "[INFO] 仮想環境の Python（$("$VENV_PY" -V 2>&1)）は非対応のため作り直します: $VENV_DIR"
    uv venv --clear --python "$PYTHON_SPEC" "$VENV_DIR"
fi

# 2. 依存関係のインストール（requirements.txt が変わったときだけ実行）
if [ ! -f "$DEPS_STAMP" ] || [ "$REQ_FILE" -nt "$DEPS_STAMP" ]; then
    echo "[INFO] 依存関係をインストールします（初回は時間がかかります）"
    # uv venv は pip を入れないため、pip ではなく uv pip でインストールする
    uv pip install --python "$VENV_PY" -r "$REQ_FILE"
    touch "$DEPS_STAMP"
fi

# 3. モデルファイルの確認
for model in \
    "src/model/deim-s-1024x1024.onnx" \
    "src/model/parseq-ndl-24x256-30-tiny-189epoch-tegaki3-r8data-202604.onnx" \
    "src/model/parseq-ndl-24x384-50-tiny-300epoch-tegaki3-r8data-202604.onnx" \
    "src/model/parseq-ndl-24x768-100-tiny-153epoch-tegaki3-r8data-202604.onnx"; do
    [ -f "$ROOT_DIR/$model" ] || die "モデルファイルがありません: $model"
done

# 4. ポートの空き確認
if (exec 3<>"/dev/tcp/$HOST/$PORT") 2>/dev/null; then
    die "ポート $PORT は既に使用されています。別のポートを指定してください（例: ./page/start.sh 8080）。"
fi

# 5. --open 指定時のみ、サーバー起動後にブラウザを開く（起動完了を待ってから）
if [ "$OPEN_BROWSER" -eq 1 ]; then
    (
        for _ in $(seq 1 60); do
            if (exec 3<>"/dev/tcp/$HOST/$PORT") 2>/dev/null; then
                break
            fi
            sleep 0.5
        done
        if command -v xdg-open >/dev/null; then
            xdg-open "$URL" >/dev/null 2>&1 || true
        elif command -v explorer.exe >/dev/null; then
            # WSL の場合は Windows 側のブラウザで開く
            explorer.exe "$URL" >/dev/null 2>&1 || true
        fi
    ) &
fi

echo "[INFO] サーバーを起動します: $URL （終了は Ctrl+C）"
exec "$VENV_PY" "$ROOT_DIR/page/server.py" --host "$HOST" --port "$PORT"
