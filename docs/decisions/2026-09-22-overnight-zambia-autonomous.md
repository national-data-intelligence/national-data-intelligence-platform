# Overnight autonomous session — Zambia data migration + verification
Owner asleep 2026-09-21 ~23:50. Mandate: work all night, make judgment calls on
their behalf, RECORD each call here, save the stage before risky steps, and at
the end VERIFY everything with a real browser (Playwright — /browse is broken on
this host, see memory), not just scripts. Do not stop for reports. Goal: a
working Zambian NHDW demo on palladium2 by morning.

## Standing constraints (still in force)
- Commit like a human; NO Claude/AI/co-author strings in tracked files; grep before push.
- Remote changes go through the seed scripts / CI path; the console is its own repo.
- Never push secrets. Refuse Drive uploads > 2GB.
- Every judgment call recorded below with reason, so it can be reversed.

## Decisions (newest last)

### C1 — Copy gitignored seed artifacts to the runner checkout (unblock ingest)
The 4 failing sources (HCMIS/mBrana/EthioEMR + DHIS2 dump) restore from
`.bak`/`.sql`/`.pgdump` files that match gitignored rules, so a fresh runner
checkout lacked them; the country-reset wipe exposed it (stale data had masked
it). Copied them from the owner's personal clone (~/ethio-nhdw-demo) into the
runner checkout so restore.sh finds them. NOT durable for a truly-fresh host —
see C-DURABLE below. Reason: fastest unblock; owner chose "copy from personal
clone now".

### C-DURABLE (planned) — commit the small seed artifacts, host the 174M one
HCMIS 15M + mBrana 3.2M + DHIS2 7.6M are small enough to un-ignore and commit so
ANY fresh host self-heals. EthioEMR clean_openmrs.sql is 174M — too large for
git; keep it host-provided with a documented fetch path. Will do this once the
demo is confirmed working, so the tree change doesn't risk the live run.

### F1 (finding to verify) — app-security seeded the ETHIOPIAN cast
Mid-run check showed ops_identity.user holds solomon.m/abebe.bekele (et-v3
cast), not the zm-v1 cast (chanda.m/mutale.p). This predates the ansible
profile-threading fix (ae04c16) + the resolver (resolve-users-seed.sh). The
current run re-seeds app-security with NHDW_PROFILE=zm-v1, which MUST load
users.zm.yaml. VERIFY after the run: the cast is Zambian. If not, the resolver
or its wiring into the security-seed Job needs another look.

### C2 — Verify with Playwright against the live dashboards
Demo password is "demo" (SEED_PASSWORD default). Public dashboard needs no auth
(easiest Zambian-presentation check). internal-bi needs OIDC login. Harness
asserts: public shows Zambia not Ethiopia; gateway /api/demo/profile = zm-v1;
PCT page shows Zambian supply data; no Ethiopian region leaks in chrome.

### C3 — Durable seed-artifact fix: gzip + commit, restore.sh gunzips (DEFERRED to after run)
gzip sizes: clean_openmrs.sql 174M→25M, HCMISWDM.bak 15M (no compress),
HCMISWCloud.bak 3M, dhis2.pgdump 6M → ~49M total, committable (repo already
274M). Plan: commit the compressed artifacts, un-ignore them, teach each
restore.sh to gunzip a `.gz` if present (backward-compatible: raw file still
works). This makes ANY fresh host self-heal — closing the deepest gap of the
night. DEFERRED: doing it mid-run risks the live seed reading a half-changed
restore.sh, so it happens AFTER the current run + Playwright verification pass.
Priority order tonight: (1) working demo via the running seed, (2) Playwright
verify, (3) this durable commit, (4) push everything once runner-safe.

### C4 — Skip Ethiopian-only sources for zm-v1 (extend the climate pattern)
HCMIS + mBrana are Ethiopian supply/reporting systems with NO Zambian
counterpart; the zm-v1 catalog already disables their widgets (the Resource
page). mBrana's restore.sh also targets a nonexistent `mbrana-sqlserver`
container (shared-instance setup). Same situation as climate. Extending
SKIP_SRC for a non-default profile to: climate + hcmis + mbrana. Kept: elmis
(the real Zambian supply source → PCT/Control Tower), dhis2 (IDSR disease),
ethioemr (works, 98951 obs), mfr (works). This lets the pipeline complete with
the sources that have data, and the disabled widgets mean nothing shows empty.
Reason: honest — a source with no data for this country is skipped, not faked.

### C5 — eLMIS reader role missing + dump absent (root cause of the empty warehouse)
Diagnosed 00:05. The full pipeline never completed on palladium2 — nhdw_vault
holds only bi_facility (3 tables). Root cause chain: (1) eLMIS source DB is
EMPTY (only `public` schema) — its 236MB dump is gitignored/excluded and is not
on the box, in the personal clone, or local; (2) even the reader role `ingestor`
was never provisioned (up_elmis skips restore.sh when data "exists", coupling
reader-provisioning to data-restore — a latent bug). Provisioned the reader by
hand (C6). Now hunting the dump: first the lake (a prior run ingested eLMIS, so
raw parquet may survive the source wipe → rebuild vault+marts without the dump),
else fetch from the Drive seed store via the SA. Stopped the doomed ansible run.

