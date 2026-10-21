# A. Readiness assessment

Part of the [release-readiness pack](README.md).

## 1. Assessed baseline

| Item | Value |
|---|---|
| Assessment dates | 2026-10-20 23:35 UTC to 2026-10-21 |
| Repository state | `develop` = `92ede8e` (2026-09-22, "fix(seed): drop a profile-skipped source from the ingestor list too, from one skip set"). `main` = `f16ea12`, 209 commits behind `develop`. CI deploys from `develop`. |
| Unmerged work relevant to findings | `c83f0f9` "fix(elmis): count each eLMIS line once", on a local branch, not pushed or deployed (RR-002) |
| Environment | Single-node k3s v1.36.3 on one Azure VM (16 CPU, 108 GiB, 495 GB disk at 65%), namespace `nhdw`, hosts `*.20.84.70.78.nip.io`, self-signed TLS |
| Deployed version | **Not identifiable from the system.** Every custom image is tagged `nhdw/*:1.0.0` with no revision label (RR-004). |
| Manifests | Match `develop` (Helm release `nhdw` rev 7, 2026-09-21) |
| Image contents | A 2026-09-21 20:31 UTC build that predates three merged `develop` commits, plus gateway code that is in no commit |
| Manual changes | The gateway deployment is at revision 66, so it has been changed by hand |
| Last CI deploy | 2026-09-21 (Failed, Failed, Canceled); none since. The 2026-09-22 commits reached the cluster by a manual rebootstrap. |
| Active profile | `et-v3` (env-pinned), rebranded to Palladium **on the host only**, not in git |
| Data state | One load on 2026-09-22 over synthetic and demo-seed sources; marts built 2026-09-22 09:57; nothing has refreshed since |
| Method | Read-only inspection of code, configuration and runtime (see §5) |

The assessment changed nothing on the platform or in the repository, apart from adding this documentation pack.

## 2. Verdicts

| Stage | Verdict | One-line reason |
|---|---|---|
| **Credible, repeatable customer demonstration** | **Not ready. Achievable in about 1.5–2 weeks** (WP-0 to WP-3, 8–14 engineer-days, two engineers) | The primary demo surface (Control Tower) is unreachable under the live profile and shows ≈4× inflated numbers. The public portal shows fabricated datasets and mock news. A personal-data exposure is live. |
| **Controlled customer pilot** | **Not ready. About 5–7 weeks after the demo gate**, *provided* pilot data and the legal position arrive in time | There is no scheduled refresh, no backup, no alerting and no working delivery pipeline, and identity is demo-grade. All data is synthetic, and no data-protection basis is established. |
| **Supported production deployment** | **Not ready. Several months**, depending on the decisions in §6 | All pilot gaps, plus: no support model, no SLOs, end-of-life components, single-node risk not accepted, no penetration test, and the security controls in docs are not implemented. |

These verdicts agree with the July 2026 assessment's overall "not production-ready". Since July:
- **Resolved:** CI exists, there is infrastructure as code (Helm, Ansible), masking policies, a catalogue, and
  `DEV_AUTH` is off.
- **New problems:** the eLMIS double load, the public audit-log exposure, the broken lineage, the stale images and the
  paused refresh.

## 3. Blockers by stage

Severity and IDs are from the [findings register](03-findings-register.md).

**Demo blockers (24 findings; the decisive ones):**

1. **RR-001**: the gateway access log is readable anonymously from the internet. It holds names, emails, IPs and user
   agents of every staff user.
2. **RR-002 + RR-003**: every PCT/Control Tower volume is ≈4× too high, and the plan is sized on a forecast that fails
   its own contract rule and was trained on that inflated data. They must be fixed together. Fixing RR-002 alone grows
   the plan from 11.1M to 17.7M units.
3. **RR-005**: the Control Tower page is disabled for every role under the live profile.
4. **RR-004**: the running images are not the reviewed commit. The demo would miss the forecast range and KPI
   presentation that are already merged, and no one can say which commit runs.
5. **RR-006, RR-007, RR-008, RR-010, RR-017**: fabricated or misleading content:
   - fallback KPIs and a random trend on the public page;
   - 12 fabricated open-data datasets live;
   - mock bulletins attributed to EPHI, FMoH and EFDA;
   - missing data shown as zero.
6. **RR-009, RR-013, RR-014**: health metrics with the wrong meaning. Every "coverage" figure is a reporting rate;
   programme attribution has collapsed to `OTHER`; same-named KPIs disagree.
7. **RR-201**: the committed demo password is the live password for every seeded user, including super-admins, on an
   internet-facing login.
8. **RR-011, RR-025, RR-026**: raw placeholders, an empty region filter and mixed Palladium/Ethiopian/NHDW branding.

**Additional pilot blockers (36 findings).**

