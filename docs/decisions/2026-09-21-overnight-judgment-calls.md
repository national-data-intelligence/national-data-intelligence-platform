# Judgment calls made autonomously, 2026-09-21 (overnight)

The owner delegated decision authority for this session on the condition that every
call is recorded here — what was decided, why, what the alternative was, and how to
reverse it. Nothing below is settled policy; each is reversible.

Newest last.

---

## 1. Ran the cold-boot test against the EXISTING host, not a bare one

**Decided.** Ran `provision.yml` (ansible `site.yml`) against palladium2 as it
stood — a 45-day-old machine with Docker, k3s and a live deployment — rather than
wiping it first.

**Why.** "From bare" is where the playbook has never been exercised, but wiping the
host would destroy the only environment both tracks work in, and re-provisioning an
existing machine is the realistic operation anyway (it is what a redeploy does). It
also surfaces idempotency defects a truly bare run would hide — and it did: the
Docker apt-source conflict only exists on a host that already had Docker.

**Alternative.** Wipe to bare metal first for a purist test.

**Reverse.** Nothing to undo; if a bare test is wanted, do it on a throwaway VM
(the plan already recommends proving from-bare on a throwaway before a real host).

---

## 2. Fixed provisioning defects in place rather than reporting and stopping

**Decided.** Each failure the cold boot surfaced was fixed and re-run immediately:
missing ansible collections, `ansible-galaxy` not on PATH, the Docker apt
`Signed-By` conflict, that repair's ordering, and `nhdw_helm` pointing at a
gitignored `bundle/bin/helm`.

**Why.** The mandate is to finish the test; a test that stops at the first defect
proves nothing. Each fix is small, root-cause, and independently reversible.

**Alternative.** Collect all failures and present them for approval first.

**Reverse.** Each is a separate commit under `1_infrastructure/ansible/` and
`.github/workflows/provision.yml`; revert individually.

---

## 3. CI detects undeployed manifests instead of applying them

**Decided.** Built a manifest-apply step for CI, then removed it in favour of a
drift *detector* that fails the run naming any declared workload absent from the
cluster.

**Why.** A server-side dry run showed the committed overlay renders
`*.127.0.0.1.nip.io` ingresses against a cluster serving `*.20.84.70.78.nip.io`,
and the gateway's issuer list as `http://127.0.0.1:8090/realms/...` against a live
`https://keycloak.<host>/realms/...`. Applying it would have taken every dashboard
offline and broken JWT validation. A blanket host substitution cannot repair the
issuer form. Secrets were a second hazard: `kubectl apply` replaces a Secret's data
wholesale, which would have deleted operator-patched keys (the OpenMetadata
ingestion-bot token).

**Alternative.** Teach CI the full host transformation so it can apply safely —
substantial work duplicating what provisioning already does.

**Reverse.** The detector is one block in `bundle/scripts/ci-redeploy.sh`; delete
it, or replace with an apply once the overlay is host-parameterised.

---

## 4. Person/patient MDM deliberately not built

**Decided.** Investigated and declined to build it; recorded the correction in the
plan instead.

**Why.** Only one source carries persons, so there is nothing to conform; the only
attributes reaching the warehouse are gender and birth date (1484 distinct pairs
across 1500 patients), which would manufacture false merges; and the PII that would
make demographic matching work is stripped at the lake by design. The right design
when a second person-bearing source exists is a keyed pseudonymous linkage token
computed at the source — which needs an owner decision, not more code.

**Alternative.** Build a demographic matcher now and accept the false positives.

**Reverse.** Nothing built to remove; the design note is in
`data-layer-enhancement-plan.md` under "Data gaps".

---

## 5. Release pinning reads a session setting, not a dbt variable

**Decided.** `v_facility_resolution_asof` takes its instant from
`SET nhdw.release_as_of`, falling back to the compile-time var.

**Why.** With a dbt var, reproducing a release means re-running the warehouse —
reproduction becomes a deployment, and the deployed view can only ever answer
"now". A session setting makes one deployed view answer any point in time.

**Alternative.** Keep the build-time var and re-run dbt per release.

**Reverse.** Drop the `_asof` CTE's `current_setting(...)` back to the bare var.

---

## 6. eLMIS timeliness is measured; the other six stay NULL

**Decided.** Wired a real `timeliness_pct` for eLMIS into `mart_data_quality` and
left it NULL for DHIS2, HCMIS, mBrana, EthioEMR, MFR and Climate.

**Why.** The handoff listed permanently-NULL timeliness as an open item needing a
source-side change. Profiling showed that is true for six sources — their arrival
columns hold the bulk load instant (DHIS2 `created`: 143 distinct values across
701,338 rows, all within a five-minute window on the seed date), so any percentage
computed from them would describe the loader, not the reporter. eLMIS is genuinely
different: 73,925 distinct submission times across 73,926 requisitions, spread over
a year, with a realistic lag distribution. Publishing a number for the six would be
fabrication; withholding one for eLMIS was leaving real evidence unused.

