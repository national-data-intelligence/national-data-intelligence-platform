#!/usr/bin/env bash
# fetch-weights.sh — (re)generate the 0_external/llm/models weight tree. That tree is
# BOTH the mount for the default external ollama container AND the build context for
# the bare-metal nhdw/ollama-model image. The live model set is qwen2.5:3b + :14b;
# the simplest refresh is `ollama pull qwen2.5:3b && ollama pull qwen2.5:14b` into the
# mounted models dir. The R2-blackhole GGUF fallback below is the legacy 7b path kept
# for restricted networks.
#
# Strategy (offline-first bundle maintenance; network needed ONCE, here only):
#   1. `ollama pull qwen2.5:7b`   — canonical path (registry.ollama.ai → R2 blobs).
#   2. If R2 is unreachable (blackholed on some networks): download the SAME model
#      as a GGUF from ModelScope (Qwen's own host; HF as backup) and `ollama create`
#      it with the OFFICIAL template/system (Modelfile in this dir) under the SAME
#      name, so the gateway chatbot cannot tell the difference.
# Afterwards: build-images.sh --only=ollama-model builds nhdw/ollama-model:dev and
# cache-images.sh saves its bundle tar. The k8s init container then seeds the PVC
# from the image — no network at boot, ever.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
OLLAMA_DIR="$REPO/0_external/llm/models"
GGUF_NAME="qwen2.5-7b-instruct-q4_k_m.gguf"
MS_URL="https://modelscope.cn/models/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/master/$GGUF_NAME"
HF_URL="https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/$GGUF_NAME"
CONTAINER=ollama-weights

mkdir -p "$OLLAMA_DIR/gguf"

run_ollama() { # start a throwaway ollama with the bundle dir mounted as its home
  docker rm -f "$CONTAINER" >/dev/null 2>&1
  docker run -d --name "$CONTAINER" -v "$OLLAMA_DIR":/root/.ollama ollama/ollama:0.6.8 >/dev/null
  for i in $(seq 1 12); do docker exec "$CONTAINER" ollama list >/dev/null 2>&1 && return 0; sleep 2; done
  return 1
}

have_model() { docker exec "$CONTAINER" ollama list 2>/dev/null | grep -q "qwen2.5:7b"; }

echo "== ollama weights → $OLLAMA_DIR =="
run_ollama || { echo "✗ could not start ollama container"; exit 1; }
if have_model; then
  echo "✓ qwen2.5:7b already present — nothing to do"
  docker rm -f "$CONTAINER" >/dev/null; exit 0
fi

echo "▸ attempt 1: official ollama pull (fails fast if R2 is blackholed)"
if timeout 300 docker exec "$CONTAINER" ollama pull qwen2.5:7b >/dev/null 2>&1 && have_model; then
  echo "✓ pulled via registry.ollama.ai"
  docker rm -f "$CONTAINER" >/dev/null; exit 0
fi

echo "▸ attempt 2: GGUF from ModelScope (HF fallback) + ollama create with the official Modelfile"
GGUF="$OLLAMA_DIR/gguf/$GGUF_NAME"
for url in "$MS_URL" "$HF_URL"; do
  echo "  downloading $(echo "$url" | cut -d/ -f3) ..."
  for a in 1 2 3 4 5; do
    curl -sL -C - --retry 8 --retry-delay 5 -o "$GGUF" "$url" && break
    sleep 5
  done
  # sanity: a real GGUF starts with magic "GGUF"
  [ -f "$GGUF" ] && [ "$(head -c4 "$GGUF")" = "GGUF" ] && break
done
[ "$(head -c4 "$GGUF" 2>/dev/null)" = "GGUF" ] || { echo "✗ GGUF download failed from all mirrors"; exit 1; }

docker cp "$(dirname "${BASH_SOURCE[0]}")/Modelfile" "$CONTAINER":/root/.ollama/gguf/Modelfile
docker exec "$CONTAINER" ollama create qwen2.5:7b -f /root/.ollama/gguf/Modelfile \
  && have_model && echo "✓ created qwen2.5:7b from GGUF (official template/system)" \
  || { echo "✗ ollama create failed"; exit 1; }
docker rm -f "$CONTAINER" >/dev/null

# The GGUF is now redundant (blobs live under models/); drop it so the docker build
# context (and the image) stays lean.
rm -f "$GGUF"
echo "== done — the external ollama mounts this tree directly (default path)."
echo "   For the bare-metal image (Recipe A): docker build -t nhdw/ollama-model:dev \\"
echo "     -f 0_external/llm/image/Dockerfile 0_external/llm/models =="
