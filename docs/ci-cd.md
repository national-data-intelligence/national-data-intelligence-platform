# CI/CD — push-to-main deploy on k3s

Two GitHub Actions workflows drive the live cluster:

| Workflow | Trigger | What it does | Runs on |
|---|---|---|---|
| `.github/workflows/deploy.yml` | push to `main` (touching apps/dashboards/security seeds) or manual | rebuilds only the **changed** images, imports them into k3s, restarts the affected workloads, reseeds catalog/RBAC when those seeds changed, verifies | self-hosted runner **on the k3s host** (label `nhdw`) |
| `.github/workflows/provision.yml` | manual dispatch | from-bare: installs k3s (+ optional GPU) from the inventory, deploys the Helm chart, runs the full seed | self-hosted runner that can SSH to the target(s) (label `nhdw-control`) |

The redeploy logic lives in `bundle/scripts/ci-redeploy.sh` (also runnable by hand:
`bundle/scripts/ci-redeploy.sh all`), so CI and manual ops share one code path.

## Why a self-hosted runner (not SSH from a cloud runner)
The images are large (the app set is ~14 GB of layers) and the cluster is offline-first
(images are imported into containerd, not pulled from a public registry). A runner **on the
host** builds + `k3s ctr images import`s locally — no registry round-trip, no 14 GB upload per
push. A cloud runner would need a registry (GHCR) + a big push/pull on every change.

## One-time setup (host owner)
On the k3s host (e.g. palladium2):

1. **Install the runner** (Settings → Actions → Runners → New self-hosted runner), give it
   labels `nhdw` (and `nhdw-control` if it also provisions). Run it as the same user that owns
   `~/.kube/config` and is in the `docker` group, with **passwordless sudo** for `k3s ctr`
   (already true on palladium2).
2. **Secrets / variables** (repo → Settings → Secrets and variables → Actions):
   - `NHDW_KUBECONFIG_PATH` *(optional)* — kubeconfig path if not `/home/biniyam/.kube/config`.
   - `NHDW_SSH_KEY` *(provision.yml only)* — private key that can reach the target host(s).
3. **Rotate the exposed credentials** before enabling: the GitHub PAT that was in `.env` and the
   Gmail app-password in `secrets.yaml`. Do NOT commit real secrets — `overlays/dev/secrets.yaml`
   stays gitignored; the runner reads it from the host.

## Data / seeds
Seed data (the 14 GB of source dumps + LLM weights) is **not in git**. The from-bare
`provision.yml` path expects it fetched to the host first (the Google-Drive service-account +
rclone setup, `_workspace/nhdw/…`), or already present. `deploy.yml` only redeploys app images +
reseeds the file-based catalog/RBAC (which ARE in the repo) — it does not re-ingest source data.

## Scope of `deploy.yml` (push to main or develop)
`deploy.yml` deploys **two tiers**:
* **App tier** — rebuilds the affected SPA/gateway images (the gateway build first stages
  `2_pipelines/ml/registry/validators.py` into its context — the staged copy is gitignored, so a
  fresh checkout doesn't carry it), reseeds catalog/RBAC when those seeds change, **regenerates the
  OPA policy** (compile `--from-db` → in-cluster `opa test` gate → publish + reload) when
  `7_security/opa/**` or `bundle/roles/**` change, and only THEN rolls the workloads — the
  gateway's startup self-tests interrogate the live OPA (allow/deny matrix + masking reveal sets)
  and fail-fast on drift, so it must never restart ahead of its policy.
* **Data tier** — applies new/changed Postgres init DDL (idempotent by contract; files that
  `\connect nhdw_ops` are ops-side and do NOT cascade a vault rerun), reloads the `nhdw_ref`
  vocabulary when its seeds change, rebuilds the affected dbt/bridge images, reruns the dbt job
  chain from the earliest affected stage **through `dbt-marts`** (a vault run drops the report
  views until marts rebuilds them, so the chain never stops early), and reruns the **MDM matcher**
  whenever its code changed or the vault content moved.
The run FAILS on: a failed image build, a failed DDL apply, a failed reseed, a failed policy
regen, a rollout that never becomes ready, or an incomplete pipeline Job — never "success" with
a broken step (each of those was once swallowed and has a regression guard now).

**Recovering a failed deploy**: the next push only diffs its OWN commits — a failed run's files
are not retried automatically. Re-apply them with a targeted dispatch:
`gh workflow run deploy.yml -f scope="<space-separated paths>"` (or the Actions UI); `scope=all`
redeploys everything.

Still **not** covered: source-dump reloads, ingestor reruns, new-database `.sh` init files
(boot-only), **k8s manifest changes** (`1_infrastructure/k8s/**` — the overlay render needs the
server-side `secrets.yaml`, so those land through `provision.yml` or a deliberate manual apply),
and secret material (e.g. a new key in `secrets.yaml.template` reaches a live cluster only at
provision/rotation — consumers must degrade safely without it, like `MASKING_HMAC_KEY`).
A push touching only docs/infra outside the path filter deploys nothing.

## Still open (needs the owner)
- Install the self-hosted runner on palladium2 (needs a registration token from the repo).
- Decide GHCR vs local-import: current design is **local-import on the host** (no registry). If a
  multi-host fleet is wanted, add a GHCR push in `build-images.sh` + a pull-through cache (P2.3).
- Prove the from-bare `provision.yml` on a throwaway VM before pointing it at a real host.