**Alternative.** Synthesise plausible arrival stamps in the six generators so every
source shows a timeliness figure. That is still the right eventual fix for the
generators, but it manufactures the measurement rather than observing it.

**Reverse.** Delete the `elmis` CTE from `mart_data_quality.sql` and drop
`eLMIS-hist` from the `source` accepted-values test.

---

## 7. The DQ mart reads the existing eLMIS model rather than recomputing

**Decided.** After first writing an independent computation, replaced it with a
roll-up of `mart_elmis_hist_timeliness`, and moved that model's hardcoded
`interval '15 days'` onto the `reporting_deadlines` seed.

**Why.** That model already defined on-time for this warehouse, and its 79.8% /
9-day-median baseline is a documented regression anchor. Two computations would have
been two definitions, free to drift. Fixing the deadline at the contract's source
also means a steward changes it in one place instead of editing SQL. Parity was
checked against the live warehouse before and after: 105 rows compared, 0
differences, 79.8% unchanged.

**Alternative.** Keep the independent computation in the DQ mart (it also excluded
INITIATED/SKIPPED requisitions, which is arguably more precise — but precision that
disagrees with the published baseline is a regression, not an improvement).

**Reverse.** Restore `interval '15 days'` in `mart_elmis_hist_timeliness.sql` and
drop the `reporting_deadlines` cross join.

---

## 8. eLMIS is excluded from the public transparency scorecard

**Decided.** `mart_public_data_quality` filters out `eLMIS-hist`.

**Why.** It is a Zambian historical archive carried for supply-chain feature work;
the data dictionary already marks it internal-dashboards-only and notes it never
joins the entity model. It reaching the national Open Data page would present
another country's reporting record as Ethiopia's. The internal surfaces still show
it, correctly labelled.

**Alternative.** Publish it and rely on the label to disambiguate.

**Reverse.** Delete the `AND source <> 'eLMIS-hist'` line.

---

## 9. The fail-open classification scan raises an incident on its own

**Decided.** The DQ detector now runs the unclassified-column scan and raises a
`classification_gap` flag; the scan moved into a function the steward endpoint and
the detector share.

**Why.** Masking is a denylist, so an unclassified sensitive column is served in the
clear. The gap was discoverable, but only by a steward who went looking — which
makes the one silent failure mode of the masking design the one thing nothing
watched. One flag per scan rather than per column, because the work item is
reviewing the list and per-column flags would swamp the queue on a rename.

**Alternative.** Leave it on-demand and rely on review discipline.

**Reverse.** Drop `_detect_classification_gaps` and its call in `_run_detection`.

---

## 10. Provision and deploy share one concurrency group

**Decided.** Both workflows moved from separate groups to `nhdw-cluster`.

**Why.** They drive helm against the same release on the same host. Separate groups
let a push-triggered redeploy start while a provision is mid-flight, racing two
`helm upgrade`s on one cluster. Queuing rather than cancelling, because an
interrupted deploy leaves worse state than a slow one.

**Alternative.** Leave them independent and rely on not triggering both at once.

**Reverse.** Restore the two original group names.

---

## 11. Archived the artifact-centric graduation test rather than rewriting it

**Decided.** Moved `test_graduation_flow.sh` to
`_archive/2026-09-21/graduation-artifact-centric-test/` with a README, instead of
porting its 17 assertions to the project-centric endpoints.

**Why.** It drives `/api/graduation/submit` and `/queue`, retired when graduation
became project-centric. Every request 404s, so all 17 assertions fail against a
perfectly healthy system — it reads as a broken subsystem and cost real time during
this sweep before the 404s explained themselves. Leaving it in place is exactly the
stale-artifact failure the archive rule exists to prevent. Porting it is a genuine
rewrite of paths and payloads against an API I would have to learn, and
`verify-system` check 6d already proves the review lifecycle ran through the real
endpoints.

**What this loses, recorded rather than dropped.** 6d only proves the ALLOW path.
Still uncovered: the deny half of each gate, the `artifact_review` writers, the
`personal → shared` tier move, the `rejected` terminal state, the real sha256 on
`artifact_version`, input hardening (bad kind → 400, promote-before-validate → 409),
and the draft-detail authz gate. The README lists all of it.

**Alternative.** Port it now — more coverage, but a rewrite against an unfamiliar
surface during a verification pass.

**Reverse.** The file is intact in `_archive/`; restoring means rewriting its
request paths, not un-archiving as-is.

---

## 12. Two unrun regression suites now run on every deploy

