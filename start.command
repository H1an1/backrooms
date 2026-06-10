#!/bin/zsh
# Launches THE BACKROOMS in your browser.
cd "$(dirname "$0")"
PORT=4790
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found — install the Xcode Command Line Tools (xcode-select --install)"
  echo "or serve this folder another way, e.g.: npx http-server -p $PORT"
  read -k 1 -s
  exit 1
fi
( sleep 1 && open "http://127.0.0.1:$PORT/" ) &
echo "THE BACKROOMS is at http://127.0.0.1:$PORT/  (Ctrl-C to close)"
python3 -m http.server $PORT
