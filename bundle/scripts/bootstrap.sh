#!/usr/bin/env bash
# bootstrap.sh — THE canonical entry point. Cold-boot the whole NHDW demo into a
# k3d Kubernetes cluster and seed it to a demoable state. Kubernetes only.
#
# ONE seeding mode (the data tiers — sources/lake/vault/marts): bring up + seed
# the EXTERNAL source replicas (sources-up.sh), then pull them through the real
# dlt ingestors and run the real dbt pipeline (source → lake → ClickHouse →
# bridge → vault → marts). Only the SOURCES are seeded; everything downstream is
# produced by the pipeline — a snapshot-restore "speedy" mode existed once but
# violated that principle and was retired 2026-07-02 (see _archive).
#
# The APP/SECURITY state (ops DB, RBAC model, workshop groups, Keycloak realms)
# is NOT pipeline-derivable, so it is always seeded from files.
#
# Image strategy (no registry): build (or load from the offline cache) and
# `k3d image import` the nhdw/*:dev images; the dev overlay remaps the manifests'
# registry names to those local images with imagePullPolicy: IfNotPresent.
#
# Usage:
#   bootstrap.sh                       # full rebuild: sources → ingest → pipeline
#   bootstrap.sh --rebuild-images      # force a rebuild of the nhdw images
#   bootstrap.sh --offline             # load images from the offline cache tars
#   bootstrap.sh teardown              # delete cluster + stop sources (clean slate)
#   bootstrap.sh teardown --keep-cluster   # just `kubectl delete -k` the overlay
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPTS="$REPO/bundle/scripts"
OVERLAY="$REPO/1_infrastructure/k8s/overlays/dev"
CLUSTER=nhdw
NS=nhdw
export PATH="$HOME/.local/bin:$PATH"

REBUILD_IMAGES=0
OFFLINE=0
case "${1:-}" in
  teardown)
    shift
    if [ "${1:-}" = "--keep-cluster" ]; then
      echo "▸ deleting the dev overlay (keeping cluster ${CLUSTER})"
      kubectl delete -k "$OVERLAY" --ignore-not-found 2>&1 | tail -5
    else
      echo "▸ deleting k3d cluster ${CLUSTER} (all state)"
      k3d cluster delete "$CLUSTER"
      # The external source replicas are compose stacks OUTSIDE the cluster.
      # Default: stop them but KEEP their volumes (restore/seed is idempotent
      # and the next rebuild is fast — DHIS2 alone saves ~15-20 min).
      # --wipe-sources: `compose down -v` — the TRUE factory reset that proves
      # the bundle can initialise on a fresh machine (every source re-seeds
      # from the bundle's own seed data, nothing survives).
      if [ "${1:-}" = "--wipe-sources" ]; then
        echo "▸ stopping external source replicas + WIPING their volumes (factory reset)"
        bash "$SCRIPTS/sources-up.sh" down --wipe
      else
        echo "▸ stopping external source replicas (volumes kept — pass --wipe-sources for a factory reset)"
        bash "$SCRIPTS/sources-up.sh" down
      fi
    fi
    exit 0 ;;
esac
FAST_BOOT=0
for a in "$@"; do case "$a" in
  --rebuild-images) REBUILD_IMAGES=1 ;;
  --offline) OFFLINE=1 ;;
  # --fast: restore the OPTIONAL derived snapshot (bundle/state/derived) instead
  # of re-deriving marts through the pipeline. A CACHE for quick spin-ups — falls
  # back to the full pipeline if no snapshot is packed. The DEFAULT boot (no
  # flag) is byte-identical to before: always re-derives from source (the truth,
  # and the integration test). Produce the snapshot with pack.sh --with-derived.
  --fast) FAST_BOOT=1; export NHDW_FAST_BOOT=1 ;;
  -h|--help) sed -n '1,30p' "$0"; exit 0 ;;
  *) echo "unknown arg: $a" >&2; exit 2 ;;
esac; done
rm -f /tmp/nhdw-fast-boot.flag   # restore-state writes it iff the snapshot restores

step() { echo; echo "── $* ──"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "FATAL: missing $1" >&2; exit 1; }; }

