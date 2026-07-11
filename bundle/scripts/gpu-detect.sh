#!/usr/bin/env bash
# gpu-detect.sh — pick the assistant's LLM model for the EXTERNAL ollama container
# based on whether the HOST has an NVIDIA GPU, and point the gateway at it.
#
# The LLM runs OUTSIDE the cluster (0_external/llm/ — a `docker compose` ollama stack
# the gateway reaches at host.k3d.internal:11434). On WSL2 a GPU CANNOT be used from
# inside a nested k3d pod (ollama cuInit → error 304), so the ONLY working 14b-on-GPU
# path is that external container with the host GPU passed through (sources-up.sh
# layers docker-compose.gpu.yml when a host GPU is present). This script's job is the
# matching half: tell the gateway WHICH model to request.
#
#   host GPU present (nvidia-smi)  → NHDW_LLM_MODEL=qwen2.5:14b  (~25 tok/s, agentic)
#   no host GPU                    → NHDW_LLM_MODEL=qwen2.5:3b   (CPU-interactive)
#
# Both models ship in the external ollama's mounted weights (0_external/llm/models).
# Idempotent + best-effort — it NEVER fails the boot, so the same bundle runs on a
# CPU laptop and on the RTX-5080 box unchanged.
#
# (The in-cluster nvidia.com/gpu request that this script used to patch onto the
# in-cluster ollama Deployment was removed when the LLM moved external — 2026-07-06.
# The bare-metal in-cluster GPU recipe lives in 0_external/llm/baremetal/.)
set -uo pipefail
NS="${1:-nhdw}"

# Ground truth = what the EXTERNAL host ollama can actually serve. The agentic
# assistant needs qwen2.5:14b (the 3b model can't reliably chain tool calls), and
# the external ollama runs on the host GPU, so we prefer 14b whenever the host has
# it pulled. Probe the ollama /api/tags over the routes that reach it from either
# the host (localhost) or an in-cluster/agent context (host.k3d.internal). Only
# fall back to 3b if the host genuinely lacks the 14b weights.
MODEL="qwen2.5:14b"; picked=""
for url in "http://localhost:11434" "http://host.k3d.internal:11434" "http://host.docker.internal:11434"; do
  tags="$(curl -sf --max-time 4 "$url/api/tags" 2>/dev/null || true)"
  [ -z "$tags" ] && continue
  if echo "$tags" | grep -q 'qwen2.5:14b'; then MODEL="qwen2.5:14b"; picked="$url"; break; fi
  if echo "$tags" | grep -q 'qwen2.5:3b';  then MODEL="qwen2.5:3b";  picked="$url"; fi
done
if [ "$MODEL" = "qwen2.5:14b" ]; then
  echo "  ✓ external ollama serves qwen2.5:14b${picked:+ ($picked)} — assistant → 14b (agentic)"
else
  echo "  ! qwen2.5:14b not found on the host ollama — assistant → ${MODEL} (fallback; pull 14b for agentic)"
fi
kubectl -n "$NS" set env deploy/nhdw-gateway NHDW_LLM_MODEL="$MODEL" >/dev/null 2>&1 \
  && echo "  ✓ gateway NHDW_LLM_MODEL=$MODEL" \
  || echo "  ! could not set gateway model env (gateway not deployed yet?)"