| Area | Findings |
|---|---|
| No scheduled refresh | RR-101, RR-020 |
| No backups | RR-102 |
| No alerting | RR-103 |
| Idle, ungated delivery pipeline | RR-206 |
| Identity and transport hardening | RR-204, RR-205, RR-215 |
| Policy bypass via Trino, notebooks and tools | RR-203, RR-214 |
| World-readable cluster-admin kubeconfig | RR-202 |
| Mutable decision log | RR-018 |
| Broken lineage | RR-019 |
| No URL routing | RR-112 |
| Synthetic-only data, no legal basis | RR-302, RR-303 |

**Additional production blockers (11 findings).**

| Area | Findings |
|---|---|
| JWT hardening | RR-208 |
| Backfill and schema strategy | RR-108 |
| Country portability | RR-110 |
| End-of-life components | RR-211 |
| Downstream use of approvals | RR-106 |
| i18n | RR-502 |
| Audit retention | RR-213 |
| Plus | The production criteria in the [standards framework](06-standards-and-acceptance-criteria.md) §2.3: SLOs, penetration test, support model, single-node risk acceptance |

## 4. What is genuinely working

Credit where it is due. These were verified, not assumed.

**Pipeline and data**
- The pipeline shape is real and complete: source replicas → lake → ClickHouse staging → Postgres data vault → dbt
  marts → Trino → policy-enforced gateway → dashboards.
- **DHIS2 and EthioEMR reconcile exactly** at every hop.

**Security controls**
- **Authorisation core holds where it is wired.** OPA fails closed, the live policies equal the repository, and 29/29
  policy tests pass.
- A region-scoped user sees only their region, and filter tampering returns 403.
- The low-privilege user is denied BI cleanly.
- The realm boundary holds.
- **Gateway SQL is parameterised.** Identifiers come from allow-lists, and SQL Lab is read-only with a mandatory limit.
- Masking self-tests at boot (17/17).
- No credential pattern appears in 351 commits of git history.
- Recent gateway logs contain no tokens or emails.

**Data shown to users**
- **Public data endpoints return exactly what their marts hold.** The problems on the public page are labels,
  fallbacks and scope, not the query results.
- An export download matches the on-screen row count.

**Control Tower (PCT)**
- **The PCT time anchor is consistent and data-based.** History runs to August 2018 and the plan is for September
  2018, with no wall-clock drift.
- **Recommendations are explained.** Each line has a 5-step "why" walk and a demand basis.
- **Decisions persist and are audited.** One live decision has a matching audit row and survived two database
  restarts.
- The forecast lineage is consistent: the MLflow champion run → forecast mart → position mart.

## 5. Verification coverage