# ─── 1. tools ──────────────────────────────────────────────────────────────
step "1 · tools"
need docker; need kubectl; need python3
docker info >/dev/null 2>&1 || { echo "FATAL: docker daemon not running"; exit 2; }
if ! command -v k3d >/dev/null; then
  echo "  installing k3d → ~/.local/bin"; mkdir -p ~/.local/bin
  curl -sfL https://github.com/k3d-io/k3d/releases/download/v5.7.5/k3d-linux-amd64 -o ~/.local/bin/k3d
  chmod +x ~/.local/bin/k3d
fi
if ! command -v kustomize >/dev/null; then
  echo "  installing kustomize → ~/.local/bin"
  curl -sfL https://github.com/kubernetes-sigs/kustomize/releases/download/kustomize/v5.4.3/kustomize_v5.4.3_linux_amd64.tar.gz | tar -xz -C ~/.local/bin kustomize
fi

# ─── 2. cluster (host 80/443 → Traefik, so the *.127.0.0.1.nip.io ingress works) ─
step "2 · k3d cluster ${CLUSTER}"
if k3d cluster list 2>/dev/null | awk '{print $1}' | grep -qx "$CLUSTER"; then
  echo "  cluster exists — reusing"
else
  # Pass the host GPU into the cluster when one is present. NOTE: the assistant LLM
  # is EXTERNAL now (0_external/llm/) and gets its GPU from its OWN container
  # (sources-up.sh layers docker-compose.gpu.yml) — NOT from the cluster. This
  # passthrough is kept only for the bare-metal-Linux IN-CLUSTER GPU recipe
  # (0_external/llm/baremetal/, which also needs the custom nhdw/k3s-cuda node
  # image). On WSL2 in-cluster GPU can't work at all, so the flag is a harmless
  # no-op there. CPU-only machines skip it.
  GPU_FLAG=""
  if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
    echo "  ▸ host GPU detected — passing --gpus all to k3d (external ollama uses the GPU directly)"
    GPU_FLAG="--gpus all"
  fi
  # #38: flannel OFF — Cilium is the CNI (Hubble gives the topology page real
  # per-pod flow metrics, incl. controller-less lab pods coroot could not see).
  # k3d --wait is satisfied by the k3s process (node stays NotReady until the
  # Cilium install right below; coredns/traefik Pend briefly and then recover).
  k3d cluster create "$CLUSTER" --servers 1 --agents 1 $GPU_FLAG \
    --port "80:80@loadbalancer" --port "443:443@loadbalancer" \
    --k3s-arg "--disable=metrics-server@server:0" \
    --k3s-arg "--flannel-backend=none@server:0" \
    --k3s-arg "--disable-network-policy@server:0" --wait

  # ── Cilium CNI + Hubble (#38) — from the BUNDLED chart + image tars ────────
  echo "  ▸ installing Cilium CNI + Hubble (bundled chart)"
  # bpf/cgroup2 mounts the agent needs inside the k3d node containers
  for n in $(docker ps --format '{{.Names}}' | grep "k3d-$CLUSTER-" | grep -v serverlb); do
    docker exec "$n" sh -c \
      "mount bpffs -t bpf /sys/fs/bpf 2>/dev/null; mount --make-shared /sys/fs/bpf 2>/dev/null; \
       mkdir -p /run/cilium/cgroupv2; mount -t cgroup2 none /run/cilium/cgroupv2 2>/dev/null; \
       mount --make-shared /run/cilium/cgroupv2 2>/dev/null" || true
  done
  # pre-import the cilium images so an OFFLINE boot never pulls
  for t in "$REPO"/bundle/images/cilium_*.tar; do
    [ -f "$t" ] || continue
    docker load -i "$t" >/dev/null 2>&1 || true
  done
  CIL_IMGS=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^(quay.io/)?cilium/' | head -6)
  [ -n "$CIL_IMGS" ] && k3d image import $CIL_IMGS -c "$CLUSTER" >/dev/null 2>&1 || true
  HELM="$REPO/bundle/bin/helm"
  if [ ! -x "$HELM" ]; then
    # bundle/bin ships binaries in the zip, not git (same as mc) — network
    # fallback for a bare checkout, LOUDLY (fix the bundle).
    echo "  ! bundle/bin/helm missing — downloading (FIX THE BUNDLE)" >&2
    mkdir -p "$REPO/bundle/bin"
    curl -fsSL --max-time 180 https://get.helm.sh/helm-v3.16.4-linux-amd64.tar.gz \
      | tar -xzO linux-amd64/helm > "$HELM" && chmod +x "$HELM" || true
  fi
  CHART=$(ls "$REPO"/bundle/charts/cilium-*.tgz 2>/dev/null | head -1)
  if [ -x "$HELM" ] && [ -n "$CHART" ]; then
    # useDigest=false everywhere: the chart pins images @sha256 by default, which
    # BYPASSES the tag-imported bundle tars and forces slow network pulls (found
    # on first boot: agent stuck Pulling past the 300s window). envoy embedded
    # (no separate DaemonSet) = one fewer image to bundle.
    "$HELM" upgrade --install cilium "$CHART" -n kube-system \
      --set operator.replicas=1 \
      --set ipam.mode=kubernetes \
      --set image.pullPolicy=IfNotPresent --set image.useDigest=false \
      --set operator.image.pullPolicy=IfNotPresent --set operator.image.useDigest=false \
      --set envoy.enabled=false \
      --set hubble.enabled=true \
      --set hubble.relay.enabled=true \
      --set hubble.relay.image.pullPolicy=IfNotPresent --set hubble.relay.image.useDigest=false \
      --set prometheus.enabled=true \
      --set "hubble.metrics.enabled={flow:sourceContext=workload-name|pod-name;destinationContext=workload-name|pod-name;labelsContext=source_namespace\,destination_namespace,tcp:sourceContext=workload-name|pod-name;destinationContext=workload-name|pod-name;labelsContext=source_namespace\,destination_namespace,drop:sourceContext=workload-name|pod-name;destinationContext=workload-name|pod-name;labelsContext=source_namespace\,destination_namespace,dns}" \
      >/dev/null
    echo "  ▸ waiting for the Cilium agent to be ready (CNI comes up now)"
    # 600s, not 300s: on a TRUE cold boot (fresh cluster, images just loaded, BPF/
    # cgroup2 mounts, WSL2) the agent DaemonSet needs ~5-6 min to roll out — the
    # 300s window timed out ~45s short and false-aborted a boot whose Cilium was
    # actually fine (cold-boot validation 2026-07-11). Warm re-boots still finish fast.
    kubectl -n kube-system rollout status ds/cilium --timeout=600s \
      && echo "  ✓ Cilium CNI ready (Hubble metrics on :9965)" \
      || { echo "  ✗ Cilium failed to come up — aborting boot (revert: tag coroot-baseline-2026-07-10)"; exit 1; }
  else
    echo "  ✗ bundled helm/chart missing (bundle/bin/helm + bundle/charts/cilium-*.tgz) — cannot install CNI"; exit 1
  fi
  # NVIDIA k8s device-plugin — advertises nvidia.com/gpu for the BARE-METAL in-cluster
  # recipe only (stock k3s node can't enumerate GPUs without the custom CUDA node
  # image, and WSL2 can't at all). Best-effort; failure never blocks boot. The
  # DEFAULT LLM path (external ollama) does not depend on this.
  if [ -n "$GPU_FLAG" ]; then
    kubectl apply -f https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/v0.16.2/deployments/static/nvidia-device-plugin.yml \
      2>/dev/null && echo "  ✓ NVIDIA device plugin applied (bare-metal in-cluster GPU only)" \
      || echo "  ! device-plugin apply failed/absent — irrelevant to the external LLM"
  fi
