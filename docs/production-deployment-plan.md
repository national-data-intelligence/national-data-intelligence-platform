# Production-grade deployment plan — config-driven, fleet-or-single-node, seed-decoupled

> **Status: ACTIVE — phased build.** Goal: evolve NHDW from a single-host k3d demo into a
> **portable, production-deployable package** where the operator declares the host fleet in a
> **config file** and one command deploys it — on **one node or many, local or remote** — with
> **seed data fully decoupled** from the system so seeds can be swapped/updated without touching
> the applications and without breaking the system.

## 1. Requirements (owner, 2026-07)
- Production-grade, not "demo-grade bash". Using Helm/Ansible/Terraform is part of the showcase
  — **but only where they genuinely fit** (no forced tooling).
- **Seeds separate from the system:** independently change/update the seed data without changing
  system applications; a mismatched seed must fail cleanly, not corrupt the system.
- **One package, any topology:** works on a single laptop OR a fleet, local OR remote — the
  difference is *configuration only*.
- **Define the host machines in a config file**; the deploy targets that fleet.

## 2. Current-state diagnosis (measured)
Bring-up is one bash orchestrator (`bootstrap.sh`, 474 LOC, 18 phases) + ~21 scripts (~3,500 LOC).
Command mix: `kubectl` 180, `docker`/`k3d` 55/34, `curl`/`mc`/`psql` 31/28/27, `kustomize`/`helm` 8/3.

- **Already production-shaped (keep):** k8s layer is declarative (kustomize); Cilium is Helm; the
  data pipeline is ordered **k8s Jobs**; the offline-bundle concept is sound.
- **Three gaps that read as "demo-grade":**
  1. **Single-host lock-in** — `k3d cluster create` runs "nodes" as containers on one Docker host;
     it cannot target a real multi-machine fleet.
  2. **Imperative orchestration** — implicit ordering, hand-rolled idempotency, no host abstraction.
  3. **Coupled seed mechanism** — seed *data* already lives in `bundle/seeds/**` + `sample-data/`,
     but the *what/order/compatibility* is embedded in bash (e.g. `seed-app-security.sh` hard-codes
     `for sql in 17_perm_schemas.sql 23_perm_admin_grants.sql …`). **No manifest / version /
     compatibility contract** anywhere.

## 3. Tool verdict (honest — no forced tooling)
| Tool | Fit | Why |
|---|---|---|
| **Ansible** | ✅ the answer | Its **inventory file** *is* "define the host fleet in a config"; a playbook deploys to it (1..N, local/remote over SSH). Owns provisioning + orchestration + templated config + seeding. |
| **k3d → k3s** | ✅ pivotal | k3d can't do a real fleet; **k3s** (same Kubernetes) installs on 1 laptop or N machines, air-gaps, same manifests. k3d may stay as a dev fast-path. |
| **Helm** | ✅ yes | Production workload packaging; **values files** = the single-vs-fleet knob (replicas, storage class, sizing, affinity). |
| **Terraform** | ⚠️ **unnecessary for the stated goal** | You deploy to *pre-existing* hosts; Terraform's job is to *create* cloud infra. Add only a thin front-stage IF the package must provision cloud VMs itself. |
| **GitOps (ArgoCD/Flux)** | 🔸 day-2, future | Gold-standard for *continuously operating a persistent cluster* (audit, drift-heal, PR-based rollback). Assumes a long-lived cluster + git; heavier to air-gap. Phase 5+. Mental model: **Ansible = day-0/1, GitOps = day-2+.** |

## 4. Target architecture — five layers
```
inventory.yml  ← operator edits this: control_plane + workers, local or remote; topology=single|fleet
   │
1. PROVISION   Ansible role → installs k3s (server+agents) + Cilium across the inventory
               (single laptop = 1-host inventory; fleet = N hosts; SAME code path)
   │   (optional Terraform stage BEFORE this — only to *create* cloud VMs)
2. WORKLOADS   Helm umbrella chart (our apps) + values-<topology>.yaml (Cilium already Helm)
3. SEED PACK   ← decoupled, versioned artifact (§5) — the main goal
4. IMAGES      cache-first + remote-fallback via k3s pre-import + registries.yaml mirror /
               a pull-through cache (§6) — config, not code
5. ORCHESTRATE Ansible playbook = new entrypoint: provision → deploy → seed-source → seed-app →
               verify. Ordered dbt pipeline stays as k8s Jobs invoked by a role.
```
Laptop → fleet is **one edit** (inventory) + a values-file choice.