| Area | Inventoried | Verified | How |
|---|---|---|---|
| Components | 35 (+7 documented but not deployed) | 35 | Runtime inspection + code ([coverage map §2](02-coverage-map.md#2-component-inventory)) |
| Pipelines / DAGs / Jobs | 10 | 10 | Airflow run history, Job state, data timestamps |
| Source lanes, hop by hop | 8 | 8 | Exact counts, source → lake → landing → vault → marts |
| Dashboard widgets | 104 catalogued, 88 placed | All mounted widgets in the metric matrix | Gateway SQL replayed on live Trino; public endpoints curled and compared with SQL |
| Routes and links | 50 | 47 (94%) | Headless browser, 11 personas + anonymous, ~150 role × route cells |
| Gateway handlers | 197 | 197 guard-scanned (static); 112 GET paths swept anonymously | AST scan + live probes |
| Accessibility | — | 28 page states | axe-core 4.10.2, WCAG 2.2 A/AA tags |
| Documents | 13 core docs, 4 decision records, 4 root documents, the presentation guide (sampled) | Every material claim tabulated and classified; 14 cross-document contradictions | Claim-by-claim against code and runtime |
| Test suites run | 6 | OPA 29/29, masking 17/17, gateway import (201 routes), rebuild guards 19/0, country guard 8/0, widget-binding contract OK | Offline, network-isolated containers |

**Test suites skipped:**
- UI type-check/build, which needs a network install.
- dbt parse, because dbt is not installed and not in CI.
- The MDM and seed-loader suites, which need a database.
- The forecast-contract test, which needs a network install.
- Keycloak login-flow tests, which need live logins (the walk covered this instead).

**Not verified, and why.** Full list in the register's
[verification gaps](03-findings-register.md#verification-gaps-checks-that-could-not-be-run).
- **Live approve/revert write:** it would write to the live log, so it needs approval (decision D9).
- **Authenticated Control Tower payload vs mart:** partial.
- **Per-persona masking:** not covered.
- **Notebook → Trino bypass:** a hypothesis.
- **Live Keycloak realm settings:** need a realm-admin read.
- **CI history and branch protection:** `gh` unavailable; the repository is private.
- **External port scan:** only the VM-internal view was available.
- **Image CVEs:** no scanner installed.
- **Clean-environment rebuild:** no isolated VM was available, and the shared environment must not be reset.
- **Load performance:** not run against a shared environment.
- **Causes of the missing DQ mart and empty lanes:** the build logs were garbage-collected.

**Evidence basis.** Every finding is tagged `[live]` (observed), `[static]` (read from code or config) or `[hyp]`
(hypothesis). The evidence pack (A, B1, B2, C, D, E, F files) holds the commands, outputs and screenshots. It is
kept outside the repository and is available from the assessment owner.

## 6. Decisions needed

These decisions change scope, customer promises or accepted risk. They are not engineering calls. The full list with
options is in [execution plan §4](04-execution-plan.md#4-decisions-needed-outside-the-engineering-teams-authority).

| ID | Decision | Recommendation |
|---|---|---|
| D1 | Which profile the demo runs, and how the Control Tower is framed | The Palladium profile, with the Control Tower enabled and a visible "synthetic Zambian eLMIS archive, Aug 2018" banner. One source of truth for the active profile, in git. |
| D4 | Planning basis while the forecast fails its rule | AMC, as the contract requires. Demonstrate the rule *working*, rather than a forecast that has not earned its place. |
| D5 | Treatment of the audit-log exposure | Close it the same day (WP-0), then tell the data owner what was exposed and for how long. |
| D2/D3 | Demo scope; newsroom and open-data content | Drop the Resource page and cascades from the script until data exists. Remove the mock news and fabricated datasets rather than watermarking them. |
| D6 | Pilot data, data owner, legal applicability, small-cell threshold | Start now. This is the real critical path to a pilot. |
| D7 | Production availability target | 99.5% on one VM with a tested restore, unless a contract demands more. |
| D8, D9 | Downstream use of approvals; live write test | "Decision log only" for the pilot. Approve the write test on a designated test user. |

## 7. Product claims vs demonstrated capability

| Claim (where it appears) | Demonstrated? | Evidence |
|---|---|---|
| "Optimised routes" (deployed Control Tower tab) | **No.** Sweep ordering on straight-line distance against a one-round-trip baseline; no vehicles, capacity or cost | RR-021 |
| Forecast accuracy (MASE 0.977 / WAPE 0.598 / MASE 0.887 in various docs) | **No.** Three conflicting figures; the live one comes from inflated training data | RR-401 |
| "Forecast used only where it beats baselines" | **No.** The rule is logged but not enforced | RR-003 |
| "ML: drift + retrain, Met" | **Partly.** Drift-check fails every night; retraining self-promotes | RR-022, RR-003 |
| "Explained recommendations" | **Yes** | 5-step walk per line |
| "Human approval, append-only, audited" | **Partly.** Recorded and audited, but mutable, with best-effort audit | RR-018 |
| "Decisions feed the warehouse" | **Structurally yes, practically no.** No consumer; the refresh is paused | RR-106, RR-101 |
| "Lineage from source system to widget" | **No** (live). 0 edges into marts | RR-019 |
| "Second factor for sensitive roles" | **No.** 0 OTP credentials | RR-205 |
| "Gateway is the only door to the data" | **No.** Trino, Superset and notebooks bypass it | RR-203 |
| "Reconciled end to end" (eLMIS) | **No.** The vault double-loaded; the docs cite an older source | RR-002, RR-406 |
| "Region-scoped, role-governed access" | **Yes**, through the gateway | Walk: tamper → 403 |
| "Public statistics, small cells suppressed" | **Partly.** k ≥ 5 in SQL, but the threshold is not agreed with a data owner; "national" figures cover 5 regions | RR-303, RR-015 |
| "Multi-country profiles" | **Partly.** Profiles switch the presentation; the Control Tower hard-codes Zambia and Ethiopia | RR-110 |

## 8. Remaining uncertainties

- **The "after fix" PCT figures** (plan ≈2.78M units on AMC; position stock 4.16M) come from a 2026-09-29 scratch
  rebuild and must be re-measured in WP-1.
- **Why the DQ mart and four lanes are missing** is a hypothesis. The logs were garbage-collected, and WP-1/WP-5
  re-run them under observation.
- **Whether anyone accessed the exposed audit log.** The gateway's own log can answer this (WP-0 step 8).
- **The applicability of Zambian and Ethiopian data-protection law** is unassessed (RR-303).
- **Whether any contract names a standard** (accessibility, hosting, certification) is unknown. All criteria in the
  [standards framework](06-standards-and-acceptance-criteria.md) are engineering recommendations until one is seen.
- **The CI runner checkout holds about 395 uncommitted live lines,** including the only copy of the eLMIS synthesizer.
  Until their owner commits or discards them, any CI run destroys them, and the demo dataset cannot be regenerated.

## 9. First recommended work package

**WP-0, today.**
- Close the anonymous gateway routes (RR-001, RR-207) behind a capability guard and an ingress allow-list.
- Rotate the seeded password (RR-201) with a host-base-safe Keycloak reseed.
- Redact the password from the July assessment.

It is 1–2 engineer-days, touches only the gateway, the ingress and identity, and removes a live disclosure. It does
not depend on any other package.

**Then start WP-1 and WP-2 in parallel.** WP-1 begins by securing the CI runner's uncommitted work, before anything
can trigger CI.
