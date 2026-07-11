# nhdw/ollama-model — baked-weights image builder (bare-metal recipe only)

This directory builds **`nhdw/ollama-model`**: the stock Ollama runtime with the
qwen2.5:3b + qwen2.5:14b weights **pre-baked** into the image, so an in-cluster
deployment can seed its PVC fully offline.

> **Not the default path.** The default LLM runtime is the **external** ollama
> container (`0_external/llm/docker-compose.yml`), which mounts the weights in
> `../models` directly and needs **no** custom image. This baked image is used only by
> the **bare-metal Linux in-cluster GPU recipe** (`../baremetal/` + the archived
> `_archive/2026-07-06/in-cluster-llm/llm.yaml`). See `../README.md`.

## Files

- `Dockerfile` — `FROM ollama/ollama:0.6.8` + `COPY models /seed-models`. Build
  context is `../models` (the weight store).
- `Modelfile` — the official qwen2.5 template/system, used by `fetch-weights.sh`'s
  GGUF fallback so an offline-created model is byte-identical to the registry one.
- `fetch-weights.sh` — (re)generate `../models` when the registry blob store
  (Cloudflare R2) is reachable, or via a ModelScope/HF GGUF fallback when it is not.

## Build (Recipe A only)

```bash
# refresh the weights if needed
bash 0_external/llm/image/fetch-weights.sh

# build the baked image (context = the weight store)
docker build -t nhdw/ollama-model:dev -f 0_external/llm/image/Dockerfile 0_external/llm/models
```

The in-cluster init container then copies `/seed-models` into the `llm-models` PVC
only when a model is absent (PVC state wins; the image stays a read-only seed). The
single API consumer of the LLM is the gateway's `/api/chat` route — the browser never
talks to Ollama directly.
