#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

MODEL="${1:-tiny.en}"
WHISPER_DIR="node_modules/whisper-node/lib/whisper.cpp"
MODELS_DIR="$WHISPER_DIR/models"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need_cmd bash
need_cmd make

if [ ! -d "$WHISPER_DIR" ]; then
  echo "whisper-node is not installed. Run npm ci first." >&2
  exit 1
fi

if [ ! -x "$MODELS_DIR/download-ggml-model.sh" ]; then
  echo "whisper model downloader not found at $MODELS_DIR/download-ggml-model.sh" >&2
  exit 1
fi

echo "Downloading whisper.cpp model: $MODEL"
(cd "$MODELS_DIR" && bash ./download-ggml-model.sh "$MODEL")

echo "Building whisper.cpp"
(cd "$WHISPER_DIR" && make)

echo "Whisper transcription is ready with model: $MODEL"
