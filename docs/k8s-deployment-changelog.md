# k8s deployment changelog

A running **Symptom → Root cause → Fix** log for anything that broke a deploy or
misled an operator. Append; never rewrite. The point is that the next person
hitting the same symptom finds the cause instead of rediscovering it.

Entries are newest-first.

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
