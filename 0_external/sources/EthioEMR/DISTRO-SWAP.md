# EthioEMR distro swap — ✅ COMPLETE 2026-06-09

**LIVE CUTOVER DONE.** `nhdw/ethioemr-openmrs:2.8.3-adama-20250611-fix2` is the working
instance — container `ethioemr-openmrs` on `nhdw_net`, reusing `ethioemr-mysql` (Adama DB).
Verified live: 48/48 modules started; FHIR R4 serves Patient 492, Encounter 2181,
Observation 8061, Condition 2332, Location 1216, Practitioner 109 (all 200); **the seam
`http://ethioemr-openmrs:8080/openmrs/ws/fhir2/R4` returns 200 over nhdw_net** (ingestor
unchanged); DB clean at 2256 changesets / 492 patients. `restart: unless-stopped` set.

**Incident during cutover (resolved):** `swap-emr.sh`'s data-dir backup used `cp … || mv`,
so the dir was never emptied → first boot loaded stale O3 placeholder modules
(patientflags/billing) → Spring context refresh failed (FHIR 500) and the DB advanced to
2303. Recovered: restored DB from `backups/PRECUTOVER-LIVE-openmrs-20260609232243.sql.gz`
→ 2255/492, emptied the data dir, re-`compose up`, clean GREEN. **`swap-emr.sh` patched**
(empties dir after backup + guard that aborts if non-empty). Flag to distro team.

**Rollback still available:** image `nhdw/ethioemr-openmrs:rollback-20260609232600` (old O3
placeholder) + DB dumps in `backups/`.

**Remaining (separate step):** the EthioEMR ingestor `.env` `ETHIOEMR_FHIR_BASE_URL` still
points at public `hapi.fhir.org` — repoint to `http://ethioemr-openmrs:8080/openmrs/ws/fhir2/R4`
when wiring ingestion to this live instance. Optional: disable Adama `scheduled_task_config`
rows for absent modules (muzima/kenyaemrml/insuranceclaims) to quiet the logs.

---

# EthioEMR distro swap — local build → Azure cutover (merged plan)

Replace the current **O3 reference-application placeholder** with the **real hardened
EthioEMR distro**, shipped as a **migration bundle** of prebuilt images (no Maven/npm build
on the VM). Build/test/package on the laptop; on Azure just pull + compose up.

Merges this repo's "stable seam" approach with the external bundle/spec/runbook plan, and
applies the settled facts: **the DB is already done (seeded Adama) and is reused** — so there
is **no DB dump artifact and no DB-restore step** in this version.

Status (2026-06): `ethioemr-mysql` up & healthy, seeded with the real Adama dump
(~492 patients). Only the OpenMRS **app tier** is a placeholder, currently **stopped**.

---

## 0. The final artifact = a bundle, not git archives

`ethioemr-azure-bundle-v1/` containing:

| Artifact | Purpose |
|---|---|
| App images (backend, frontend, gateway) in ACR **or** a `docker save` tar | the real distro, prebuilt |
| `docker-compose.azure.yml` | `image:` refs only — **no `build:`**, Linux paths, env vars |
| Content snapshot | content/config repo at a **pinned commit** (mounted or baked) |
| `.env.azure` | DB creds, ports, API keys (no Maven secrets) |
| Runbook | step-by-step cutover (see §4) |
| ~~DB dump~~ | **N/A — DB already seeded & reused.** Keep one only as a backup, not a deploy input |

The two repos on disk D are **inputs to building the bundle**, not the bundle itself.

---

## 1. The contract — the seam every downstream system uses

The stack touches the EMR through exactly one seam:

```
http://ethioemr-openmrs:8080/openmrs/ws/fhir2/R4   (over docker network nhdw_net)
```

Multi-image reality: the distro is **backend + frontend + gateway** (+ DB). FHIR R4 is
served by the **backend**. So give the **backend** container the name/alias
**`ethioemr-openmrs`** on **`nhdw_net`**, internal port **8080** → the ingestor `.env`
(`ETHIOEMR_FHIR_BASE_URL`) needs **zero change**. The frontend/gateway (`/openmrs/spa` UI)
is for humans and is irrelevant to the seam.

