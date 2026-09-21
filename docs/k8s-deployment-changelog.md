# k8s deployment changelog

A running **Symptom → Root cause → Fix** log for anything that broke a deploy or
misled an operator. Append; never rewrite. The point is that the next person
hitting the same symptom finds the cause instead of rediscovering it.

Entries are newest-first.

---

## 2026-09-21 · OpenMetadata sign-in failed after a Helm provisioning run

**Symptom.** SSO into OpenMetadata returned to OM's `/callback` with
`{"error":"Bad token response, error=unauthorized_client, description=Invalid
client or Invalid client credentials"}`. Every other SSO client kept working.

**Root cause.** In the Helm chart's `keycloak-seed-job.yaml`, the parity entry for
`OPENMETADATA_OIDC_SECRET` had been inserted between `JUPYTERHUB_OIDC_SECRET` and
its `valueFrom` line. YAML read JupyterHub's entry as valueless and gave
OpenMetadata's entry two `valueFrom` keys, the last one — `jupyterhub-secrets` —
winning. The seed Job a Helm provisioning run creates therefore wrote JupyterHub's
secret onto the Keycloak `openmetadata` client, while the OM server kept presenting
its own (`openmetadata-secrets`). The kustomize base was correct throughout.

**How it was confirmed.** The live Job's env showed `OPENMETADATA_OIDC_SECRET ←
jupyterhub-secrets`; sha256 fingerprints of the Keycloak client secret and
`openmetadata-secrets/OIDC_CLIENT_SECRET` differed.

**Fix.** The `valueFrom` line moved back under `JUPYTERHUB_OIDC_SECRET`. On the live
cluster: the seed Job re-rendered from the base manifest with the host base stamped
(`render-keycloak-seed-job.py --hostbase …`), rerun, then verified — both clients'
Keycloak secrets match their deployment secrets, existing redirect URIs unchanged,
OM sign-in completes in a browser.

**Watch for.** Inserting a list entry into a two-line `- name:` / `valueFrom:` pair
splits it silently; YAML accepts duplicate keys. Review env-list diffs as pairs.

---

## 2026-09-21 · The from-bare provision path had never been run

`provision.yml` (ansible `site.yml`) is what the working agreement calls the
cold-boot path. Running it surfaced six defects in a row, none of them in the
platform — all in the provisioning itself. Each failed before doing damage.

**1. Missing ansible collections.** `couldn't resolve module/action
'community.general.modprobe'`. The workflow installs `ansible-core`, which ships
only `ansible.builtin`; the roles use `community.general` (modprobe) and
`ansible.posix` (sysctl). → declared in `1_infrastructure/ansible/requirements.yml`
and installed by the workflow.

**2. `ansible-galaxy` not on PATH.** pip `--user` installs into `~/.local/bin`,
which the runner's PATH lacks. The playbook step already used an explicit path;
the new step didn't. → call it the same way.

**3. Docker apt source conflict.** `E: Conflicting values set for option Signed-By
... docker.gpg != docker.asc`. `apt_repository` ADDS a line and leaves existing
ones alone, so a host that already had Docker's repo (the older `.gpg` keyring
convention) ended up with two entries for one source — and apt then refuses to
read ANY source. → the role writes `docker.list` itself, as a single owned entry.

**4. …and that repair ran too late.** Fixing the file after the base-package
install meant apt was already unusable, so provisioning failed even earlier, on
`apt install curl`. → clear conflicting sources BEFORE the first apt operation;
write the owned entry later. Converges either host state.

**5. `nhdw_helm` pointed at a gitignored path.** Every helm task died with `rc=2`
and *empty* output — the shell's "No such file or directory". `nhdw_helm` is
`bundle/bin/helm`, `bundle/bin/` is gitignored, and a fresh checkout has no such
file, while the role installs helm to `/usr/local/bin`. The variable and the
install disagreed. → resolve at run time: the bundled binary when the bundle
genuinely ships one (the airgapped path), else the system install.

**6. Fixed `/tmp` log names collide between users.** Six images were reported
FAILED while building perfectly: `build-images.sh` writes
`/tmp/build-<image>.log`, `/tmp` is sticky, and those files belonged to another
operator who had run the script earlier — the second user cannot overwrite them,
the redirect fails, and the build is marked failed for a reason unrelated to the
build. → both `build-images.sh` and `ci-redeploy.sh` use a private `mktemp -d`
per run, and log names no longer carry the tag's colon.

**The pattern worth remembering.** Three of these six (5, 6, and the
`bundle/bin/mc` verifier check fixed the same day) are the same mistake: *a
gitignored, derived artifact assumed to be present*. On the machine where someone
once created it by hand everything works; on a fresh checkout nothing does. When
a path lives under a gitignored directory, something must CREATE it or the code
must tolerate its absence.

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

## 2026-09-21 — from-bare provisioning reaches green

**Symptom.** `provision.yml` (ansible `site.yml`) failed its final task, the
canonical regression gate, with `✗ gateway health check failed` and
`✗ ML registry has only 0/5 models`, while the cluster itself was healthy —
30 pods Running, gateway and admin both answering 200.

**Root cause.** One cause for both. `verify-system.sh` probes
`https://gateway.$NHDW_HOSTBASE` and defaults that variable to the dev base,
and the verify role invoked the script with no `environment:` block. On a
re-homed deployment it therefore checked `127.0.0.1.nip.io`, got nothing, and
reported a dead gateway and an empty model registry. Confirmed by hand: the
same `/api/ml` call returns the registered models over the real host and
nothing over the dev host. CI already passed `NHDW_HOSTBASE`; only the
provisioning path did not — the same class of defect as the host-base
precedence bug one level up, which is what made it look like a platform
failure rather than a probe pointed at the wrong address.

