# k8s deployment changelog

A running **Symptom → Root cause → Fix** log for anything that broke a deploy or
misled an operator. Append; never rewrite. The point is that the next person
hitting the same symptom finds the cause instead of rediscovering it.

Entries are newest-first.

---

## 2026-09-21 · CI/CD hardening (the data-layer epic)

Eight deploy failures in one day, each with a distinct cause. Worth reading as a
set: most were not the *feature* being wrong but the *pipeline lying* about it.

### A deploy reported success having applied nothing
**Symptom.** Deploy #7 went green; the DDL it was supposed to apply was absent
from the database, and the log said `ddl: none`.
**Root cause.** `deploy.yml` passes the changed files as a single
space-separated string. `ci-redeploy.sh` matches them with line-anchored greps
(`grep -E '^3_storage/…'`), which silently match nothing against one long line.
Every path-driven branch therefore evaluated false, and the run "succeeded" by
doing nothing.
**Fix.** Normalise the argument to one path per line
(`CHANGED="$(printf '%s\n' $changed_input)"`). A silent no-op is worse than a
failure — it teaches you to trust a green run that did nothing.

### A failing seed still produced a green deploy
**Symptom.** `== app/security seeding FAILED ==` in the log, run green.
**Root cause.** The seeder ran as `bash … | tail -5`; the pipeline's exit status
is the *last* command's, so the loader's failure was discarded.
**Fix.** Run it, capture the status, print the tail from the captured log, and
`exit 1` on failure. Same treatment applied to rollouts (a workload that never
becomes ready now fails the run) and to the OPA regen.

### A deploy waited 40 minutes on a job that had already failed
**Symptom.** Deploy #19 sat in `dbt-vault` for 40 minutes; the job had failed
after 4.
**Root cause.** `kubectl wait --for=condition=complete` ignores a `Failed`
condition — it waits out the timeout regardless.
**Fix.** Poll both terminal conditions and report which happened (failed /
vanished / still running) with the elapsed time.

### A fresh checkout could not build the gateway
**Symptom.** Deploy #12: `COPY validators.py … not found`.
**Root cause.** The gateway image bakes in the graduation validator harness,
whose canonical home is `2_pipelines/ml/registry/validators.py`. Docker cannot
COPY outside the build context, so `build-images.sh` stages a copy into the
context — and that copy is **gitignored**, so CI's fresh checkout never has it.
**Fix.** Stage it in `ci-redeploy.sh` too, and rebuild the gateway when the
canonical source changes.

### The keycloak reseed deleted the Job it needed, then failed
**Symptom.** `NameError: name 'false' is not defined`, followed by
`no objects passed to apply` — and no `keycloak-seed` Job left in the cluster.
**Root cause.** Two mistakes compounding. The inline renderer was fed **both** a
heredoc and a stdin redirect, so Python read the job JSON as its own source
(JSON's `false` is not a Python name). And the script deleted the Job *before*
rendering its replacement, so the render failure left nothing behind — and the
live Job had been the only carrier of this deployment's host base.
**Fix.** `render-keycloak-seed-job.py` stamps the browser-facing env from
`--hostbase` onto either the live spec or (self-healing) the committed manifest;
the CI renders and host-base-checks **first**, and only then deletes and
applies. Never delete a thing whose replacement you have not yet built.
**Related trap, still true:** applying the *base manifest's* seed Job to a
deployment on another host rewrites every OIDC client's redirect URIs to the dev
default and breaks login for everyone. The host base is supplied, never
inherited.

### dbt models that could not compile, discovered 40 minutes in
**Symptom.** Deploys #16 and #19 died inside `dbt-marts` / `dbt-vault`.
**Root cause (two distinct defects).** A dim joined with `ON` *ahead of* a chain
of `USING (facility_id)` joins gives those clauses two candidate columns on
their left side — Postgres refuses with *"common column name appears more than
once in left table"*. And a `COALESCE` over mBrana's **boolean**
`operational_status` and MFR's **text** `status` cannot be typed. dbt builds its
manifest without ever asking Postgres whether the SQL is legal, so both
surfaced only mid-build.
**Fix.** `bundle/scripts/check-dbt-sql.py` renders the templating the models
actually use and `EXPLAIN`s each one against the live warehouse — 107 models in
about a minute. It has since caught a third defect (mBrana's `woreda`/`zone` are
bigint FKs, not names). Run it before pushing a model change.

### A verifier that failed on every healthy system
**Symptom.** `✗ bundle/bin/mc missing` on every run, for weeks.
**Root cause.** `bundle/bin/` is gitignored and `mc` is **derived on demand**
(`lib/objstore.sh`: bundled binary → extract from the cached image → network).
The check asserted a build artifact a fresh checkout can never have.
**Fix.** Check what actually matters — that mc is *obtainable offline* (binary,
cached image tar, or local image store). A permanently-red check is worse than
no check: it trains people to ignore the verifier.

### Cold boot would have come up without the new schemas
**Symptom.** None yet — found while wiring a later init file.
**Root cause.** `34_ref_vocab.sql`, `35_mdm.sql` and `36_mdm_decisions_read.sql`
were never added to the `postgres-vault-init` configMapGenerator. initdb runs
that configmap in filename order **on a fresh volume only**, so a cold boot
would have had no `nhdw_ref` and no MDM decision tier, and the vocabulary seed
would have failed on a missing schema. It worked on the live cluster purely
because CI applies changed init files to a warm database.
**Fix.** Registered (with `39_mdm_release.sql`). When adding an init file, add
it to the kustomization in the same change — the warm path and the cold path are
different mechanisms.

### Recovering a failed deploy
A push only diffs **its own** commits, so a failed run's files are not retried
by the next push. Re-apply them deliberately:

```bash
gh workflow run deploy.yml -f scope="<space-separated paths>"   # or scope=all
```

Also note GitHub's concurrency behaviour: a newer run supersedes the *pending*
one in the group, so two quick pushes can leave the middle one cancelled. Check
which run number carries your commit rather than assuming it is the latest.