| Requirement | Value |
|---|---|
| Network | join external `nhdw_net` |
| FHIR host:port (backend) | `ethioemr-openmrs:8080` |
| FHIR R4 path | `/openmrs/ws/fhir2/R4/` (incl. `/metadata`) |
| REST path | `/openmrs/ws/rest/v1` |
| DB | point backend at the **existing** `ethioemr-mysql` |

---

## 2. Deployment Specification (fill before building)

1. **Target env:** Azure VM (Ubuntu, Docker ready), IP `172.209.208.42`, HTTPS? open ports
   (UI vs FHIR-only). Single instance = source-system role.
2. **Data strategy:** ✅ **settled — reuse the seeded Adama `ethioemr-mysql`.** No empty-seed,
   no fresh restore. Backend connects to existing DB with existing creds.
3. **Image strategy:** ACR tags e.g. `myacr.azurecr.io/ethioemr-backend:2026-06-09` (+frontend,
   +gateway), **or** `docker save` tars + `scp -O`. ⚠ Building the **backend** needs the
   Initializer/Maven **PAT** — laptop build-time only, never on Azure. No PAT → use already-built
   images or get them/the PAT from the distro owner (Palladium).
4. **Content/metadata:** path on VM `./configuration/backend_configuration` (or as the distro
   expects); **pin to a commit** so metadata doesn't drift. Mounted vs baked — decide.
5. **Runtime config:** DB creds, `OPENFN_API_KEY` if used, port mapping (e.g. host `8081`→ UI,
   keep backend `8080` internal on `nhdw_net`). **Change `Admin123`** before it's network-facing.
6. **Integration surface:** base URL downstream calls (the seam above), auth (service user /
   Basic), APIs (REST + FHIR2).
7. **Acceptance criteria:** UI loads at `/openmrs/spa`; login works; a sample Adama
   patient/encounter is visible; FHIR `/metadata` + a sample resource pull return 200; ingestor
   smoke test passes.

---

## 3. Prepare locally (laptop) — Phases A→C

- **A — Build & verify:** `build-hardened.ps1`; `docker compose up` against a local copy of the
  Adama DB (or the real one); verify UI + API + metadata loaded.
- **B — Package:** tag images → push to ACR (or `docker save`); export `docker-compose.azure.yml`
  + `.env.azure`; export content at the pinned commit. (No DB dump in the bundle — reused.)
- **C — Handoff:** assemble `ethioemr-azure-bundle-v1/`; write the runbook.

Ship via: ACR `docker push`, **or** `docker save` → `scp -O "D:\...\*.tar"
abenezer@172.209.208.42:/data/sources/EthioEMR/incoming/` (legacy `-O` is mandatory on this VM).
With 3–4 images, ACR is the tidier path.

---

## 4. Cutover on the VM (runbook — what I run)

1. `docker load` the tars (or `az acr login` + `docker compose pull`).
2. Drop in `docker-compose.azure.yml`: image refs only; **delete any bundled `mysql` service**
   and point the backend at the existing `ethioemr-mysql`; backend name/alias `ethioemr-openmrs`,
   internal `8080`, on `nhdw_net`; wire content mount if mounted.
3. Stop **only** the old placeholder app tier (leave `ethioemr-mysql` running). `up -d` the new tier.
4. Acceptance (§2.7): FHIR `/metadata` 200 → `/openmrs/spa` loads → login → sample patient →
   ingestor smoke test.
5. On success: keep old image tagged for rollback; park a `docker save` backup on `/data`; prune
   the old image + any **duplicate** mysql volume the distro may have created.
6. Commit the **recipe only** (compose + configs) to git; image bytes stay out (GitHub free LFS).

---

## 5. Footprint / cost (measured 2026-06)

Reused as-is: `mysql:8.0` image (1.1 GB) + Adama volume (1.6 GB on `/data`). Net-new = only the
app images. A ~6–8 GB swap on `/` (57 GB free) — non-issue. "Duplicate is fine, handle after":
prefer pointing the new backend at the existing DB (no duplicate); if one appears, prune
post-acceptance. Durable copy = ACR or `.tar` on `/data` (persistent disk, **not** `/mnt`).

