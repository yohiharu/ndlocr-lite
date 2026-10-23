#!/usr/bin/env bash
# OCR XML Viewer を一発で起動する。
#
# 初回のみ uv の導入（未導入の場合）、仮想環境 .venv の作成、依存関係のインストールを行い、
# 2回目以降はそのまま server.py を起動してブラウザでページを開く。
# Python は uv が 3.10 以上のものを見つけ、無ければ取得するため、システムの Python 環境は問わない。
#
# 使い方:
#     ./page/start.sh          # http://127.0.0.1:5000 で起動
#     ./page/start.sh 8080     # ポートを指定して起動
#     ./page/start.sh --no-browser
#
# 終了は Ctrl+C。

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$ROOT_DIR/.venv"
VENV_PY="$VENV_DIR/bin/python"
REQ_FILE="$ROOT_DIR/requirements.txt"
DEPS_STAMP="$VENV_DIR/.deps-installed"
PYTHON_SPEC=">=3.10"
HOST="127.0.0.1"
PORT="5000"
OPEN_BROWSER=1

for arg in "$@"; do
    case "$arg" in
        --no-browser) OPEN_BROWSER=0 ;;
        *) PORT="$arg" ;;
    esac
done

URL="http://$HOST:$PORT"

die() {
    echo "[ERROR] $*" >&2
    exit 1
}

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

# 1. 仮想環境の作成（Python 3.10 以上を uv が用意する）
if [ ! -x "$VENV_PY" ]; then
    echo "[INFO] 仮想環境を作成します: $VENV_DIR"
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

# 5. サーバー起動後にブラウザを開く（起動完了を待ってから）
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
