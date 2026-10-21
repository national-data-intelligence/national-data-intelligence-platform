# 2026-10-16 — One shared LLM + re-home EMR under the single 443 door

Infra work on palladium2 (public 20.84.70.78, node/traefik 172.16.0.4, NSG opens only 443).
Follows [[nhdw-shared-443-front-door]] and [[palladium-console-state]].

## Running decision log

### Reconnaissance (verified live, before any change)

Hardware:
- GPU: **single Tesla T4, 15360 MiB** (sm_75 / Turing, fp16 only, no bf16).
- CPU: AMD EPYC 7V12, 16 cores. RAM: 108 GiB (82 free). Disk: 200 GiB free.
- At start the T4 was **~12.7 GiB occupied by one process: `VLLM::EngineCore`** (the EMR vLLM). Only ~2.6 GiB free — a second 14B model cannot be GPU-resident alongside it.

LLM backends found (the task's names were approximate — reality):
- **ollama**: docker container `nhdw-ollama` (`ollama/ollama:0.6.8`), host `0.0.0.0:11434`, **GPU access granted** (DeviceRequests nvidia, all GPUs). Models already pulled: `qwen2.5:14b` (Q4_K_M, 14.8B, 9.0 GB) and `qwen2.5:3b`. `ollama ps` showed nothing loaded (loads on demand). On docker net `llm_llm_net` (172.18.0.2). This is NHDW's real LLM backend. There is **no** `nhdw-ollama` k8s Service — the gateway reaches it over the host.
- **vLLM**: docker `ethioemr-ai-llm-1` (`vllm/vllm-openai:v0.31.0`), host `127.0.0.1:8000`, serving **`Qwen/Qwen3-8B-AWQ`** (fp16, max-model-len 12288, gpu-mem-util 0.90 → the 12.7 GiB). Bearer-key auth (`VLLM_API_KEY`). This is the EMR AI assistant's backend.

Wiring verified:
- **NHDW gateway** (`deploy/nhdw-gateway`, ns nhdw) env: `OLLAMA_URL=http://host.k3d.internal:11434`, `NHDW_LLM_MODEL=qwen2.5:14b`, `NHDW_LLM_KEEP_ALIVE=24h`. `host.k3d.internal` **does** resolve to 172.16.0.4 from inside the gateway pod, and `GET /api/tags` from the pod returns the model list. So NHDW→ollama already works; NHDW already points at the shared engine. `172.16.0.4:11434` also works from the pod.
- **EMR ai-service** (`ethioemr-ai-ai-service-1`, FastAPI `ethioemr-ai-service`, host 127.0.0.1:8766) is a clean **OpenAI-compatible** client: POSTs `{base}/chat/completions`, GETs `{base}/models`, env `LLM_BASE_URL=http://llm:8000/v1`, `LLM_MODEL=Qwen/Qwen3-8B-AWQ`. It sends `chat_template_kwargs.enable_thinking=false` and (default) `response_format: json_schema`, but **retries without structured output on HTTP 400** (`ai_service/llm.py` `_post`: modes `[structured, "off"]`). So it tolerates any OpenAI-ish server, incl. ollama. ai-service **can reach `http://172.16.0.4:11434`** (tested: `/api/version` → `0.6.8`).
- No OpenMRS web/frontend container runs on this host; the EMR AI service is standalone (consumed by an OpenMRS elsewhere). So no on-host OpenMRS base-URL to edit — only the EMR `.env` CORS entry.

Old/colliding EMR hostnames (from `/home/biniyam/ethioemr-mlops/.env`): `mlflow.`/`s3.` collide with NHDW's `ing-mlflow`/`ing-s3`; `files.`/`label.`/`ai.` don't collide but still move to `emr-*`. EMR is currently OFF the public door (caddy on 9443, NSG only opens 443) so nothing public breaks by re-homing.

Infra confirmed for the courier mirror: console courier = Ingress `ing-palladium-console` (annotation `router.entrypoints: websecure`, TLS `secretName: nhdw-wildcard-tls`) + selector-less Service `palladium-console-ext` (ClusterIP 8099) + EndpointSlice → 172.16.0.4. Traefik CRD `serverstransports.traefik.io` is installed. Wildcard TLS secret `nhdw-wildcard-tls` covers one label deep (`emr-*` OK).

### Decisions

1. **Shared LLM = the existing `nhdw-ollama` container, model `qwen2.5:14b`, GPU-backed.**
   Rationale: owner steered to promote the existing ollama rather than stand up a second engine; ollama is project-agnostic (dynamic model load, OpenAI `/v1` + native `/api`), already GPU-capable, already NHDW's backend, and `qwen2.5:14b` (the owner-named Qwen2.5-14B-Instruct) is **already pulled** — no re-pull. 14B Q4 (~9 GB) is the most intelligent model that fits a 15 GB T4 with room for KV cache and runs at usable speed. Kept the container name `nhdw-ollama` (renaming would force a container recreate and risk the model volume) but treat it as the shared service and document it as such; exposed additionally at `llm.20.84.70.78.nip.io`.
2. **Retire the EMR vLLM engine to free the GPU for ollama.** One T4 cannot hold two 14B/8B models. After repointing EMR AI at ollama and verifying it answers, stop the vLLM container and disable it reversibly (compose `profiles`, `restart: "no"`, drop `ai-service.depends_on`). Reversible: `docker compose --profile vllm up -d llm`; weights stay in `./hf-cache`.
3. **EMR re-home routing = mirror the console courier but with an HTTPS backend.** Keep EMR caddy on 9443 with `tls internal` (so the EMR apps keep seeing `X-Forwarded-Proto: https` and don't break CSRF/URL generation). Add one Traefik `ServersTransport` (`insecureSkipVerify: true`, `serverName: emr-mlflow.20.84.70.78.nip.io`) + one selector-less Service `emr-caddy-ext` (9443, annotated `serversscheme: https` + that transport) + EndpointSlice → 172.16.0.4:9443 + five Ingresses (`ing-emr-{mlflow,s3,files,label,ai}`). Caddy routes by Host header, so one shared cert/SNI is fine.

### Execution (done 2026-10-16)

**Shared LLM**
- Kept the existing `nhdw-ollama` docker container as the ONE shared engine (GPU, `qwen2.5:14b`, already pulled — no re-pull). It is reachable by both consumers over the host.
- Added a clean cluster-internal name for it (additive, no public exposure): namespace `shared-llm`, selector-less Service `ollama` + EndpointSlice → `172.16.0.4:11434` (manifest `2026-10-16-shared-llm-service.yaml`). Any in-cluster project can now use `http://ollama.shared-llm.svc.cluster.local:11434` (native) or `.../v1` (OpenAI). Verified from the gateway pod → `{"version":"0.6.8"}`.
- **No public `llm.*` ingress** — ollama is unauthenticated and the NSG opens 443 to the internet, so a public ingress would be an open GPU-LLM abuse vector. The two consumers reach it over the host, so public exposure is unnecessary. (Documented in the service manifest; add an Ingress + basic-auth middleware only if ever wanted.)
- **NHDW gateway**: unchanged. It already points at the shared ollama (`OLLAMA_URL=http://host.k3d.internal:11434`, `NHDW_LLM_MODEL=qwen2.5:14b`). Verified reachable from the gateway pod.
- **EMR ai-service**: repointed from vLLM to the shared ollama. `/home/biniyam/ethioemr-ai/docker-compose.yml` ai-service env now `LLM_BASE_URL=http://172.16.0.4:11434/v1`, `LLM_MODEL=qwen2.5:14b`; `depends_on: [llm]` commented out. Container recreated.
- **vLLM retired (in config, reversibly)**: in the same compose the `llm` service moved under `profiles: ["vllm"]` with `restart: "no"`, so `docker compose up` no longer starts it. Re-enable: `docker compose --profile vllm up -d llm` (weights stay in `./hf-cache`).
  - **LEFT FOR OWNER:** the *running* `ethioemr-ai-llm-1` container (still holding ~12.7 GiB of the T4) was NOT stopped — the harness blocked `docker stop/rm` (classifier: "interfere with workloads"). Until it is stopped, ollama's 14B loads on **CPU** (~6-7 tok/s; model load ~55 s cold). One reversible command frees the GPU: `sudo docker rm -f ethioemr-ai-llm-1` (it will not come back — compose profile + restart:no). After that, ollama's first request moves qwen2.5:14b onto the GPU.

**EMR re-home**
- `/home/biniyam/ethioemr-mlops/.env`: `MLOPS_HOST_{MLFLOW,S3,FILES,LABEL,AI}` renamed to `emr-*.20.84.70.78.nip.io`; `MLFLOW_ALLOWED_HOSTS` mlflow entries → `emr-mlflow...`. `MLOPS_HTTPS_PORT=9443`, `MLOPS_TLS_MODE=internal` left as-is. Recreated caddy + mlflow + label-studio.
- `/home/biniyam/ethioemr-ai/.env`: CORS origin `ai.` → `emr-ai.`.
- Backups: every edited file saved as `<file>.bak-1792173232` (owner/mode preserved).
- Courier applied (manifest `2026-10-16-emr-courier.yaml`), all in ns `nhdw`, ADDITIVE: ServersTransport `emr-caddy` (insecureSkipVerify, serverName=emr-mlflow...), selector-less Service `emr-caddy-ext` (9443, serversscheme=https + serverstransport annotations), EndpointSlice → 172.16.0.4:9443, Ingresses `ing-emr-{mlflow,s3,files,label,ai}` (websecure, TLS `nhdw-wildcard-tls`).

### Final hostname map
| Host (`.20.84.70.78.nip.io`) | Routes to | Evidence (off-node curl via 443) |
|---|---|---|
| emr-mlflow | EMR mlflow | 401 `WWW-Authenticate: Basic realm="mlflow"` |
| emr-s3     | EMR seaweedfs S3 | 403 (S3 no-creds) |
| emr-files  | EMR seaweedfs filer UI | 401 (Caddy basic_auth) |
| emr-label  | EMR label-studio | 302 → `/user/login/` |
| emr-ai     | EMR ai-service | `/health` 200, `llm.reachable=true, model=qwen2.5:14b` |
| (unchanged) console / internal-bi / mlflow / s3 / keycloak | NHDW | 200 / 200 / 307 / 200 / 302 — unbroken |

### Verified
- All 5 `emr-*` hosts answer through the shared 443 door from a genuinely off-node client (this workstation, via nip.io → 20.84.70.78); backends confirmed genuine (EMR, not NHDW).
- NHDW hosts still answer (additive guarantee holds; no NHDW ingress/service/console touched).
- **EMR AI assistant end-to-end**: `POST https://emr-ai.../v1/help/answer` → 200, coherent clinical answer with RAG citations, `model=qwen2.5:14b` (full chain traefik→caddy→ai-service→shared ollama).
- **Shared ollama**: generates (`/api/generate` → "PONG") and does **native `/api/chat` tool-calling** (emitted a correct `run_sql` tool_call) — the exact protocol the NHDW gateway assistant uses. Reachable from the gateway pod via `host.k3d.internal`, `172.16.0.4`, and `ollama.shared-llm.svc`.
- **NHDW BI assistant end-to-end (real browser, Playwright)**: logged into `https://internal-bi.20.84.70.78.nip.io/` via Keycloak (realm `moh-staff`, client `internal-bi`) as `admin`/`Admin@2026`; opened the assistant; asked "How many facilities are there in total?"; answer: **"There are a total of 888 facilities… from a query against bi_public.bi_facility_distribution_public"** via **3 tool calls** (the full gateway→ollama tool-calling + SQL loop). ~200 s round-trip (CPU — see GPU note). Screenshots: `bi-01..04` in the session scratchpad. So the NHDW assistant answers end-to-end on the shared ollama.

### Not verified / left for owner
- Stopping the running vLLM container to free the GPU (harness-blocked; command above). Until then ollama runs on CPU.
- Public `llm.*` ingress intentionally omitted (security).

</content>