---

## Locked decisions (2026-06)
- Content: **mounted** → `/data/sources/EthioEMR/content/configuration/backend_configuration`
- Delivery: **`docker save` + `scp -O`** now; ACR deferred to Phase 5
- Build: **laptop only** (`~/.m2/settings.xml` present); server never builds
- Image scope: **backend only** — no frontend/gateway on VM
- Image tag: **`nhdw/ethioemr-openmrs:2.8.3-adama-20250609`** (tar ~787 MB)
- DB: **reuse `ethioemr-mysql`** (Adama, ~492 patients) — do not replace
- Network: keep **`ethioemr-openmrs:8080`** — ingestor `.env` unchanged
- Admin: **`admin/Admin123` through cutover**; rotate in Phase 2 after updating
  `2_pipelines/ingestor/EthioEMR/.env`

## Version parity result (queried live, 2026-06)
`openmrs.version`/`database_version` global_property rows are **absent** in the dump (not
persisted). Authoritative fingerprint = **core liquibase changelog**: migrated through
**platform 2.8.x** (`liquibase-update-to-latest-2.5.x→2.8.x`, latest core changeset
`TRUNK-6354-2025-10-22`), **325 tables**, MySQL **8.0.46**. ⇒ parity with `2.8.3-adama`
backend ✅ (no core migration on boot). **Caveat:** dump is a **KenyaEMR-family** distro
(`kenyaemr.version 19.3.1-SNAPSHOT`; idgen 2.4.1, metadatasharing, spreadsheetimport 0.5.18,
groovy, openelis, orderexpansion) — backend image must bake the **same module set** or those
modules' Liquibase runs on boot. Confirm module manifest before cutover.

## VM landing paths — READY (writable by scp user `abenezer`)
`/data/sources/EthioEMR/{incoming,content,compose,scripts}/` created; parents granted `o+x`
traversal only (no read) so `scp -O` as `abenezer` works.

## Dry-run #1 result (2026-06-09) — RED, cutover blocked
Isolated clone-boot (`scripts/dryrun-cutover.sh`) against a clone of the live Adama DB.
Found and cleared, in order:
1. **Data-dir perms** — image runs as **uid 1001**; bind-mounted `/openmrs/data` owned by
   abenezer(1002,700) → `rm: /openmrs/data/modules/* Permission denied`, startup aborts.
   Fix: `chown 1001:1001` the data dir. **Must add to `swap-emr.sh` (it does `chmod 755`).**
2. **Content-dir perms** — content mount owned 1002/700 → `cp: cannot stat
   /openmrs/distribution/openmrs_config Permission denied`. Fix: `chmod -R a+rX` the content
   tree + `o+x` on its parents. **Must add to the runbook (live swap mounts the same path).**
