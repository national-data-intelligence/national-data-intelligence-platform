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