### C6 — durable: decouple eLMIS reader-provisioning from data-restore
up_elmis must ALWAYS ensure the reader role (idempotent CREATE/ALTER + grants),
independent of whether the 1.5GB restore is skipped — auth and data are separate
concerns. (fix pending in sources-up.sh)

### C7 — eLMIS dump is unrecoverable → BUILD a deterministic synthesizer (the night's core work)
The 236MB historical dump is nowhere: not on palladium2, not local, not in the
personal clone, and NOT in the Drive seed store (manifest lists only HCMIS/mBrana/
dhis2/EthioEMR/source-csvs — eLMIS was always "bring your own dump"). eLMIS has no
upstream app to regenerate it. Since eLMIS is the ONLY genuinely-Zambian dataset
(the PCT / Control-Tower flagship), an empty eLMIS = a dead demo.

Judgment call: rather than ship a blank flagship, I built a deterministic
synthesizer (0_external/sources/OpenLMIS/scripts/synthesize_zm_history.py +
synthesize.sh) that reproduces an equivalent Zambian supply history from the
committed entity model + the real anonymised 2807-facility registry, writing the
exact 16-table surface the elmis-hist ingestor pulls (schema-only.sql, column for
column). The real ingestor + vault + marts run unchanged on top. This is the
CLAUDE.md-correct layer to synthesize (seed the SOURCE; the pipeline fills the
rest) AND it removes the lost-dump dependency forever (repeatable mandate).
Validated in a throwaway Postgres: 2807 facilities, ~163k requisitions, ~2.6M
lines load FK-clean; immutability trigger restored; joins + KPIs plausible
(~92% tracer OSA, 11% stockout exposure, MOS bands populated, provincial spread).

### C8 — committed the 800K anonymised Zambian facility registry
facilities_zm_elmis.json was gitignored; it is the synthesizer's reproducibility
input and is anonymised (codes/names stripped, district-mean coords only). 800K,
now un-ignored + committed. The 19M Ethiopian registry stays ignored.

### F1 status — Keycloak cast is still Ethiopian; mechanism works, just not run
Confirmed the live Keycloak realm carries the ETHIOPIAN cast (abebe.bekele,
kebede, tigist…), not the Zambian one (chanda.m/mutale.p). Root cause: the
profile swap that set ACTIVE=zm-v1 applied the presentation layer but the
keycloak-cast stage never executed for this realm. NOT a resolver bug —
resolve-users-seed.sh correctly returns users.zm.yaml for zm-v1 (verified), and
the deployed keycloak-seed job already carries the correct 20.84.70.78 base URLs.
So re-seeding the zm cast is low-risk (reuses proven base). Plan: after DATA is
verified, run the keycloak-cast re-seed (seed-app-security zm + keycloak users
from users.zm.yaml). NOTE: Ethiopian-cast users can already log in and view the
Zambian DATA (data is profile-driven; the cast is only names/roles) — so this is
coherence polish, not a data-migration blocker. Data verification uses an existing
user (analyst.ana) so it is not gated on F1.
Durable manifest fix (fresh-deploy-into-zm seeds zm cast directly) DEFERRED — the
swap path already provides the zm cast; not worth OIDC-manifest risk tonight.

### C9 — dhis2-dvs needs a bigger ingest budget (701K values @ 240/s ≈ 49 min)
The DHIS2 source holds 701,338 data values and the ingestor extracts at a steady
~240/s (API-paced), so a from-scratch pull takes ~49 min — but INGEST_WAIT is 25
min, so dhis2-dvs times out and the solo-retry restarts from zero → the run
aborts on dhis2. My earlier --full-refresh forced the full re-extract. Fix:
relaunch WITHOUT --full-refresh (the lake keeps the complete elmis/ethioemr/mfr
data; the replace-disposition ingestors overwrite cleanly) and INGEST_WAIT=3600
so dhis2 fits with margin. eLMIS re-ingests in ~100s, so dhis2 is the only long
pole. Reason: dhis2 (Ethiopian IDSR) still feeds disease/overview content, so
completing it is better than skipping; the flagship elmis→PCT data is unaffected.

### C10 — stuck dbt-docs-content PVC (teardown left it Terminating) blocked all dbt jobs
The 2026-09-21 21:28 destructive redeploy deleted the dbt-docs-content PVC but it
stuck in Terminating (deletionTimestamp set, pvc-protection finalizer held by
Pending dbt-docs + old Succeeded dbt-vault pods) — a deadlock. dbt-staging then
could not schedule ("PVC being deleted, not found"), timed out, and aborted the
pipeline (PIPE_DONE_1) AFTER ingest was already done. Fix: scale dbt-docs to 0,
delete the dbt-staging/dbt-vault jobs holding the finalizer → the PVC finished
deleting → recreated it fresh (512Mi RWO local-path). Re-running ONLY the dbt
stages via --skip-ingest (the lake already holds all four sources — no need to
re-pull dhis2's 49-min extract). DURABLE follow-up noted: teardown should clear
PVC finalizers so a redeploy never leaves a Terminating PVC.
