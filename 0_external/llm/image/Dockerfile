# nhdw/ollama-model — the Ollama runtime WITH the qwen2.5:3b + qwen2.5:14b weights
# pre-baked. This image is the OFFLINE seed for the BARE-METAL, in-cluster GPU
# recipe ONLY (baremetal/ + the archived _archive/2026-07-06/in-cluster-llm/llm.yaml).
# The DEFAULT path — the external ollama container (0_external/llm/docker-compose.yml)
# — does NOT use this image; it runs stock ollama/ollama:0.6.8 with the weights in
# ../models mounted directly. So build-images.sh no longer builds this by default;
# build it by hand only for Recipe A (see 0_external/llm/README.md).
#
# 3b = CPU-interactive default; 14b = the strong model used when a GPU is present
# (gpu-detect.sh points the gateway at it).
#
# Build context: 0_external/llm/models  (the host-pulled .ollama tree; regenerate with
#   docker run --rm -v <repo>/0_external/llm/models:/root/.ollama ollama/ollama:0.6.8 \
#     sh -c 'ollama serve & sleep 5; ollama pull qwen2.5:3b; ollama pull qwen2.5:14b'
# ). Build:  docker build -t nhdw/ollama-model:dev -f 0_external/llm/image/Dockerfile \
#            0_external/llm/models
#
# The weights land in /seed-models (NOT /root/.ollama) — the in-cluster init container
# copies them into the llm-models PVC only when absent, so PVC state wins and the
# image stays a read-only seed.
FROM ollama/ollama:0.6.8
COPY models /seed-models