**Fix.** Pass `NHDW_HOSTBASE: "{{ nhdw_host_base }}"` to the regression-gate
task. Provision attempt #12: 50 tasks ok, 0 failed, regression gate green.
This is the first end-to-end green run of the from-bare path; the twelve
attempts that preceded it are the six provisioning defects logged above plus
their follow-on ordering and ownership problems.

## 2026-09-21 — a truncated init statement, unexecutable since 2026-09-10

**Symptom.** A full-scope redeploy failed at the DDL tier:
`✗ DDL apply failed for 3_storage/postgres/init/07_marts_schemas_extras.sql`,
with `ERROR: syntax error at end of input`.

**Root cause.** The file's last statement is incomplete. It ends

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE vault_writer IN SCHEMA bi_mdm
```

with no `GRANT SELECT ON TABLES TO bi_reader;` — a truncation introduced with the
`bi_mdm` schema in 7adcc71 (2026-09-10).

**Why it went unnoticed for eleven days.** Two reasons. The DDL tier only runs when
an init file changes or the deploy is full-scope, so ordinary deploys never touched
it. And init `.sql` files execute on a FRESH volume only — every provision run this
week reused the existing PGDATA, so the cold-boot path that would have hit it was
never the path being exercised.

**Blast radius, which is larger than a failed deploy.** `postgres:16-alpine` runs
`/docker-entrypoint-initdb.d/*.sql` with `ON_ERROR_STOP=1`, and a failure aborts
initialisation — the database never finishes coming up. Any cold boot onto a fresh
volume since 2026-09-10 would have died at postgres init. It also means `bi_mdm`
never received default SELECT privileges for `bi_reader`, so tables created there
later are unreadable by the BI reader role until granted explicitly.

**Fix.** Completed the statement. Verified by applying the file against the live
database with `ON_ERROR_STOP=1`: clean exit, `ALTER DEFAULT PRIVILEGES` succeeds.

## 2026-09-21 — two more init files wrote to the wrong database

**Symptom.** With the truncated statement fixed, a full-scope deploy got one file
further and stopped: `✗ DDL apply failed for 23_perm_admin_grants.sql`,
`ERROR: schema "ops_perm" does not exist`.

**Root cause.** `23_perm_admin_grants.sql` and `32_permission_store.sql` both
create or grant on `ops_perm`, which lives in `nhdw_ops`, and neither carried a
`\connect`. Each init file starts a FRESH psql session against `POSTGRES_DB`
(`nhdw_vault`); an earlier file's `\connect` does not carry over. Seventeen other
init files get this right — these two were the exceptions.

**Fix.** Added `\connect nhdw_ops` to both, with the reason written next to it so
the next author does not have to rediscover the session rule.

**The pattern behind all three of today's init defects.** `3_storage/postgres/init/*`
executes on a FRESH volume only. Re-provisioning an existing host keeps its PVC, so
these files never run, and nothing else reads them — a broken one is invisible until
someone wipes a volume. Three had accumulated, each fatal on its own
(`ON_ERROR_STOP=1` aborts initialisation).

**What now catches it.** `bundle/scripts/test-coldboot-initdb.sh` runs the real init
directory through a throwaway `postgres:16-alpine` with the env the StatefulSet
supplies, then asserts the six databases, the four `ops_*` schemas, the three
`ops_perm` tables and the `bi_mdm` default privileges landed where they belong. It
needs Docker and nothing else, so it runs in the hosted CI job on every push.
Verified both ways: green on the fixed tree, and red — naming the file and the
error — on a copy with one `\connect` removed.

## 2026-09-21 — the vocabulary reload had never been able to run

**Symptom.** With the DDL tier finally applying all 40 init files, a full-scope
deploy got one tier further and stopped: `✗ vocab reload failed`, with
`unexpected COPY_IN result, aborting connection`.

**Root cause, in two layers.**

1. `seed-ref-vocab.sh` fed a multi-statement `psql -c` containing
   `COPY _in (...) FROM STDIN`. psql sends a `-c` string as ONE simple query and
   has no way to hand that same channel over to copy data mid-batch, so the load
   could never succeed in that shape. The path only runs when the ref-vocab seeds
   change or a deploy is full-scope — both rare — so it sat broken.

2. Fixing that exposed `ERROR: unquoted newline found in data`. The built CSVs are
   CRLF: `csv.writer` defaults to the `excel` dialect (`lineterminator='\r\n'`) and
   `newline=""` passes it through verbatim. `COPY` locks onto the newline
   convention of the first data row and then rejected the LF-only `\.` terminator.

**Fix.** The load now goes in as a script on stdin — CSV inline, `\.` terminator,
wrapped in an explicit transaction because `ON COMMIT DROP` would otherwise drop
the temp table the instant the `CREATE` autocommits. A failed load aborts instead
of being discarded. `build_vocab.py` writes LF (`lineterminator="\n"`), the loader
strips CR so an older `_build/` still loads, and `test_build_vocab.py` asserts the
built files are LF.

**Verified live.** 16 vocabularies, 7 domains, 7 concept classes, 163 concepts, 133
relationships, 187 crosswalk rows, exit 0; vocabulary suite 9/9.

**The pattern, again.** Three init files and now the vocabulary loader — every one
of them on a path that only executes during a cold boot or a full-scope deploy.
Making failures honest is what surfaced them: each had been failing silently or
never running at all.
