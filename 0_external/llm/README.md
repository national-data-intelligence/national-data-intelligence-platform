# External LLM (Ollama) — the dashboard assistant's model runtime

The NHDW dashboard assistant (internal-bi chatbot) is powered by an **Ollama** LLM.
That LLM runs **OUTSIDE the k8s cluster**, as a docker-compose stack here in
`0_external/`, for the same reason every `0_external/` system does: in production a
model server is a backing resource run outside the warehouse. The gateway reaches it
at **`http://host.k3d.internal:11434`** (the k3d host route — the same pattern the
source replicas + fayda use).

Everything about the LLM lives under this one folder:

| Path                        | What                                                                 |
|-----------------------------|----------------------------------------------------------------------|
| `docker-compose.yml`        | the external Ollama stack (CPU-safe base; the DEFAULT runtime)        |
| `docker-compose.gpu.yml`    | additive GPU overlay (reserves the NVIDIA device)                    |
| `models/`                   | the ollama home (`/root/.ollama`) — the bundled weight store (gitignored) |
| `image/`                    | the baked-image builder (`nhdw/ollama-model`) — **bare-metal recipe only** |
| `baremetal/`                | the bare-metal-Linux in-cluster GPU recipe (custom k3s node + device plugin) |

## Why the LLM is external (WSL2 GPU reality)

Verified on the target host (RTX 5080 Laptop, 16 GB, Blackwell **sm_120**, WSL2) on
2026-07-06:

- **ollama 0.6.8 already supports Blackwell (sm_120)** — no newer image needed. A
  `docker --gpus all ollama/ollama:0.6.8` offloads qwen2.5:14b fully to the GPU
  (`library=cuda variant=v12 compute=12.0`, `offloaded 49/49 layers`).
  **14b = ~25 tok/s on GPU vs ~1.3 tok/s on CPU (~20×).**
- **In-cluster GPU does NOT work on WSL2.** CUDA cannot initialise inside a nested
  k3d node→pod (`cuInit` → error 304 `CUDA_ERROR_OPERATING_SYSTEM` + SIGSEGV), and
  the k8s device-plugin can't enumerate GPUs (NVML "Not Supported"). The GPU works
  fine only in a **direct** `docker --gpus all` container on the host.

So the only working 14b-on-GPU path here is this external container. The old
in-cluster `nhdw-llm` Deployment was archived to
`_archive/2026-07-06/in-cluster-llm/llm.yaml`.

## Bring-up

Normally you never run this by hand — `bundle/scripts/bootstrap.sh` brings it up via
`bundle/scripts/sources-up.sh` (the external-world bring-up), which:

1. detects a host GPU (`nvidia-smi`) and, if present, layers `docker-compose.gpu.yml`;
2. `docker compose up -d` the Ollama stack (published on `0.0.0.0:11434`);
3. waits for health on `http://127.0.0.1:11434/api/tags`;
4. ensures the selected model is present in `./models` (both 3b + 14b ship in the
   bundle, so this is a no-op cold-boot — it only LOUD-pulls if a weight is missing).

`bundle/scripts/gpu-detect.sh` then points the gateway at the right model:
**qwen2.5:14b** when the host has a GPU, else **qwen2.5:3b** (CPU-interactive).

Manual bring-up:

```bash
# CPU (default — runs unchanged on any host, no --gpus needed):
docker compose -f 0_external/llm/docker-compose.yml up -d

# GPU (host with the NVIDIA Container Toolkit):
docker compose -f 0_external/llm/docker-compose.yml -f 0_external/llm/docker-compose.gpu.yml up -d

curl http://127.0.0.1:11434/api/tags        # confirm the models are listed
```

Tear down: `bundle/scripts/sources-up.sh down` (or `... down --wipe`), which stops
this stack alongside the source replicas.

## CPU fallback (intact)

The base `docker-compose.yml` requests **no** GPU, so it runs on a CPU-only laptop
unchanged. On CPU the assistant uses **qwen2.5:3b** (interactive-fast; the 14b model
is minutes/answer on CPU). The GPU overlay is purely additive — nothing to remove for
a CPU host.

## Offline-first

- **Image:** stock **`ollama/ollama:0.6.8`** — already listed in
  `bundle/scripts/cache-images.sh` (PUBLIC images). `cache-images.sh --save-only`
  saves it to `bundle/images/`; cold-boot `docker load`s it into the host daemon, so
  the external compose needs no registry pull.
- **Weights:** `models/` ships in the bundle with qwen2.5:3b + qwen2.5:14b already
  pulled — no `ollama pull` at bring-up. (Regenerate/refresh them with
  `image/fetch-weights.sh`.)
- The external path therefore needs **no custom image** — just the stock ollama tar +
  the mounted weights, both already in the bundle.

---

## Bare-metal Linux alternative (in-cluster GPU)

On a **bare-metal Linux GPU host** (not WSL2), the LLM *can* run inside k8s on the
GPU. That recipe is preserved under `baremetal/` (custom CUDA k3s node image + NVIDIA
device-plugin) and the baked-image builder under `image/`. It is an ALTERNATIVE, not
the default — the external container above is the working path on this host and works
everywhere.

**Recipe A — bare-metal Linux, in-cluster (validated by components, not the default):**

```bash
# 1. Build the CUDA-enabled k3s node image (legacy builder — the k3s rootfs COPY
#    trips buildkit):
DOCKER_BUILDKIT=0 docker build -f 0_external/llm/baremetal/Dockerfile.k3s-cuda \
  -t nhdw/k3s-cuda:dev 0_external/llm/baremetal

# 2. Build the baked-weights ollama image (offline seed for the in-cluster PVC):
docker build -t nhdw/ollama-model:dev \
  -f 0_external/llm/image/Dockerfile 0_external/llm/models

# 3. Recreate the cluster WITH the GPU + custom node image (k3d has no way to add a
#    GPU node to a running cluster — it must be created with --gpus):
k3d cluster create nhdw --gpus all --image nhdw/k3s-cuda:dev ...
kubectl apply -f 0_external/llm/baremetal/nvidia-device-plugin.yaml

# 4. Restore the archived in-cluster LLM manifest + re-add it to the kustomize base,
#    then bootstrap. gpu-detect.sh (bare-metal branch) grants it 1 nvidia.com/gpu.
cp _archive/2026-07-06/in-cluster-llm/llm.yaml 1_infrastructure/k8s/base/llm.yaml
# (re-add `- llm.yaml` to base/kustomization.yaml + the nhdw/ollama-model images:
#  remap to overlays/dev/kustomization.yaml, and repoint the gateway OLLAMA_URL back
#  to http://nhdw-llm.nhdw.svc.cluster.local:11434)
```

See `baremetal/README.md` for the full findings (root cause of why a stock k3d
cluster can't schedule GPU, the node-image details, and what was NOT done).
