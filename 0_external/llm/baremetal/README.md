# Bare-metal Linux in-cluster GPU recipe (qwen2.5:14b)

This directory holds the **bare-metal Linux** recipe for running the chatbot LLM
(ollama) on an NVIDIA GPU **inside the k8s cluster**. It exists because a stock k3d
cluster **cannot** schedule GPU workloads.

> **This is the ALTERNATIVE, not the default.** The default LLM runtime is the
> **external** ollama container in the parent folder
> (`0_external/llm/docker-compose.yml`), which is the ONLY working GPU path on WSL2
> and works everywhere. Use this bare-metal recipe only on a real Linux GPU host that
> wants the LLM in-cluster. Full instructions: `../README.md` (Recipe A).

Everything here was validated on the target host (RTX 5080 Laptop, 16 GB,
Blackwell **sm_120**, WSL2) on 2026-07-06. Findings are recorded verbatim so the
next person does not re-derive them.

## TL;DR verdicts

- **ollama 0.6.8 already supports Blackwell (sm_120).** No newer image is needed.
  A `docker run --gpus all ollama/ollama:0.6.8` offloads qwen2.5:14b fully to the
  GPU: log shows `library=cuda variant=v12 compute=12.0`, the compiled CUDA arch
  list includes `1200`, `offloaded 49/49 layers to GPU`, 8.1 GB CUDA buffer.
  Throughput: **25.4 tok/s on GPU vs 1.29 tok/s on CPU (~20x)** for 14b.
- **In-cluster GPU works on bare-metal Linux** with the custom node image +
  device plugin below.
- **In-cluster GPU does NOT work on WSL2** — CUDA cannot initialise inside a
  nested k3d node→pod (`cuInit` → error 304 `CUDA_ERROR_OPERATING_SYSTEM` +
  SIGSEGV), and the device plugin can't enumerate GPUs (NVML "Not Supported").
  On WSL2, run the LLM from an **external** `docker --gpus all` container.

## Why the stock cluster can't do GPU (root cause)

`k3d cluster create --gpus all` passes the GPU into the node *container*, but the
stock `rancher/k3s` node image has **no NVIDIA Container Toolkit**, so:
1. k3s containerd has no `nvidia` runtime, and
2. the NVIDIA k8s device-plugin logs `Incompatible strategy detected auto` /
   `No devices found` and never advertises `nvidia.com/gpu`.

`k3d node create` has **no `--gpus` flag** (v5.9.0), so a GPU node cannot be added
to an existing cluster — enabling GPU always requires `k3d cluster create` (a full
cluster recreate).

## Files

- `Dockerfile.k3s-cuda` — a `rancher/k3s` node image with the NVIDIA Container
  Toolkit baked in (build: `nhdw/k3s-cuda:dev`). With this image k3s
  auto-configures the `nvidia` containerd runtime + a `nvidia` RuntimeClass at
  boot. Build with the **legacy** builder (the k3s rootfs `COPY` trips buildkit):
  `DOCKER_BUILDKIT=0 docker build -f Dockerfile.k3s-cuda -t nhdw/k3s-cuda:dev .`
- `nvidia-device-plugin.yaml` — the device-plugin DaemonSet (bare-metal only;
  runs with `runtimeClassName: nvidia`). Applied separately by bootstrap on a GPU
  host, like metrics-server.

## Recipe A — bare-metal Linux GPU host (in-cluster)

    # 1. custom CUDA k3s node image + the baked-weights ollama image
    DOCKER_BUILDKIT=0 docker build -f Dockerfile.k3s-cuda -t nhdw/k3s-cuda:dev .
    docker build -t nhdw/ollama-model:dev -f ../image/Dockerfile ../models
    # 2. recreate the cluster WITH the GPU + node image, add the device plugin
    k3d cluster create nhdw --gpus all --image nhdw/k3s-cuda:dev ...
    kubectl apply -f 0_external/llm/baremetal/nvidia-device-plugin.yaml
    # 3. restore the archived in-cluster LLM manifest + re-wire it (see ../README.md):
    cp _archive/2026-07-06/in-cluster-llm/llm.yaml 1_infrastructure/k8s/base/llm.yaml
    #    - re-add `- llm.yaml` to base/kustomization.yaml
    #    - re-add the nhdw/ollama-model images: remap to overlays/dev/kustomization.yaml
    #    - repoint the gateway OLLAMA_URL to http://nhdw-llm.nhdw.svc.cluster.local:11434
    #    - grant the in-cluster ollama pod resources.limits.nvidia.com/gpu: 1
    #      (the in-cluster GPU patch was removed from gpu-detect.sh when the LLM moved
    #       external — gpu-detect.sh now only picks the model for the external container)

## The default path (WSL2 + everywhere): external container

CUDA cannot init inside a nested k3d pod on WSL2, so the LLM is served OUTSIDE k8s
(the same "external world reached via host.k3d.internal" pattern the source replicas
use). That path is now the DEFAULT and is fully wired — it lives in the parent folder:
`../docker-compose.yml` (+ `../docker-compose.gpu.yml`), brought up by
`bundle/scripts/sources-up.sh`. Proven to serve 14b at ~25 tok/s on the RTX 5080. See
`../README.md`.

## What was NOT done (and why)

- No recreate of the live `nhdw` cluster (the external path does not need one; and on
  WSL2 an in-cluster GPU recreate would not help anyway).
- Recipe A is validated by components (the node image + device plugin + baked image),
  not end-to-end here, because this host is WSL2 where the external path is used.