fi

# ─── 3. images: load the pre-baked bundle (all images shipped as tars) → k3d ─
# The release zip pre-bakes every image (heavy open-source + the built nhdw/*),
# so a cold boot just loads the tars and imports them — no registry pulls, no
# build step. --rebuild-images is the maintainer path that rebuilds nhdw/* first.
step "3 · images"
if [ "$REBUILD_IMAGES" = 1 ]; then
  echo "  --rebuild-images: building nhdw/* from source, then loading public tars"
  bash "$SCRIPTS/build-images.sh" --import
  bash "$SCRIPTS/cache-images.sh" --load-only 2>/dev/null || true
elif ls "$REPO"/bundle/images/*.tar >/dev/null 2>&1; then
  echo "  loading all pre-baked images from bundle/images (offline)"
  bash "$SCRIPTS/cache-images.sh" --load-only
else
  echo "  no bundle tars found — building nhdw/* + pulling public images (needs internet)"
  bash "$SCRIPTS/build-images.sh" --import
  bash "$SCRIPTS/cache-images.sh" 2>/dev/null || true
fi

# ─── 4. apply the dev overlay (manifests + secrets + ingress) ───────────────
# Render secrets.yaml from the committed template with per-deploy random values
# if it does not already exist (a fresh checkout has none; a shipped bundle
# carries one). Never clobbers an existing file → a warm re-boot keeps the
# passwords the live databases were initialised with. Inject real Google/Gmail
# creds by exporting GOOGLE_CLIENT_ID / SMTP_USER / … before bootstrap.
step "4 · kustomize apply (overlays/dev)"
bash "$SCRIPTS/gen-secrets.sh"
# Locally-trusted wildcard TLS (nhdw-wildcard-tls) so the browser stops warning;
# the CA persists in bundle/tls so you import it into your browser only once.
bash "$SCRIPTS/gen-tls.sh" || echo "  ! gen-tls.sh failed (dev falls back to traefik self-signed)"
kustomize build --load-restrictor=LoadRestrictionsNone "$OVERLAY" | kubectl apply -f -

# NOTE (#78, 2026-07-11): the headlamp SA-bearer injection USED to be a Traefik
# headers middleware created here (ensure-headlamp-auth). It moved INTO the
# headlamp-gate (nhdw/tool-gate): the gate mounts the headlamp-token secret and
# injects the bearer on every proxied HTTP/WS request (INJECT_BEARER_FILE), so no
# boot-time middleware is needed. The gate reads the token file per-request, so a
# late-populated secret is picked up automatically. See tool-gates.yaml.

# Point the gateway at the right assistant model for the EXTERNAL ollama: 14b when
# the host has a GPU (nvidia-smi), else 3b. sources-up.sh (step 6) brings up that
# external ollama with the matching GPU/CPU compose. Best-effort — never blocks boot.
bash "$SCRIPTS/gpu-detect.sh" "$NS" 2>/dev/null || true

# metrics-server (kube-system) — applied SEPARATELY, not via the overlay, because
# the overlay pins namespace=nhdw and would rewrite it out of kube-system. It
# backs `kubectl top` + the gateway HPA (scalability demo §4.9). k3s's bundled
# copy is disabled at cluster-create; this is the explicit, offline-cached one.
kubectl apply -f "$REPO/1_infrastructure/k8s/base/metrics-server.yaml"

step "5 · wait for postgres-vault + keycloak-seed"
for i in $(seq 1 30); do
  [ "$(kubectl -n "$NS" get pod postgres-vault-0 -o jsonpath='{.status.containerStatuses[0].ready}' 2>/dev/null || true)" = "true" ] && break
  sleep 5
done
echo "  postgres-vault ready"
kubectl -n "$NS" wait --for=condition=complete job/keycloak-seed --timeout=420s 2>/dev/null \
  && echo "  keycloak-seed complete" || echo "  ! keycloak-seed not complete (inspect: kubectl -n $NS logs job/keycloak-seed)"

# MinIO console OIDC (#79) — MinIO does a ONE-SHOT OpenID init at startup and
# never retries. On a cold boot it starts before Keycloak is reachable, the init
# fails ("connection refused") and the console SSO button is then silently
# absent. Now that keycloak-seed has completed (the minio-console client exists),
# restart MinIO IFF its OIDC init failed, so the console advertises NHDW SSO.
if kubectl -n "$NS" logs deploy/minio-datalake --tail=400 2>/dev/null | grep -q 'Unable to initialize OpenID'; then
  kubectl -n "$NS" rollout restart deploy/minio-datalake >/dev/null 2>&1 \
    && kubectl -n "$NS" rollout status deploy/minio-datalake --timeout=120s >/dev/null 2>&1 \
    && echo "  ✓ minio-datalake restarted — console OIDC re-initialised" \
    || echo "  ! minio-datalake OIDC re-init restart failed (console SSO may be off)" >&2
else
  echo "  minio-datalake console OIDC already initialised ✓"
fi

# ─── 5.5 packed runtime state (optional — factory bundles have none) ────────
step "5.5 · packed state (bundle/state — restored before seeds, if present)"
bash "$SCRIPTS/restore-state.sh"

# ─── 6. seed the DATA tiers (sources → ingestors → dbt pipeline) ────────────
step "6 · DATA seed (sources → ingestors → dbt pipeline)"

# The in-cluster ingestors reach the host-published source ports via
# host.k3d.internal — an entry k3d ITSELF injects into CoreDNS at cluster
# creation. VERIFY-ONLY here (never patch — orchestration must not mutate
# system config): if it is missing the cluster is malformed; recreate it.
if kubectl -n kube-system get cm coredns -o jsonpath='{.data.NodeHosts}' 2>/dev/null \
    | grep -q 'host\.k3d\.internal'; then
  echo "  host.k3d.internal present in CoreDNS NodeHosts ✓"
else
  echo "  ✗ host.k3d.internal missing from CoreDNS — the k3d cluster is malformed."
  echo "    Recreate it: bootstrap.sh teardown && bootstrap.sh   (k3d injects the entry at creation)"
  exit 1
fi

# Bring up + restore/seed the external source replicas the ingestors pull from.
# (Sources come up in BOTH modes — the app/access flows need the live replicas,
# and the fast-boot cache still wants a source of truth to reconcile against.)
bash "$SCRIPTS/sources-up.sh" up

# The DATA tier is the point of the boot — a failed seed must FAIL the boot
# loudly (previously the boot printed DONE over a dead data tier).
# FAST BOOT: if restore-state restored the derived snapshot, SKIP the pipeline
# (marts are already in place). No snapshot present → fall through to the full
# pipeline. The DEFAULT (no --fast) always runs the full pipeline = the truth.
if [ "$FAST_BOOT" = 1 ] && [ -f /tmp/nhdw-fast-boot.flag ]; then
  echo "  ⚡ FAST BOOT — marts restored from the derived snapshot; SKIPPING the"
  echo "     ingestion + dbt pipeline. Run WITHOUT --fast to re-derive from source"
  echo "     (the source of truth; a full rebuild reconciles the cache)."
else
  [ "$FAST_BOOT" = 1 ] && echo "  (--fast requested but no derived snapshot packed — running the full pipeline)"
  bash "$SCRIPTS/seed-realistic.sh" || { echo; echo "✗ DATA seed FAILED — the boot is NOT demoable. See the errors above."; exit 1; }
fi

# ─── 7. seed the APP/SECURITY state (never pipeline-derivable) ──────────────
# Same contract as the data seed: a boot without the RBAC/user model is NOT
# demoable, so a failed app/security seed must fail the boot loudly.
step "7 · APP/SECURITY seed (RBAC + workshop groups — from files)"
bash "$SCRIPTS/seed-app-security.sh" || { echo; echo "✗ APP/SECURITY seed FAILED — the boot is NOT demoable. See the errors above."; exit 1; }

# ─── 7.1 · gateway restart — the gateway runs an OPA self-test at startup that
# needs the mart_attrs catalog step 7 just seeded. It is deployed with the
# manifests (step 4), so on a cold boot it starts against an EMPTY catalog,
# fail-closes, and CrashLoopBackOffs. Force it to re-run the self-test now that
# the catalog exists, and GATE the gateway-driven seeds below (7.55/7.57/7.6) on
# it being Ready — otherwise they race a not-yet-recovered gateway and time out.
step "7.1 · restart gateway (its OPA self-test needs the step-7 catalog)"
kubectl -n "$NS" rollout restart deploy/nhdw-gateway >/dev/null 2>&1 || true
kubectl -n "$NS" rollout status deploy/nhdw-gateway --timeout=180s \
  || { echo; echo "✗ gateway not Ready after the security seed (OPA self-test likely still failing — see 'kubectl -n $NS logs deploy/nhdw-gateway')."; exit 1; }

# ─── 7.05 · docs seed (docs/*.md → MinIO nhdw-docs, served via /gw/docs) ─────
# Publishes the curated operator docs into MinIO so the admin Documentation page
# can open/download them; idempotent + reboot-persistent. Non-fatal to the demo
# itself, but gate on it so a missing doc surfaces loudly.
step "7.05 · docs seed (docs/*.md → MinIO nhdw-docs)"
bash "$SCRIPTS/seed-docs.sh" || { echo; echo "✗ docs seed FAILED — the Documentation page will be empty. See the errors above."; exit 1; }

# ─── 7.5 · ML seed (packages → registry → first predictions) ────────────────
# Convergent like every other seed: models already @champion (restored state /
# re-boots) are skipped, so this is cheap on warm boots and complete on cold.
# Forecast widgets have data from day one (no empty-until-first-schedule gap).
step "7.5 · ML seed (bundle/seeds/ml → MLflow registry → ops_ml.ml_predictions)"
bash "$SCRIPTS/seed-ml.sh" || { echo; echo "✗ ML seed FAILED — forecast widgets will be empty. See the errors above."; exit 1; }

# ─── 7.55 · projects + datasets seed (real /api/projects + /api/datasets) ────
# Owner rule: nothing (dataset or model) exists without a PROJECT. Creates the
# demo projects + generated datasets by driving the real gateway APIs (the
# dataset generator runs the governed SQL chain against the freshly-built
# marts). Runs BEFORE the graduation seed, whose submits bind to these
# projects. Convergent; a failure means the workshop is not demoable.
step "7.55 · projects + datasets seed (real /api/projects + /api/datasets APIs)"
bash "$SCRIPTS/seed-projects.sh" || { echo; echo "✗ projects/datasets seed FAILED — the workshop is not demoable. See the errors above."; exit 1; }

# ─── 7.57 · resource-request seed (real request + admin-decide gateway API) ──
# Leaves the compute review queue with a back-traced pending + approved request,
# driving the same /api/workspace/resource-request + .../decide endpoints a
# workshop user + admin use (never by INSERTing rows). Convergent; a failure
# means the admin compute-review queue has no demo content, so gate on it.
step "7.57 · resource-request seed (real /api/workspace/resource-request + decide APIs)"
bash "$SCRIPTS/seed-resource-requests.sh" || { echo; echo "✗ resource-request seed FAILED — the compute review queue is not demoable. See the errors above."; exit 1; }

# ─── 7.6 · graduation seed (PROJECT-centric review flow, real gateway API) ───
# Populates the project-review lifecycle HONESTLY — drives the same
# submit / approve / reject endpoints a contributor + reviewer use, never by
# INSERTing project / project_review rows. Leaves 3 example community projects
# (1 approved+public with its model integrated into the catalogue via the #45
# hook, 1 in_review feeding the reviewer queue, 1 changes_requested). Runs
# AFTER the projects (7.55) + ML (7.5) seeds and needs the gateway up AND the
# seeded users (step 7 — owner/reviewer are FK'd to ops_identity.user).
# Convergent (keys off each project's actual review_status); a failure means the
# review flow + community-model catalogue are not demoable, so gate the boot.
step "7.6 · graduation seed (bundle/seeds/project-review → real submit/approve/reject API)"
bash "$SCRIPTS/seed-graduation.sh" || { echo; echo "✗ graduation seed FAILED — the review flow / model catalogue is not demoable. See the errors above."; exit 1; }

# (7.7 demo widget-plugin RETIRED 2026-07-06 — the runtime-swappable-plugin
# system was removed platform-wide; every dashboard widget is now a foldered
# build-time module. Archived to _archive/2026-07-06/runtime-plugin-system/.)

# ─── 8. done ────────────────────────────────────────────────────────────────
step "8 · DONE — NHDW demo is up"
cat <<EOF

  Dashboards (HTTPS, self-signed — accept the cert):
    Public        https://public.127.0.0.1.nip.io/
    Internal BI   https://internal-bi.127.0.0.1.nip.io/
    Admin         https://admin.127.0.0.1.nip.io/
    Workshop      https://workshop.127.0.0.1.nip.io/
    Keycloak      https://keycloak.127.0.0.1.nip.io/
    Gateway       https://gateway.127.0.0.1.nip.io/health
    MLflow        https://mlflow.127.0.0.1.nip.io/

  Sign in: tadesse.h / NhdwDemo2026.OK   (R-DEC on moh-staff)
  Teardown:  bootstrap.sh teardown
EOF