**Decided.** `verify-system.sh` gained a check 9 that executes the masking
negative-path test and the public access-request test.

**Why.** Both existed as complete, working regression suites that nothing invoked —
not CI, not verify-system, not provisioning. That is how a fail-open on the Supply
Control Tower coordinates survived a deploy: the startup self-tests check role →
masked set, the policy half was always correct, and nothing ever asked what a
low-trust caller actually received. A test nobody runs is documentation.

**Cost accepted.** Two live HTTP suites add roughly a minute to every deploy, and
the access-request test writes rows (it cleans them up through an EXIT trap).

**Reverse.** Delete check 9 from `verify-system.sh`; both scripts keep working
standalone.

---

## 13. Two masking defects found and fixed during live verification

**Decided.** Fixed both at their root and made each one impossible to pass again.

**What was wrong.**

1. **Classified columns were never masked on the Supply Control Tower feed.** The
   route passed the Trino-qualified `marts.bi_supply` to `columns_for_mart`, which
   keys on the bare schema name that `ops_perm.column_classification` stores. The
   lookup missed and returned `{}`. Because masking is a denylist, an empty result
   means "nothing classified here", so the obligation was never requested and the
   GPS went out in the clear to every identity, including a low-trust federated one.
   The policy was never wrong — asked directly, OPA returns
   `masked_columns=['lat','lng']` for that caller. Nothing ever asked.

2. **`generalize` dropped every numeric column instead of coarsening it.** Trino
   returns NUMERIC columns as `decimal.Decimal`, a type `_generalize` did not
   handle, so it reported "cannot generalize" — and one ungeneralizable value
   poisons the whole column by design. Fail-closed, nothing leaked, but the class
   was dead for exactly the columns it exists to protect: a low-trust caller lost
   the coordinates entirely rather than receiving them at ~11 km precision.

**Why these survived.** The startup self-tests check role → masked set, and that
half was always correct. The end-to-end test that would have caught defect 1
existed but nothing ran it. It would NOT have caught defect 2: its catch-all
accepted an absent value as "generalized", so a dropped column looked identical to
a coarsened one.

**What now prevents a repeat.** The schema normalisation moved into
`columns_for_mart` itself, so no caller can silently fail open on the key; it warns
when it has to normalise. `_generalize` handles `Decimal`. The e2e test demands a
one-decimal number and fails on an exact OR an absent value, covers the generic
mart reader as well as the Control Tower feed, and runs as `verify-system` check 9
on every deploy and provision. Unit tests cover the lookup key and the Decimal
path.

**Alternative.** Fix only the call site in `ct.py`. Rejected — that leaves the next
caller free to make the same mistake against a lookup that fails open silently.

**Reverse.** Three commits under `6_access-points/api/nhdw-gateway/` and one in
`bundle/scripts/verify-system.sh`; revert individually.

---

## 14. Investigated a conformed-hub count gap and concluded it is a pending build, not a defect

**What looked wrong.** `v_facility_resolution` yields 3298 distinct conformed keys
while `hub_facility_conformed` holds 3296. Two facilities (`selihom pharmacy`,
`vitality pharmacy`, both resolved by `norm_name`) are in the view and not the hub,
and their source rows date from 2026-08-06 — so at first read the hub had been
missing them for six weeks, which would have suggested an incremental-watermark bug
silently dropping late-arriving keys.

**What it actually is.** Checked rather than assumed:

- referential integrity is clean — 0 same-as links and 0 canonical-sat rows point at
  a missing hub row, and both facilities are present in `dim_facility`;
- the hub is 1:1 with no hash collisions (3296 rows / 3296 distinct business keys /
  3296 distinct hashes), so nothing collapsed;
- both skipped rows carry valid non-null hashes, so they are not being filtered for
  a null key;
- the AutomateDV postgres hub macro anti-joins on the primary key
  (`LEFT JOIN this ... WHERE d.pk IS NULL`) with **no** load-timestamp watermark, so
  it cannot permanently skip a late key by construction;
- `dbt-vault` last completed 2026-09-20T22:32Z and has not run since — deploys only
  rebuild the tiers whose inputs changed, and this session's commits touched the
  gateway and the marts, not the vault.

The two keys should therefore appear on the next vault build. A full-scope redeploy
was dispatched to confirm it rather than leaving the conclusion untested.

**Also confirmed, and NOT a defect.** `sat_facility_canonical` holds 3298 rows over
3296 distinct hashes. The two duplicates (`Esakore Drug Store`, and
`Mehal Sub City` / `Mehal Sub- City`) carry DISTINCT hashdiffs — they are
insert-only golden-record revisions, exactly the designed bitemporal behaviour, not
duplicate masters.

