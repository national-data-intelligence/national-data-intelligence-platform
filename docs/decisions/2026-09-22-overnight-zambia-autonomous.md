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