## 5. Seed-pack design (the main goal, in depth)
Principle: **system = schema + apps + a generic seed *engine* (stable); seed pack = data
(swappable, versioned).**
```
seed-pack/
├── manifest.yaml                 ← THE contract (missing today)
│     seed_pack_version: 2026.07.1
│     targets_system: ">=1.4.0"   ← engine REFUSES a mismatched pack (fail-fast, no corruption)
│     order:                      ← ordering lives HERE, not in a bash for-loop
│       - {target: source/ethioemr, kind: mysql-dump, file: sources/ethioemr/clean_openmrs.sql}
│       - {target: app/security,    kind: sql,        glob: app/security/*.sql}
│       - {target: app/keycloak,    kind: kcadm,      file: app/keycloak/realms.yaml}
│       - {target: app/ml,          kind: api,        dir:  app/ml/}
├── sources/…   (external-replica dumps — from 0_external/sources/*/sample-data)
└── app/…       (security, keycloak, ml, projects, articles — from bundle/seeds/**)
```
- **Generic seed engine** (versioned with the system): reads the manifest, validates
  `targets_system` against the deployed version, applies each entry idempotently through an
  adapter (`mysql-dump` / `sql` / `kcadm` / `mc` / `api`). Engine = *how*; pack = *what/order/
  compatibility*.
- **Swap/update independence:** new data → new pack (bump version) → `deploy --seeds-only`; no app
  rebuild, no script edit. demo/staging/prod = different packs, same system.
- **Migration is low-risk** because the data already exists; the work is (a) write the manifest
  that's currently implicit in the scripts, (b) replace the seed scripts' hard-coded lists with
  the engine. **DDL/migrations stay with the apps (schema = system); only *data* moves to the pack.**

## 6. Image sourcing — cache-first, remote-fallback (standard, not a hack)
Keep image refs **canonical + immutable** (`registry/nhdw/<x>:<version>` or `@sha256:…`, **not**
`:dev`). Vary only per environment:
- **Local/offline:** k3s auto-imports `bundle/images/*.tar` into containerd; `imagePullPolicy:
  IfNotPresent` uses them; missing → pull from the configured mirror. (k3s-native.)
- **Remote/fleet:** a shared **pull-through cache registry** (Zot/Harbor/`registry` proxy) that
  serves from cache and fetches-on-miss from upstream; containerd `registries.yaml` mirrors to it.
- Registry/tag → **Helm values**; pre-seed/mirror → an **Ansible provisioning step** per inventory.
  Same manifests everywhere; only registry config + pre-seed differ. The one required cleanup:
  drop mutable `:dev` tags for versioned refs (also needed by the Helm-values story).

## 7. Phased plan (each phase independently shippable; demo never breaks)
- **P1 — Seed-pack** (highest value, lowest risk, no topology change): manifest schema + generic
  engine + compatibility gate; migrate existing seed data + logic into the pack; keep `bootstrap.sh`
  working by having it call the engine. Verify a full boot still seeds identically.
- **P2 — Image sourcing:** versioned tags + registry refs; k3s-style pre-import + `registries.yaml`
  mirror; optional pull-through cache. Verify offline + online pulls.
- **P3 — Helm-package the apps:** convert kustomize bases to an umbrella chart + `values-single`
  / `values-fleet`. Verify parity with current kustomize output.
- **P4 — Ansible playbook + inventory:** wrap provision→deploy→seed→verify as roles; inventory
  drives it. Single-node inventory reproduces today's laptop boot.
- **P5 — k3d → k3s:** swap the provisioning role to install k3s from the inventory; prove a real
  2-node fleet AND a single node from the same code path.
- **P6 — (optional) Terraform** front-stage for cloud-VM creation; **(optional) GitOps** day-2 for
  a persistent install.

## 8. Open decision (blocks only P6, not P1–P5)
**Does the package ever need to *create* the machines (cloud VMs) itself, or will hosts always
pre-exist (laptop / bare-metal / existing VMs)?** Pre-existing → Ansible+k3s+Helm, no Terraform.
Must create cloud infra → add the thin Terraform front-stage in P6.