**Baseline note for later.** The conformance checksum is now
`40859ffca66a83a9f51da720c6374abc`, not the `c5d265ec9dc60c57760360205edd6070`
recorded as the pre-MDM baseline. With zero live steward decisions the resolution
logic is still deterministic; the corpus it runs over has grown. Use the new value
as the baseline for future revert checks.

---

## 15. A truncated init statement — the find that justifies a real cold boot

**Found.** `3_storage/postgres/init/07_marts_schemas_extras.sql` ends mid-statement:
`ALTER DEFAULT PRIVILEGES FOR ROLE vault_writer IN SCHEMA bi_mdm` with no `GRANT`
clause. Introduced with the `bi_mdm` schema on 2026-09-10; the file has been
unexecutable since.

**Why it matters more than a failed deploy step.** `postgres:16-alpine` runs
`/docker-entrypoint-initdb.d/*.sql` with `ON_ERROR_STOP=1` and aborts
initialisation on failure. Any cold boot onto a fresh volume since 2026-09-10 would
have died at postgres init. It also left `bi_mdm` without default SELECT privileges
for `bi_reader`.

**Why eleven days of green runs missed it.** The DDL tier only runs when an init
file changes or a deploy is full-scope, and init `.sql` executes on a FRESH volume
only — every provision this week reused the existing PGDATA. The path that
exercises these files was never the path under test. It surfaced the moment a
full-scope deploy ran, and only because failed DDL now fails the run instead of
scrolling past.

**Fixed and swept.** Completed the statement, verified it applies with
`ON_ERROR_STOP=1`, and checked all 19 init files — every other one ends on a
terminated statement.

---

## 16. Made the true cold boot reachable through CI

**Decided.** Added `fresh_volumes` to `provision.yml` (default false) rather than
wiping the host by hand over ssh.

**Why.** The defect above exists precisely because the fresh-volume path is not
reachable through the pipeline, so it never gets tested. A destructive step that
only exists as an ssh ritual is a step that does not get run. The standing rule is
that remote changes go through CI/CD and extending CI when it cannot carry a change
class IS the work — this is that case.

**Guards.** Off by default; refuses to run without `run_seed` so it cannot leave an
empty warehouse; scales workloads down before releasing volumes; the input
description says it destroys all data.

**Alternative.** Wipe by hand for this one test. Rejected — it leaves the gap open
for the next person.

**Reverse.** Remove the input from `provision.yml` and the three tasks at the top
of the deploy role.

---

## 17. Fixed the ansible-lint drift and gated it

**Decided.** Returned the playbook to `0 failures, 0 warnings` at the production
profile and added `ansible-lint` to the CI test job.

**Why.** It had been clean and had drifted to four findings, because nothing ran the
linter. Two were over-long lines (the apt source cannot wrap, so its parts became
variables); one was a register that could take the role prefix; the fourth,
`nhdw_helm`, keeps its name — it is declared in `group_vars/all` and read by the
`cni` and `deploy` roles, so a `provision_` prefix would rename a cross-role
contract to satisfy a rule about role-local variables. That one carries a `noqa`
with the reason written next to it.

**Reverse.** Drop the lint step from `.github/workflows/test.yml`.

---

## 18. Tested the cold boot in a container instead of wiping the shared server

**Decided.** Built `bundle/scripts/test-coldboot-initdb.sh`, which runs the real
init directory through a throwaway postgres container, and did NOT run the
destructive `fresh_volumes` provision unattended.

**Why.** The pre-authorisation was for "the cold boot", given when that meant
`provision.yml` — which is what ran as attempt #12. Deleting every PVC is strictly
more destructive than what was authorised, and the SeaweedFS volume holds test
residue the migration ledger explicitly marks "left for human review". Destroying
that while the owner is asleep is not a call to make on their behalf.

The container test gives the SAME signal for the part that was actually broken —
whether postgres init survives a fresh volume — at zero risk, in about forty
seconds, with no cluster needed. It found nothing that a wipe would have found
differently, and unlike a wipe it now runs on every push.

**What this does NOT cover, stated plainly.** It proves the database initialises. It
does not prove the rest of a fresh-volume boot: an empty object store, an empty
ClickHouse, an empty OpenSearch index, and the seed run that has to repopulate all
of them. That still needs the real thing.

**Recommended next step for the owner.** Trigger `provision.yml` with
`fresh_volumes=true` and `run_seed=true` when you are around to watch it. Secrets
(including the OpenMetadata ingestion-bot token) live outside the PVCs and survive;
what is lost is the SeaweedFS validation residue and the stale
`dsw-superadmin-…` notebook volume. Everything else is reproducible from seeds by
design — which is exactly the claim the test would be checking.

**Reverse.** Nothing to undo. The destructive option exists and is off by default.
