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