3. 🔴 **BLOCKER — distro image bug:** module **`kenyaemrml`** (ML in KenyaEMR) fails on first
   boot — its `liquibase.xml` runs a changeset referencing `sql/sp_iitml_get_visits.sql`,
   which is **not packaged in the omod** (`ModuleException: Unable to update data model`).
   That failure closes the Hibernate `EntityManagerFactory` → cascade ("EntityManagerFactory
   is closed") across appointments/reporting/orderexpansion/appframework → **FHIR HTTP 500**.
   Nothing committed (changelog stayed 2255) — so **idgen 2.4.1→4.15 migration AND the
   initializer content-load were never reached; they remain UNTESTED behind this failure.**
   Log: `dryrun/RED-kenyaemrml-boot-fail.log` (4388 lines).

**Resolution needed (distro team, image rebuild):** either (a) fix `kenyaemrml` packaging to
include `sql/sp_iitml_get_visits.sql`, or (b) **drop `kenyaemrml` from the distro** if it's not
needed for the FHIR source-system role (KenyaEMR IIT-ML risk scoring almost certainly isn't) —
check no other module depends on it; its `kenyaemr_ml_*` tables become harmless orphans.
**Then re-run the dry-run** — the EMF cascade masks any further module/idgen/initializer issues,
so expect 1–2 more iterations. Snapshot kept: `backups/openmrs-precutover-*.sql.gz` (58 MB).

## Dry-run #2 result (2026-06-09, image `…-fix1`) — RED, new blocker
fix1 (kenyaemrml dropped) cleared round-1's blockers; boot got **further** but failed deeper.
- Caught a **false-positive readiness probe**: `curl -sf …/fhir2/R4/metadata` returns 0 on the
  **302 OpenMRS serves mid-boot** → declares "up" ~20s in. Hardened our gate to require an
  authenticated **FHIR Patient count = HTTP 200**. ⚠️ The distro **compose healthcheck uses the
  same weak `curl -sf …/metadata`** → would mark "healthy" minutes early on the live swap. Fix it.
- 🔴 **BLOCKER #2 — distro image bean-wiring bug:** the **`initializer`** module
  (`initializer-api-2.11.1-SNAPSHOT`) fails to start — `LocationTagListParser` constructor-injects
  `LocationService`, but the module stack exposes **two** beans (`locationServiceTarget` +
  `locationService`, i.e. an AOP target+proxy — `addresshierarchy` is the usual advisor) →
  `NoUniqueBeanDefinitionException` → **Spring context refresh cancelled** → EMF closed → cascade →
  `fhir2` never registers → FHIR `/Patient` 404 (22×). Log: `dryrun/RED-initializer-locationservice.log`.
  Deterministic; would fail the live swap identically.

**Resolution (distro team, image rebuild):** fix the initializer wiring — add `@Qualifier("locationService")`
to `LocationTagListParser` (or otherwise disambiguate), **or** patch/bump the initializer, **or** identify
the module adding the `LocationService` AOP advice (likely addresshierarchy) and adjust. Dropping
initializer is risky (other modules may depend on it) and the Adama DB is already fully populated, so
content-apply isn't strictly needed for the FHIR source role — a no-initializer variant is an option to
weigh. **Re-dry-run after the fix** (this failure still masks idgen 2.4.1→4.15 + content-apply, both
UNTESTED). Snapshot kept: `backups/openmrs-precutover-*.sql.gz`.

## Dry-run #3 result (2026-06-09, image `…-fix2`) — ✅ GREEN, cutover cleared
fix2 (kenyaemrml + initializer both dropped, healthcheck fixed) boots clean. Verified on the clone:
- **48/48 modules started, 0 failed** (per OpenMRS REST `/module`) — incl. `fhir2`, `idgen`, `kenyaemr`.
- **FHIR R4 serves real Adama data** (authenticated HTTP 200): Patient 492, Encounter 2181,
  Observation 8120, Condition 2332, Location 1216, Practitioner 109. REST session auth 200.
- **idgen scare resolved:** module started fine; **no destructive 2.4.1→4.15 migration** ran (only
  1 trivial changeset on boot, 2255→2256). `idgen.database_version=2.4.1` is a stale cosmetic prop.
- Residual = **18 non-fatal** scheduled-task warnings for modules not in the image
  (muzima/kenyaemrml/insuranceclaims — Adama `scheduled_task_config` rows); harmless for extraction.
  Optional cleanup: disable those task rows post-cutover to keep logs clean.
- Boot reached readiness in ~80s. Log: `dryrun/GREEN-fix2-boot.log`.

**→ Cleared for live swap.** Pre-reqs all validated: `swap-emr.sh` has the perm fixes (chown 1001
data, chmod a+rX content) + the hardened Patient-count healthcheck. Live procedure: fresh
`mysqldump` of real `openmrs` (rollback) → `swap-emr.sh` (loads fix2, swaps behind
`ethioemr-openmrs:8080` on nhdw_net, reuses ethioemr-mysql) → acceptance (FHIR resources above) →
ingestor smoke. Rollback = restore the mysqldump (or original `adama_dump_backup.sql`) + re-tag old image.

## Cutover open items
- [ ] Backend image **module manifest** == dump's module stack? (only remaining parity risk)
- [ ] Clear/back-up the stale placeholder `/data/sources/EthioEMR/data/openmrs` before first
      boot of the real backend (avoid stale module jars), or confirm image is self-contained
- [ ] Review `swap-emr.sh` against our env before running
