# C. Findings register

Part of the [release-readiness pack](README.md). Assessed 2026-10-20/21 against `develop` 92ede8e and the live
cluster (namespace `nhdw`, host base `20.84.70.78.nip.io`). Every finding below was re-measured during this
assessment; earlier registers (July readiness assessment, September baseline) were used only as leads.

## How to read this register

**IDs are stable.** They are grouped by class, and gaps in the numbering are intentional so new findings can be
added without renumbering.

| Prefix | Class |
|---|---|
| `RR-0xx` | Confirmed defect: the system does something wrong today |
| `RR-1xx` | Missing capability: something a release stage needs does not exist |
| `RR-2xx` | Configuration or security posture problem |
| `RR-3xx` | External data dependency: needs data or a decision from outside the team |
| `RR-4xx` | Documentation drift or misleading claim |
| `RR-5xx` | Optional improvement |

**Severity**

| Level | Meaning |
|---|---|
| **S1** | Shows wrong or fabricated information as real, exposes data, or invalidates a headline claim |
| **S2** | Broken or misleading feature, or a missing control that a stage requires |
| **S3** | A gap or drift that will hurt later or at scale |
| **S4** | Cosmetic |

**Blocks** names the earliest release stage the finding blocks: **D** = customer demonstration, **P** = controlled
pilot, **R** = supported production. A finding that blocks D also blocks P and R.

**Evidence basis**

| Tag | Meaning |
|---|---|
| `[live]` | Observed on the running system |
| `[static]` | Read from code or config |
| `[hyp]` | A hypothesis that has not been confirmed |

The evidence files cited as `A-…`, `B1-…`, `B2-…`, `C-…`, `D-…`, `E-…` live in the assessment evidence pack. It is
kept outside the repository because it holds operational detail; the assessment owner can provide it. No value in
this register is a credential, and no row-level health data is reproduced.

**Effort** is in engineer-days for one engineer who knows the stack, and includes writing the test that proves the fix.

## Summary

| Severity | Count | Earliest stage blocked: Demo | Pilot | Production |
|---|---|---|---|---|
| S1 | 14 | 12 | 2 | 0 |
| S2 | 32 | 11 | 21 | 0 |
| S3 | 23 | 1 | 13 | 9 |
| S4 | 2 | 0 | 0 | 2 |
| **Total** | **71** | **24** | **36** | **11** |

The 24 demo-blocking findings are covered by work packages WP-0 to WP-3 in the [execution plan](04-execution-plan.md).
Each one is either fixed there or, where the plan allows it, signed off as a disclosed limitation.

| ID | Sev | Blocks | Title | Owner role |
|---|---|---|---|---|
| RR-001 | S1 | D | Gateway access log readable anonymously from the internet | Gateway dev + security |
| RR-002 | S1 | D | eLMIS loaded twice: every eLMIS/PCT/Control Tower volume ≈4× too high | Data engineer |
| RR-003 | S1 | D | Forecast promotion rule not enforced; plan sized on a non-citable forecast | ML engineer |
| RR-004 | S1 | D | Running images are not the reviewed commit, and nothing records which commit runs | Release manager |
| RR-005 | S1 | D | Control Tower page is disabled under the live profile | Product owner + platform |
| RR-006 | S1 | D | Public portal fabricates KPIs, region bars and a random trend when data is missing | Frontend (public) |
| RR-007 | S1 | D | Open-data catalogue shows 12 fabricated datasets live; download button is dead | Data engineer + frontend |
| RR-008 | S1 | D | Public newsroom shows seeded mock bulletins attributed to real institutions | Product owner |
| RR-009 | S1 | D | Every "coverage" metric is actually a reporting rate | Analytics engineer |
| RR-010 | S1 | D | Missing data rendered as a genuine zero (128 coercions in 45 widgets) | Frontend (BI) + gateway dev |
| RR-011 | S2 | D | Public hero shows raw template placeholders; live profile lives outside git | Platform + product owner |
| RR-012 | S2 | D | `mart_data_quality` never built: Disease map and source pulse return 502 | Analytics engineer |
| RR-013 | S2 | D | Programme attribution collapsed to `OTHER`; cascades empty; brief prints a nonsense line | Data engineer |
| RR-014 | S2 | D | Same-named KPIs disagree; invalid aggregations; labels contradict SQL thresholds | Analytics engineer + frontend |
| RR-015 | S2 | D | Public figures claim "all 14 regions" / national scope from 5 regions | Analytics + frontend |
| RR-016 | S2 | P | Error, denied, empty and loading states are indistinguishable; failures cached | Frontend (BI) |
| RR-017 | S2 | P | Latent fabricated content shipped in bundles and an anonymous placeholder API | Frontend + gateway dev |
| RR-018 | S2 | P | Plan-decision record is mutable and its audit is best-effort | Backend + DBA |
| RR-019 | S2 | P | OpenMetadata lineage broken behind a "success" DAG; OM restarts | Metadata owner |
| RR-020 | S2 | P | Warehouse refresh DAG would report success without building anything | Data platform engineer |
| RR-021 | S2 | D | UI and docs overstate analytics: "Optimized routes", P(alarm) 100% | Product owner + ML |
| RR-022 | S3 | P | `stockout_forecast` scheduled but never registered: 112 failed pods, nightly | ML engineer |
| RR-023 | S3 | P | `/api/exports/me` and `/api/reports/templates` return 500 | Gateway dev |
| RR-024 | S3 | P | Admin Documentation page empty; served doc copies stale | Platform |
| RR-025 | S2 | D | Dashboards fetch profile/reference data without a token: 401s, region filter empty | Frontend (BI/admin) |
| RR-026 | S2 | D | Mixed branding and leftover placeholders across apps ("Federal Ministry of Health · Ethiopia", "NHDW v1.0 · PROD", `TODO_GOOGLE_CLIENT_ID`) | Frontend + product owner |
| RR-027 | S3 | P | Control Tower plan API not programme-scoped and 14.5 MB per load | Gateway dev |
| RR-028 | S3 | P | Super-admin denied on Column Governance (over-restrictive grant) | Security |
| RR-101 | S1 | P | Nothing loads or refreshes data on a schedule; all data 28 days stale | Data platform engineer |
| RR-102 | S2 | P | No backups; restore never tested; no RPO/RTO | Platform/SRE |
| RR-103 | S2 | P | Alerts go nowhere; key targets unmonitored | Platform/SRE |
| RR-104 | S2 | D | No as-of date, data-provenance or "synthetic" label on any surface | Product owner + frontend |
| RR-105 | S2 | P | No rate limiting, request-size limits or public-form abuse controls | Gateway dev + platform |
| RR-106 | S3 | R | Approved plans go nowhere downstream | Product owner |
| RR-107 | S3 | P | Terminology store and commodity MDM empty | MDM owner / data engineer |
| RR-108 | S3 | R | No backfill, incremental or schema-change strategy | Data architect |
| RR-109 | S3 | P | Ethiopian calendar and timezone handling implicit and approximate | Analytics + frontend |
| RR-110 | S3 | R | Country specifics hard-coded in Control Tower code and marts | Platform |
| RR-111 | S3 | R | Catalogue, route and API inventories do not reconcile | Frontend + platform |
| RR-112 | S2 | P | No URL routing in any app: refresh, back and bookmarks lose the page | Frontend |
| RR-113 | S3 | P | Internal apps unusable at phone width; KPI strip clips at 1440 px | Frontend |
| RR-201 | S1 | D | Committed demo password is the live password for all 21 seeded users | Security/identity |
| RR-202 | S2 | P | Cluster-admin kubeconfig world-readable on a shared host | Platform |
| RR-203 | S2 | P | Direct data paths bypass gateway policy (Trino, notebooks, Superset) | Security + platform |
| RR-204 | S2 | P | Self-signed TLS, no HSTS/CSP/frame protection, no HTTP→HTTPS redirect | Platform |
| RR-205 | S2 | P | Identity hardening absent: no MFA, `sslRequired: none`, dev-mode Keycloak, admin console public | Security/identity |
| RR-206 | S2 | P | Delivery pipeline idle since 2026-09-21; deploy not gated by tests; no rollback | Release manager |
| RR-207 | S2 | P | Other internal endpoints and API docs reachable anonymously | Gateway dev |
| RR-208 | S3 | R | JWT algorithm taken from the token; vulnerable JWT library; demo impersonation on | Gateway dev |
| RR-209 | S3 | R | Init SQL applied by CI contains `DROP … CASCADE` / `TRUNCATE` | Data engineer |
| RR-210 | S3 | P | Workload hygiene: no requests/limits on stateful pods, OM probe, failed pods | Platform/SRE |
| RR-211 | S3 | R | End-of-life components and no vulnerability scanning | Platform |
| RR-212 | S3 | P | Out-of-git live configuration: unmanaged console, ingresses, host ports | Platform |
| RR-213 | S4 | R | Audit client IP spoofable; no audit retention | Gateway dev |
| RR-214 | S2 | P | Any staff user (incl. external researcher) gets full MLflow and Superset SQL Lab | Platform + security |
| RR-215 | S3 | R | Access tokens stay valid for up to 30 min after logout | Gateway dev + identity |
| RR-301 | S2 | D | Four Ethiopian lanes never landed (HCMIS, mBrana, Climate, MFR facilities) | Data engineer + partner liaison |
| RR-302 | S1 | P | All data is synthetic or demo seed; a pilot needs real, owner-approved data | Product owner + data owner |
| RR-303 | S2 | P | Data-protection applicability and small-cell threshold not established | Product owner + legal |
| RR-401 | S1 | D | No forecast accuracy figure in the repository can be cited; three conflicting stories | ML lead |
| RR-402 | S2 | P | Front-door docs describe a different system | Tech lead |
| RR-403 | S2 | P | `security.md` overstates identity hardening | Security lead |
| RR-404 | S2 | P | Only readiness verdict is a stale July snapshot that contains a credential | Tech lead |
| RR-405 | S2 | P | Agent prompts, AI traces and private paths committed to the shared repo | Repo maintainers |
| RR-406 | S2 | D | eLMIS volumes in docs and lineage claims are false | Data engineer + metadata owner |
| RR-407 | S3 | D | Presentation guide has no PCT page and describes empty widgets | Product/demo lead |
| RR-408 | S3 | P | CI/CD doc contradicts the workflows | Release manager |
| RR-409 | S3 | P | Dictionaries, changelog, decision records, deployment plan and profile doc drift | Maintainers |
| RR-410 | S4 | R | Broken repo-path references in 7 READMEs | Maintainers |
| RR-501 | S3 | P | Accessibility: WCAG 2.2 AA gaps (see coverage map §8) | Frontend |
| RR-502 | S3 | R | No internationalisation (Amharic and other languages) | Frontend |

---

## RR-0xx Confirmed defects

### RR-001 Gateway access log readable anonymously from the internet
- **Severity / blocks:** S1 · D (it is a live exposure, whatever the audience).
- **Impact:** anyone on the internet can read the full gateway access log. Each row holds username, full name, email,
  client IP, user agent, JWT id, Keycloak subject and the filters used. At the time of the check that was 8,879 rows
  covering every staff user who has used the platform. This is a personal-data disclosure, and it helps an attacker
  pick targets for RR-201.
- **Evidence `[live]`:**
  - `curl -sk https://gateway.20.84.70.78.nip.io/api/audit/events` with no credential returns `200` and a paged list
    with those fields.
  - It was confirmed twice, the second time via the public IP with `--resolve`.
  - See B2 §1.1 and §12 S-01.
- **Cause (confirmed):**
  - `routes/audit.py:14-33` depends only on `get_user` and has no capability check.
  - With `GATEWAY_PUBLIC_ANON=true` (live), `auth.py:174-180` maps a request with no credential to the `R-PUB-ANON`
    principal.
  - Ingress `ing-gateway` routes `/` publicly.
  - The September baseline recorded this as "any logged-in user"; it is in fact anyone.
- **Resolution:**
  1. Add `require_cap(user, "admin.audit.read")`, or an OPA decision, to the route.
  2. Add a shared dependency that rejects `R-PUB-ANON` on every non-public router.
  3. Restrict `ing-gateway` to the public allow-list (`/api/public/*`, `/api/profile*`,
     `/api/permissions/{dashboard/public,widget/pub-*}`, `/health`). Everything else goes through the dashboards'
     `/gw` proxies.
  4. Add a CI test that anonymously GETs every route and asserts 401/403 except for the allow-list.
  5. Treat this as a possible disclosure: query `gateway_log` for `path='/api/audit/events' AND kc_sub IS NULL`, and
     let the data owner decide on notification.
- **Dependencies:** none. **Effort:** 0.5–1.5 d. **Uncertainty:** low.
- **Acceptance:**
  - An anonymous GET returns 401/403 via the public IP.
  - A logged-in non-admin user gets 403.
  - The anonymous-route test is green in CI.
- **Verify:** curl from outside the VM; CI log.

### RR-002 eLMIS loaded twice: every eLMIS / PCT / Control Tower volume ≈4× too high
- **Severity / blocks:** S1 · D (any PCT or eLMIS figure).
- **Impact:** every number on the primary demo surface is wrong: stock on hand, AMC, units to ship, KPI denominators
  and the forecast's training data. The errors are not a uniform multiple. Duplicated context also attaches lines to
  the wrong facility or product, so the numbers cannot be "divided by four".
- **Evidence `[live]`:**
  - Mart Σ dispensed is 1,570,993,435, against 394,083,470 at source (×3.99).
  - Raw vault `lnk_elmis_hist_requisition_line` has 5,208,578 rows, against 2,607,247 source lines, from two loads at
    2026-09-22 02:30 and 03:14.
  - The requisition link has 326,317 rows against a hub of 163,453.
  - Position rows: 39,757 against 15,175 pairs. Stock on hand 16.98M against 4.16M. AMC 5.87M against 2.20M.
  - See B1 §4, E Q10, C-10.
- **Cause (confirmed):** the eLMIS source was re-generated between two lake writes with different context keys. The
  insert-only links keep both contexts, and the marts join both links (2×2).
- **Resolution:**
  1. Merge the existing fix commit `c83f0f9` (branch `fix/abeni-elmis-current-context`, local and unpushed). It adds
     driving-key "current" link views, repoints 7 marts and adds the singular test `elmis_lines_counted_once`.
  2. Rebuild the marts.
  3. **Ship it in one rollout with RR-003.** Applied alone, the fix *grows* the Control Tower plan from 11.08M to
     17.73M units, because the inflated forecast then sizes orders against correct stock.
  4. Separately, decide whether to clean the raw-vault links (data architect).
- **Dependencies:**
  - RR-003 (same rollout).
  - RR-206: the CI runner checkout holds about 395 uncommitted live lines. They include the only copy of the eLMIS
    synthesizer, and any CI run would wipe them.
- **Effort:** 1–2 d plus a rebuild window. **Uncertainty:** medium. The "after fix" figures come from a 2026-09-29
  scratch rebuild and have not been re-run.
- **Acceptance:**
  - `mart_elmis_hist_facility_product_month` row count and Σ dispensed equal the source exactly.
  - `elmis_lines_counted_once` passes in CI.
  - Position ΣSOH ≈ 4.16M.
- **Verify:** the reconciliation SQL in B1 §5 (B-01), re-run after the rebuild.

### RR-003 Forecast promotion rule not enforced; plan sized on a non-citable forecast
- **Severity / blocks:** S1 · D.
- **Impact:** the forecast contract (`docs/pct-forecast-contract.md` §6/§8) says a forecast drives planning only if it
  beats baselines. Live, 39,711 of 39,757 position rows are planned on the P50 of model v1. That model was trained
  2026-09-22 08:23 on the double-loaded data, and its logged metrics (MASE 0.887) must not be cited. On corrected data
  the offline backtest's interval coverage is 93.1% against a 90% rule, so the rule fails and the contract says the
  plan must fall back to AMC (about 2.78M units).
- **Evidence:**
  - `[live]` MLflow alias `champion` → v1, run `1da70af1…`.
  - `[live]` `mart_pct_position.planning_basis` is 99.9% `forecast_p50`.
  - `[static]` `champion_rule_passed` is logged at `train.py:319-320` but read by no code; the alias is set
    unconditionally at `mlflow_io.py:165-166`; the runner defaults to `--alias champion` (`runner.py:448`).
  - See E-02, A R4.
- **Cause (confirmed):** the contract rule was never wired into promotion or into mart gating.
- **Resolution:**
  1. Gate alias promotion on `champion_rule_passed = 1`, and make the runner default to no alias.
  2. Retrain on corrected data (after RR-002).
  3. If the rule still fails, remove `@champion` so the position mart plans on `elmis_amc_not_champion`.
  4. Regenerate the model card from the MLflow run (RR-401).
- **Dependencies:** RR-002. **Effort:** 1–2 d. **Uncertainty:** low.
- **Acceptance:**
  - A promotion test refuses a rule=0 run.
  - While the rule fails, 100% of position rows show an AMC basis and plan units ≈ the AMC-based total.
  - The model card's run id equals the champion's run.
- **Verify:** unit test, plus SQL on `mart_pct_position`.

### RR-004 Running images are not the reviewed commit, and nothing records which commit runs
- **Severity / blocks:** S1 · D. A reviewer cannot reproduce what they are shown, and the demo misses merged work.
- **Impact:**
  - The Control Tower on screen lacks the forecast range, the month-on-month deltas and KPI rings, and the plan-load
    retry. All of these are in `develop`.
  - The live gateway carries `pub-zm-*` fetchers that exist in no git commit.
  - Every custom image is tagged `nhdw/*:1.0.0` with no revision label, so "what is running?" cannot be answered.
- **Evidence `[live]`:**
  - The internal-bi bundle `index-CWw2EqVN.js` and the gateway `ct.py` are both dated 2026-09-21 20:31 UTC. That is
    after d6d0715 but before e42ca8a (20:54) and 9283151 (21:27), and all three are in `develop`.
  - The bundle has 0 hits for `forecastP10`, and its tab still reads "Optimized routes".
  - Live `fetchers.py` md5 differs from the repo.
  - Helm release rev 7, but the gateway deployment is at rev 66, so it was changed by hand.
  - See E-03, C-01, B2 §10.
- **Cause (confirmed):** images were built from working trees and redeployed under a reused tag. The Kubernetes
  manifests match `develop`, but the image contents do not.
- **Resolution:**
  - Rebuild every custom image from a tagged commit. Tag by git SHA and add the `org.opencontainers.image.revision`
    label.
  - Commit or remove the `pub-zm-*` code.
  - Record the deployed SHA (ConfigMap or annotation) and expose it on `/health`.
- **Dependencies:** RR-206 (runner checkout). **Effort:** 0.5–1 d for the rebuild, plus RR-206 for durability.
- **Acceptance:**
  - Every `/app/**/*.py` md5 equals `git show <tag>:…`.
  - The bundle contains `forecastP10`.
  - `/health` returns the SHA, and it equals `origin/develop`.
- **Verify:** script comparing live files with the tag.

### RR-005 Control Tower page is disabled under the live profile
- **Severity / blocks:** S1 · D. The PCT/Control Tower is the primary demo surface.
- **Impact:** the active profile `et-v3` disables the page `internal-bi/control-tower` for every role, so it is elided
  from navigation. `/api/ct/plan` still serves data. A demo on this host cannot reach the Control Tower without a
  profile change.
- **Evidence `[live]`:**
  - `GET /api/profile/catalog` lists the page as disabled (C §2.5, C-20).
  - The gateway env pins `NHDW_PROFILE=et-v3`.
  - `/opt/nhdw-state/ACTIVE` = `et-v3`, but `/opt/nhdw-profiles/ACTIVE` = `zm-v1`: two pointers that disagree.
  - Logged-in walk with 11 users across both realms (D §2.2, D-02): the page is in no role's navigation, and
    `/gw/permissions/dashboard/internal-bi/spec` never lists it.
  - The Zambian seed users (`users.zm.yaml`) do not exist in Keycloak (D-03), so a Zambian persona cannot log in either.
- **Cause (confirmed):** the PCT data is Zambian eLMIS, while the live profile is the Ethiopian profile, rebranded to
  Palladium in place (RR-011).
- **Resolution:** an explicit product decision (see [assessment §6](01-readiness-assessment.md#6-decisions-needed)):
  - **either** run the demo on `zm-v1`;
  - **or** enable the Control Tower page under the demo profile with a visible "Zambia eLMIS 2017–2018 historical
    replay" banner.

  In both cases, make one ACTIVE pointer authoritative and gate `/api/ct/plan` by the same catalogue switch.
- **Dependencies:** decision. **Effort:** 0.5 d once decided.
- **Acceptance:**
  - The Control Tower is visible to the demo roles in the demo profile.
  - With the page disabled, `/api/ct/plan` returns 403.
  - Only one ACTIVE pointer exists.
- **Verify:** logged-in walk (demo script preflight).

### RR-006 Public portal fabricates KPIs, region bars and a random trend when data is missing
- **Severity / blocks:** S1 · D. It is latent, one gateway error away.
- **Impact:** if any public widget call fails, returns empty or is disabled, the public portal shows invented numbers
  as if they were real:
  - EDHS-style KPI tiles (e.g. Penta3 40%, which contradicts the live 96.9%);
  - hard-coded 14-region bars;
  - a trend line generated with `Math.random()`, which differs on every page load.

  Nothing on screen marks the data as offline.
- **Evidence:**
  - `[static]` `public/ui/src/hooks/widgetData.ts:12-38` (any failure → `null` "so callers keep rendering their static
    mockup-fidelity data").
  - `[static]` `pub-insights/index.tsx:151-160,190-192` (`KPIS_FALLBACK`).
  - `[static]` `hooks/charts.ts:43-54` (bars) and `:92-107` (`Math.random`, present in the live bundle).
  - `[static]` The profile `fallback_kpis` key in `copy/public.json`.
  - See C-02.
- **Cause (confirmed):** a mock-up-fidelity rule ("always render something").
- **Repro:** disable `pub-insights` in the admin console (in a non-shared environment), or block
  `/api/proxy/widget-data/*`, and reload the public home page.
- **Resolution:**
  - Delete every fallback array and random series.
  - Render an explicit "Data temporarily unavailable" or "Not published" state.
  - Drive public page composition from the resolved spec, so a disabled widget is hidden.
- **Effort:** 0.5–1 d.
- **Acceptance:**
  - With the gateway unreachable, the public page shows no numeric tile and no chart series.
  - `grep -rn "Math.random\|KPIS_FALLBACK\|fallback_kpis" public/ui/src` returns nothing.
  - A disabled widget is absent from the DOM.
- **Verify:** fault-injection test in CI (mock the fetch to fail).

### RR-007 Open-data catalogue shows 12 fabricated datasets live; download button is dead
- **Severity / blocks:** S1 · D (if the Data page is shown).
- **Impact:** the public "open data" page lists 12 datasets that do not exist. They come with fake DOIs
  (`10.x/nhdw/D-00n`), fake download counts and claims such as "all 1,148 woredas" and "CSA estimates". The download
  button does nothing.
- **Evidence:**
  - `[live]` `GET https://public…/api/proxy/catalogue` returns 404 (`nhdw-static/catalogue.json` is absent).
  - `[static]` `useDatasets.ts:109` falls back to `data/datasets.ts:19-31`.
  - `[static]` `pub-data-catalogue/index.tsx:279` has `href="#"`.
  - See C-03.
- **Cause:** the manifest was never produced after the rebuild `[hyp]`, combined with the fallback.
- **Resolution:**
  - Restore or run the publish step so the manifest exists, or show "No datasets published yet".
  - Delete `DATASETS`.
- **Effort:** 0.5–1.5 d.
- **Acceptance:**
  - The catalogue lists only manifest entries, each with a working download.
  - With no manifest, the empty state is shown.
- **Verify:** curl the manifest; click-through of each download in the walk.

### RR-008 Public newsroom shows seeded mock bulletins attributed to real institutions
- **Severity / blocks:** S1 · D (shown as real content to a customer).
- **Impact:** ten "articles" attributed to EPHI, the FMoH Minister and EFDA (including a vaccine lot advisory) are
  invented. Showing them as real to a ministry or donor audience is a credibility and reputational risk.
- **Evidence:**
  - `[live]` `ops_governance.public_article` has 10 rows (2026-04-21 to 06-14). Their ids and text match the bundled
    mock `ARTICLES` (`public/ui/src/data/articles.ts:17+`).
  - See C-04.
- **Resolution:**
  - Remove the seeded articles and the bundled fallback, or watermark each one "Sample content".
  - Publish only through the CMS path by an authorised editor.
- **Effort:** 0.5 d.
- **Acceptance:**
  - No article is attributed to a real body unless an authorised editor published it.
  - The fallback array is deleted.
- **Verify:** SQL count of seeded ids; bundle grep.

### RR-009 Every "coverage" metric is actually a reporting rate
- **Severity / blocks:** S1 · D (Service and Overview pages).
- **Impact:** the HMIS coverage mart defines `coverage_pct` as facilities reporting ÷ facilities expected. Every widget
  that says "coverage", "attainment" or "on track" therefore shows reporting completeness:
  - maternal mortality, stunting, malaria incidence and hypertension control all read "98.7% on track";
  - "Average coverage" reads 94.7%;
  - the reliability composite counts the same metric twice.

  A health-ministry reviewer will spot this at once.
- **Evidence:**
  - `[static]` `2_pipelines/marts/models/hmis_coverage/mart_hmis_indicator_coverage.sql:156-158`.
  - `[live]` A Trino replay of the gateway SQL for `sv-flagship-table` and `sv-topline-kpis`.
  - See C-08.
- **Resolution:**
  - Rename the column to `reporting_rate_pct` and relabel the widgets.
  - Compute true indicator values (numerator ÷ target population, or the DHIS2 indicator value) for coverage-type
    indicators only.
  - Drop "on track" for lower-is-better rates (MMR, incidence, stunting) or give them the correct target direction.
- **Effort:** 2–4 d. **Uncertainty:** medium. It needs indicator metadata (numerator and denominator) from the DHIS2
  seed.
- **Acceptance:**
  - No widget labelled coverage reads `coverage_pct`.
  - MMR and stunting show in their own units with the correct direction.
  - A dbt test asserts that coverage ≠ completeness.
- **Verify:** dbt test; walk of the Service page.

### RR-010 Missing data rendered as a genuine zero
- **Severity / blocks:** S1 · D (Resource page; Overview tiles).
- **Impact:** empty marts and NULL columns show as real zeros:
  - "0 commodities at risk … 0 already in stockout … 0 services exposed";
  - "Commodities stocked out 0";
  - "No stockouts in the last 12 months" (on an empty mart);
  - timeliness "0%";
  - cold-chain batches "0";
  - supply availability "0%".

  A user reads good news where there is no data at all.
- **Evidence:**
  - `[static]` 128 `?? 0` coercions in 45 internal-bi widgets, e.g. `rm-hero/widget.ts:47-54`,
    `sv-flagship-table/widget.ts:40`, `ov-national-kpis/widget.ts:14-16`.
  - `[live]` Fetchers aggregate over an empty base (count → 0).
  - See C-12.
- **Resolution:**
  - Fetchers return no row, or NULL, when the base is empty.
  - Widgets render "—" or "Not measured" for NULL.
  - Add an `n_rows` or coverage field.
  - Show "no stockouts" copy only when the base has rows.
- **Effort:** 1–2 d.
- **Acceptance:** with an empty mart, no widget shows a numeric 0 (fault-injection test over all mounted widgets).
- **Verify:** test fixture with empty marts; logged-in walk.

### RR-011 Public hero shows raw template placeholders; live profile lives outside git
- **Severity / blocks:** S2 · D (visible at the top of the public page).
- **Impact:**
  - The public portal shows `[Palladium · {ministry.native_name}]` in the top strip and `[{platform.native_name}]`
    mid-page.
  - More importantly, the whole Palladium rebrand exists only in a host directory (`/opt/nhdw-profiles/et-v3`), not
    in git. A rebuild from the repository would silently restore the Ethiopian Ministry branding.
- **Evidence:**
  - `[live]` `GET /api/proxy/profile/copy/public` returns `strip_owner: "Palladium · {ministry.native_name}"` and
    `headline_native: "{platform.native_name}"`.
  - `[live]` The host copy deck lines 18 and 22 reference keys that the rebranded `profile.yaml` no longer has.
  - `[static]` The resolver deliberately leaves unknown placeholders visible (`routes/profile.py:294-305`).
  - `[live]` `bundle/profiles/et-v3` differs from the host copy. The file is owned by a different operator account.
  - See C-06.
- **Resolution:**
  1. In the live deck, set `headline_native: ""` and `strip_owner: "{ministry.name} · {country.name}"` (the `zm-v1`
     deck already does this).
  2. Commit the rebranded profile to git, either as its own profile key or as committed `et-v3` edits.
  3. Make one ACTIVE pointer authoritative (RR-005).
  4. Add a CI check that every placeholder in every deck resolves against its profile.
- **Effort:** 0.5 d.
- **Acceptance:**
  - No `{…}` appears in any `/api/profile/copy/*` response.
  - The host profile equals git.
  - The CI check is green.
- **Verify:** curl; diff; CI.

### RR-012 `mart_data_quality` never built: Disease map and source pulse return 502
- **Severity / blocks:** S2 · D (the Disease page map is a likely demo stop).
- **Impact:**
  - `dz-region-map` (default map shape) and `ov-source-pulse` fail with 502, which shows as "no data".
  - `/api/dq/sources` and `/api/dq/dimensions`, and the admin DQ panels that use them, fail too.
  - `bi_public.mart_public_data_quality` is also absent.
- **Evidence:**
  - `[live]` The gateway log reports `TABLE_NOT_FOUND marts.bi_quality.mart_data_quality`, with 19 + 8 502s in 7 days.
  - `[static]` The model exists at `2_pipelines/marts/models/data_quality/mart_data_quality.sql`.
  - See B-05, C-13.
- **Cause:** `[hyp]` the model failed or was deselected in the 2026-09-22 marts build, and its upstream sources are
  empty (RR-301). The build logs are gone (Job TTL).
- **Resolution:**
  - Run `dbt build -s mart_data_quality+` in a controlled refresh, tolerating empty sources.
  - Give the widget a distinct error state (RR-016).
  - Keep marts-build logs, either with a longer Job TTL or by shipping them to Loki.
- **Effort:** 0.5–1 d.
- **Acceptance:** the relation exists; both widgets render; `/api/dq/sources` returns 200.
- **Verify:** `to_regclass`; walk.

### RR-013 Programme attribution collapsed to `OTHER`; cascades empty; brief prints a nonsense line
- **Severity / blocks:** S2 · D (the Overview brief is the first thing on the internal BI landing page).
- **Impact:**
  - All 547,965 HMIS coverage rows and 828 cascade rows carry programme `OTHER`.
  - The four cascade funnels are empty, and the programme filter does nothing.
  - The Overview brief reads "Weakest cascade: OTHER retains 0.0% of entry cohort".
  - **A programme-scoped user sees nothing.** The HIV programme director (R-PD-HIV) gets 0 new cases, "—" and empty
    Service widgets, because no row carries `HIV` (D-05).
- **Evidence:**
  - `[live]` `SELECT programme_id, count(*)` returns only `OTHER`.
  - `[live]` The `ov-brief` replay.
  - See C-09.
- **Cause:** `[hyp]` the source codes in `v_programme_resolution` do not match the DHIS2 indicator ids in this seed.
- **Resolution:**
  - Fix the mapping in the business vault.
  - Make `ov-brief` skip the cascade line when the programme is unknown or the base is empty.
  - Fix the cascade key duplicates.
- **Effort:** 1–2 d.
- **Acceptance:**
  - At least 4 programmes appear in coverage and cascades.
  - The cascade unique-key test passes.
  - The brief never prints `OTHER`.
- **Verify:** SQL; walk.

### RR-014 Same-named KPIs disagree; invalid aggregations; labels contradict SQL thresholds
- **Severity / blocks:** S2 · D (side-by-side contradictions are visible on the Overview and Service pages).
- **Impact and evidence (each item `[live]` replay + `[static]` file):**

  | Sub-ID | Problem | Evidence |
  |---|---|---|
  | **a** | "Reporting completeness" is 100%, 91.1% and 99.1% on different widgets under the same label | — |
  | **b** | "Facilities reporting" is 19,128, summed across 50 indicators, against 893 facilities | `sv-topline-kpis` |
  | **c** | "893 active-but-silent facilities" = 100% of the registry: an empty HCMIS heartbeat compared against the wall clock, while the data ends 2026-06. The label says 30 days; the SQL uses 60 | `mart_facility_capacity.sql:107-108` |
  | **d** | Agreement-donut labels (≥95 / 80–94 / <80) do not match the SQL bands (≥80 / 50–80 / <50) | `sv-agreement-donut/widget.ts:22-24` vs `fetchers.py:1268-1270` |
  | **e** | "New cases reported this week" shows the whole-period total (131,432; the weekly figure is 1,976) | `ov-disease-snapshot/widget.ts:48` |
  | **f** | Composite scores zero-fill missing components (`COALESCE(readiness,0)·0.25`, which caps the score at 75); the code comment says 0.6/0.4 while the code uses 0.40/0.35/0.25 | `fetchers.py:1105-1129` |

  See C-15 to C-18 and C-24.
- **Resolution:**
  - A metric dictionary: one definition per KPI name, with its grain.
  - Fix `b` to count distinct facilities.
  - Derive `c` from DHIS2 reporting at the data's max date.
  - Share threshold constants between SQL and UI for `d`.
  - Relabel or recompute `e`.
  - Renormalise or return NULL for `f`.
- **Effort:** 1.5–3 d.
- **Acceptance:**
  - Widgets with the same label return the same value for the same scope.
  - Unit tests assert label bounds = SQL bounds.
  - The silent count ≤ expected − reporting.
- **Verify:** metric-dictionary test; walk.

### RR-015 Public figures claim "all 14 regions" / national scope from 5 regions
- **Severity / blocks:** S2 · D.
- **Impact:**
  - The public KPI tiles and "Coverage by region" are labelled national and "all 14 regions". The latest month
    covers 5 regions and about 67 facilities.
  - Under-5 stunting appears as a monthly routine figure (46.9%, +5.6 pp month on month), which is implausible for a
    survey-type outcome.
  - The data month is not shown.
- **Evidence:**
  - `[live]` `pub-region` returns 20 rows (5 regions × 4 indicators).
  - `[static]` `pub-insights/index.tsx:260,268`.
  - See C-07.
- **Resolution:**
  - Show the number of regions, the number of facilities and the data month on every tile and chart.
  - Drop or relabel survey-type outcomes unless they are survey-sourced.
  - State the roll-up weighting.
- **Effort:** 1–2 d.
- **Acceptance:** each public number shows its coverage and as-of month; there is no "all 14 regions" text unless 14
  are present.
- **Verify:** walk; bundle grep.

### RR-016 Error, denied, empty and loading states are indistinguishable; failures cached
- **Severity / blocks:** S2 · P.
- **Impact:**
  - In internal BI, a 403, a 502, an empty result and a still-loading call all show one grey "No data available"
    message.
  - A failure is cached for the whole session.
  - The deployed Control Tower caches a failed plan load until a full reload, and shows the same "No plan data
    available." for a failure, a 403 and an empty plan.
  - Users cannot tell "you may not see this" from "the system is broken" from "there is nothing".
  - **An expired session looks like missing data.** Access tokens last 30 minutes and are never refreshed. After 31
    minutes idle, navigating produces 7 failed calls and "No data for the selected filters", not a sign-in prompt
    (D-20).
- **Evidence:**
  - `[static]` `internal-bi/ui/src/runtime/dataHook.ts:38-46`.
  - `[static]` `ct/mount.tsx:63`.
  - `[live]` The bundle function caches the CT failure.
  - See C-14, E-07.
- **Resolution:**
  - Use a typed result `{status: ok|empty|denied|error|stale, asOf}`.
  - Add host-level skeleton, error and denied states.
  - Never cache failures.
  - Add a retry control.
- **Effort:** 1–2 d.
- **Acceptance:** fault injection (403, 502, empty, slow) produces four distinguishable states, and a retry recovers
  without a reload. A 401 from an expired token triggers a silent refresh or a sign-in prompt, never an empty widget.
- **Verify:** component tests with a mocked fetch.

### RR-017 Latent fabricated content shipped in bundles and an anonymous placeholder API
- **Severity / blocks:** S2 · P.
- **Impact:** fabricated numbers sit one code path away from display, and one is already served anonymously:
  - `ov-benchmarks` (a mounted Overview widget) falls back to `DEFAULTS` (17,550 facilities / 107.3M / 14 / 1,082) on
    empty or error.
  - `ov-outbreak-hero` is fully hard-coded ("528 cases, CFR 6.6%").
  - The live internal-bi bundle ships the 2.1 MB Ethiopian EPSS synthetic plan (`EPSS Addis Ababa Central Hub`,
    baseline 83%) through `import * as STATIC` (`ct/data/runtime.ts:10`).
  - The anonymous public endpoint `/api/series/{slug}` serves hard-coded statistics
    (`public/app/main.py:545-596`).
- **Evidence `[live]`:**
  - A bundle grep shows `EPSS Addis Ababa Central Hub` = 1 hit and `Ayder` = 1 hit.
  - `curl /api/series/national-coverage` returns `[86,88,89,90]`.
  - See C-05, C-19, E-15.
- **Resolution:**
  - Delete `DEFAULTS`, `ov-outbreak-hero` (or bind it to data), the static plan module (use `import type`) and the
    `/api/series` endpoint.
- **Effort:** 0.5–1 d.
- **Acceptance:**
  - `grep` over the source and the built bundles finds no numeric fallback literals, "EPSS" or "Ayder".
  - `/api/series/*` returns 404.
- **Verify:** CI grep guard on the built bundles.

### RR-018 Plan-decision record is mutable and its audit is best-effort
- **Severity / blocks:** S2 · P (pilot decisions must be trustworthy).
- **Impact:** the approve/reject log is described as append-only but is not:
  - The gateway role can UPDATE any column, there are no triggers, and the admin role can DELETE or TRUNCATE.
  - The audit write happens outside the transaction and swallows failures, so a decision can persist with no audit
    row.
  - Denied attempts are not logged.
  - A verdict attaches to a line by id only, so after a rebuild an "Approved" badge can sit on changed units.
  - If the decision store is unreachable, decided lines silently show as "Planned" with live buttons.
- **Evidence:**
  - `[live]` `information_schema.role_table_grants` and `pg_trigger` (0 triggers).
  - `[static]` `3_storage/postgres/init/42_pct_plan.sql:19-48`.
  - `[static]` `routes/ct.py:185-197,215-279,416-418`.
  - `[static]` `ops_db.py:211-223`.
  - `[live]` 1 decision exists, with 1 matching audit row; it survived 2 Postgres restarts.
  - See E-08, E-09, E-10, B2 S-10.
- **Resolution:**
  - Grant only column-level `UPDATE(recorded_to)`, and add a trigger that blocks other updates and deletes.
  - Write the audit record in the same transaction.
  - Log denials.
  - Add `reverted_by`.
  - Mark a verdict "stale" when current units ≠ `units_recommended` or the forecast run changed.
  - Fail visibly (`decisionsAvailable:false`) when the store errors.
- **Effort:** 1.5–2.5 d.
- **Acceptance:**
  - An UPDATE of a payload column or a DELETE as the gateway role fails.
  - Every decide, revert and deny has an audit row (integration test).
  - After a units-changing rebuild, the line shows "Approved (stale)".
- **Verify:** integration test against a scratch DB.

### RR-019 OpenMetadata lineage broken behind a "success" DAG; OM unstable
- **Severity / blocks:** S2 · P. It is S1 for any governance or lineage claim.
- **Impact:**
  - The catalogue cannot show source → mart → widget lineage: 0 lineage edges reach any `bi_*` mart, and the
    configured depth is 2/2.
  - The ingestion DAG reports success daily because the dbt steps are "best-effort".
  - The OM server has restarted 82 times (liveness timeout 1 s).
- **Evidence:**
  - `[live]` `entity_relationship`: 428 table→table edges, none into marts.
  - `[live]` The ingest log reports "No valid dbt manifest.json" and staging FQNs with the schema repeated
    (`nhdw_staging.nhdw_staging`).
  - `[live]` Pod restart count.
  - See A R7, B-07.
- **Cause:**
  - Confirmed: the DAG masks the failure.
  - `[hyp]`: the marts manifest was not published to the lake after the rebuild, and the ClickHouse database mapping
    is wrong.
- **Resolution:**
  - Publish the marts dbt artifacts.
  - Fix the FQN mapping.
  - Reseed the lineage depth.
  - Make the dbt-lineage step fail the run.
  - Raise the liveness timeout and add a startupProbe.
- **Effort:** 1–3 d.
- **Acceptance:**
  - An OM lineage walk source → widget succeeds for every exposure-bound widget (count = widget count).
  - The DAG fails when lineage ingestion fails.
  - OM has 0 restarts in 7 days.
- **Verify:** lineage walk script; DAG test.

### RR-020 Warehouse refresh DAG would report success without building anything
- **Severity / blocks:** S2 · P (it becomes the scheduler in RR-101).
- **Impact:** if `pipeline_refresh` were unpaused, four of its stages (`ch_raw_views`, `dbt_vault`, `dbt_marts`,
  `publish_datasets`) would run their images' default `--help` and exit 0. That is a false green.
- **Evidence `[static]`:** `5_orchestrator/dags/pipeline_refresh.py:193-196`, which passes `arguments=[]`. Its PG env
  and cold/warm logic are missing, and it uses `HOST="host.k3d.internal"`. Not run (read-only assessment). See B-03.
- **Resolution:**
  - Reuse the command, args and env from `1_infrastructure/k8s/base/dbt-jobs.yaml` in the KPOs.
  - Add a row-count assertion after each stage.
- **Effort:** 1–2 d.
- **Acceptance:**
  - A test run in a scratch environment builds the marts.
  - An injected empty stage fails the DAG.
- **Verify:** scratch run log.

### RR-021 UI and docs overstate analytics capability
- **Severity / blocks:** S2 · D.
- **Impact:** the demo surface makes claims the code does not support:
  - **"Optimized routes"** (deployed tab label). The code does sweep ordering around an inferred district store, on
    straight-line distances, compared with a one-round-trip-per-facility baseline ("km saved 65%"). There is no
    vehicle, capacity, cost or schedule data.
  - **P(alarm) 100%**, "Immediate", "alarm coverage 100%". These are daily re-runs on a static seed by models whose
    validity on this data is unestablished.
  - `docs/production-readiness-assessment.md:41` **"ML / forecasting Met: drift + retrain"**, while drift-check fails
    every night.
- **Evidence:**
  - `[static]` `mart_ct_vehicle_runs.sql:5-7,58-68`.
  - `[live]` Bundle string.
  - `[live]` Trino replay of `dz-kpi-strip` and `ov-act-first-woredas`.
  - See E-12, C-26.
- **Resolution:**
  - Label the routes "Sweep routes (straight-line)" and state the baseline in the UI.
  - Show model outputs as bands, capped at "≥95%", with the model version and as-of date.
  - Suppress "Immediate" for unvalidated models.
  - Amend the readiness doc (RR-404).
- **Effort:** 0.5–1 d.
- **Acceptance:**
  - No "Optimi[sz]ed" in the deployed bundle for the Control Tower.
  - No displayed probability of 100%.
  - The baseline text is visible.
- **Verify:** bundle grep; walk.

### RR-022 `stockout_forecast` scheduled but never registered: nightly failures, 112 failed pods
- **Severity / blocks:** S3 · P. It hides real failures.
- **Impact:**
  - The `ml_batch_predict` and `ml_drift_check` DAGs fail every night (28/28), and 112 failed pods have accumulated.
  - The other five models do predict, but on 28-day-old inputs.
- **Evidence:**
  - `[live]` All failed pods run `predict-batch stockout_forecast` and fail with "Registered model alias champion not
    found".
  - `[live]` `ops_ml.model_deployment` enables the model; its training input returned 0 rows.
  - See B-06, E-06.
- **Resolution:**
  - Disable the deployment row until its input mart is populated.
  - Set `on_finish_action`/TTL cleanup on KubernetesPodOperator pods.
- **Effort:** 0.5 d.
- **Acceptance:** zero failed ML pods for 3 consecutive nights, and both DAGs green.
- **Verify:** `kubectl get pods`; DAG runs.

### RR-023 `/api/exports/me` and `/api/reports/templates` return 500
- **Severity / blocks:** S3 · P (D if exports are demonstrated).
- **Evidence:**
  - `[live]` The gateway log has `ValueError: invalid UUID ''` (3× on the day).
  - `[live]` `/api/reports/templates` 500 ×2.
  - See B-09.
- **Cause:** `[hyp]` a principal without an ops user UUID (anonymous, impersonated or PAT) reaches a UUID cast.
- **Resolution:** guard against an empty subject; return 401/403 or an empty list; add a test.
- **Effort:** 0.5 d.
- **Acceptance:** both routes return 2xx for a valid user and 401/403 anonymously.

### RR-024 Admin Documentation page empty; served doc copies stale
- **Severity / blocks:** S3 · P.
- **Evidence:**
  - `[live]` The `nhdw-docs` bucket has 0 objects.
  - `[static]` `bundle/docs/{security,data-and-ml,data-dictionary}.md` differ from `docs/`.
  - See A-11.
- **Resolution:** re-sync and reseed the bucket; add a CI diff guard between `docs/` and `bundle/docs/`.
- **Effort:** 0.5 d.
- **Acceptance:** the admin Documentation page lists the served docs, and the CI guard is green.

### RR-025 Dashboards fetch profile/reference data without a token: 401s, region filter empty
- **Severity / blocks:** S2 · D. The region filter is a standard demo step.
- **Impact:**
  - On every load of internal BI, admin and workshop, 2–4 calls to `/gw/profile`, `/gw/profile/reference` and
    `/gw/profile/copy/common` return 401. They appear as console errors.
  - The reference catalogue (regions) is therefore empty, so national users' Region filter offers only "All areas",
    and the logo and abbreviation fall back to bundled defaults.
- **Evidence:**
  - `[live]` Network capture on every logged-in page (D §2.2, D-07).
  - `[static]` `internal-bi/ui/src/sections/Sidebar.tsx:30` and `widgets/_shared/reference.ts:129` use plain `fetch`
    instead of `authFetch`.
- **Resolution:** use `authFetch` (or serve profile reads without auth, as the public portal does).
- **Effort:** 0.25 d.
- **Acceptance:** 0 console 401s on load, and the Region chip lists every region for a national user.
- **Verify:** headless walk network log.

### RR-026 Mixed branding and leftover placeholders across apps
- **Severity / blocks:** S2 · D (a Palladium-branded demo).
- **Impact:** the same session shows three identities, and placeholder configuration is visible:
  - "Palladium" on the public portal.
  - "Federal Ministry of Health · Ethiopia" in page titles and the workshop title.
  - A hard-coded "NHDW v1.0 · PROD · National Health Data Warehouse" sidebar footer.
  - On the admin SSO page: "Client ID: TODO_GOOGLE_CLIENT_ID", a Fayda issuer `http://localhost:8096`, and "EHIA SAML
    Federation (mock)".
- **Evidence:**
  - `[live]` Page titles and text scans (D §2, D-03, D-09).
  - `[static]` `internal-bi/ui/src/sections/Sidebar.tsx:79-80`.
  - `[static]` Seeded IdP values.
- **Resolution:**
  - Read every title, footer and brand string from the profile.
  - Hide unconfigured IdPs, and label the mocks as such or remove them from the demo profile.
  - Add a CI text scan over the rendered pages for `TODO`, `localhost` and `{…}`.
- **Effort:** 0.5–1 d.
- **Acceptance:** a text scan of every page finds no `TODO`, `localhost` or `{…}`, and exactly one brand.

### RR-027 Control Tower plan API not programme-scoped and 14.5 MB per load
- **Severity / blocks:** S3 · P.
- **Evidence `[live]`:**
  - `GET /gw/ct/plan` returns the same 14.5 MB to the HIV programme director as to the super-admin; a region-scoped
    user gets 815 B (D §4, D-14).
  - Programme scoping is `[hyp]` missing in the query.
  - During the walk the gateway autoscaled from 2 to 3 pods under 3–4 concurrent sessions.
- **Resolution:** apply the programme scope in `/api/ct/plan`, and paginate or filter by period and hub.
- **Effort:** 1 d.
- **Acceptance:** a programme-scoped user receives only their commodities, and the national payload is under 2 MB per
  request.

### RR-028 Super-admin denied on Column Governance
- **Severity / blocks:** S3 · P.
- **Evidence `[live]`:**
  - `/gw/classification/columns` returns 403 for R-SUPER (super-admin and root), so the page is empty.
  - It returns 200 for R-OPS-ADM and R-STEW.
  - See D-10.
- **Resolution:** grant the classification-read capability to R-SUPER.
- **Effort:** 0.1 d.
- **Acceptance:** the super-admin sees the classification rows.

---

## RR-1xx Missing capabilities

### RR-101 Nothing loads or refreshes data on a schedule; all data is 28 days stale
- **Severity / blocks:** S1 · P. For a demo it is acceptable if disclosed (RR-104).
- **Impact:**
  - No component schedules ingestion or warehouse builds. The last lake write was 2026-09-22 02:01, and the marts
    were built at 09:57.
  - The nightly ML batch writes predictions that never reach the marts (29 newer runs are unused), and decisions made
    after 09-22 never reach `mart_pct_plan_decisions`.
  - A pilot user would see a frozen system.
- **Evidence `[live]`:**
  - `pipeline_refresh` is paused, with 0 runs.
  - There are no CronJobs.
  - Ingestion happens only through the manual `seed-realistic.sh` or `ci-redeploy.sh`.
  - See B-02, C-21, E-04.
- **Resolution:**
  1. Fix RR-020.
  2. Schedule ingest → staging → vault → marts → publish → ML predict → marts refresh as one data-driven chain.
  3. Add a freshness SLA per lane, alerting through RR-103.
- **Dependencies:** RR-020, RR-002 (do not schedule a chain that keeps re-loading duplicates), RR-103.
- **Effort:** 2–4 d.
- **Acceptance:**
  - 7 consecutive nightly runs succeed.
  - The `predict_run_id` in `mart_pct_forecast` is the latest successful batch, less than 24 h old.
  - A stale lane raises an alert.
- **Verify:** DAG history; freshness query.

### RR-102 No backups; restore never tested; no RPO/RTO
- **Severity / blocks:** S2 · P. It is S1 for R.
- **Impact:**
  - Postgres (8.5 GB) holds the vault, the marts and every operational record: decisions, audit, permissions and
    users. It has never been backed up.
  - Keycloak has never been exported.
  - The last object-store copy is from 2026-09-09, on the same OS disk.
  - `backup.sh` defaults to `/mnt`, which is the Azure ephemeral disk.
  - All PVCs are `local-path` with reclaim `Delete` on one node.
  - A disk loss or an accidental reset loses everything, including the pilot's decision history.
- **Evidence:**
  - `[live]` No CronJobs, timers or crontab.
  - `[live]` The `nhdw-backups` bucket is empty.
  - `[live]` `/mnt/DATALOSS_WARNING_README.txt` is present.
  - `[live]` No Postgres, Keycloak or ClickHouse restore evidence exists anywhere. The only restore ever performed was
    the object-store migration on 2026-09-08.
  - See B2 §8, B-10, E-17.
- **Resolution:**
  1. Schedule `pg_dumpall` (or per-DB dumps) plus a Keycloak realm export plus a SeaweedFS bucket mirror to an
     off-VM target (3-2-1), with retention.
  2. Drop non-deployed components from `backup.sh`.
  3. Write RPO/RTO (proposed: RPO 24 h, RTO 8 h for the pilot).
  4. Run and record a full restore drill into a scratch namespace or VM.
  5. Alert when backup age exceeds 26 h.
- **Effort:** 2–4 d. **Uncertainty:** the off-VM target needs an Azure storage decision.
- **Acceptance:**
  - 7 consecutive daily backups exist off-VM.
  - A timed restore drill reproduces the decision count, audit rows and mart row counts within the RTO.
  - The missed-backup alert fires in a test.
- **Verify:** restore-drill log.

### RR-103 Alerts go nowhere; key targets unmonitored
- **Severity / blocks:** S2 · P.
- **Impact:** nothing tells a human that something has failed. Every failure in this register was found by
  inspection, not by an alert.
- **Evidence `[live]`:**
  - Alertmanager's only receiver is `"null"`.
  - There are 3 alert rules: Watchdog, TargetDown and GatewayHighErrorRate. The last can never fire, because it
    queries `http_requests_total` while the gateway exports `nhdw_gateway_requests_total`.
  - The keycloak, clickhouse and mlflow targets have been down since 2026-09-26 (wrong ports or paths).
  - There is no node, kube-state, Postgres or Airflow monitoring.
  - No DAG has a failure callback.
  - See B2 §9, B-08, A R16.
- **Resolution:**
  - A real receiver (an SMTP secret exists).
  - Add node-exporter, kube-state-metrics and postgres-exporter.
  - Rules for disk > 80%, crash-looping pods, DB down, cert expiry, backup age, gateway 5xx rate, freshness breach and
    DAG failure.
  - Fix the 3 targets and the error-rate metric name.
- **Effort:** 1–3 d.
- **Acceptance:** each rule is fired once synthetically and received by a named person; all targets are up.

### RR-104 No as-of date, data-provenance or "synthetic" label on any surface
- **Severity / blocks:** S2 · D.
- **Impact:**
  - All Ethiopian lanes are demo seed dumps that end in 2026-06.
  - The Control Tower is a synthetic Zambian 2017–2018 archive, anchored on August 2018 (plan period September 2018).
  - The lead time of 30 days is an assumption.

  None of this is stated on screen. Only one widget shows a data-through date, and the Control Tower shows only the
  period label. Without labels, an honest demo depends entirely on the presenter's narration.
- **Evidence:**
  - `[static]` `0_external/sources/*/sample-data/SEED-DATA-NOTICE.md`.
  - `[live]` The time anchor is data-based, not wall-clock: `mart_pct_kpi` max month 2018-08; `/api/ct/plan`
    `currentPeriod` 2018-09.
  - See C-21, C-22, E-13.
- **Resolution:**
  - A "Demonstration data" ribbon per surface, and an "as of <max date>" chip per widget (from the mart).
  - Control Tower banner: "Data as of Aug 2018 · plan for Sep 2018 · synthetic eLMIS archive".
  - A short assumptions note (lead time, straight-line distance), inside the existing design.
- **Effort:** 0.5–1 d.
- **Acceptance:** the logged-in walk shows a provenance ribbon and as-of on every page, and the Control Tower states
  its anchor and assumptions.

### RR-105 No rate limiting, request-size limits or public-form abuse controls
- **Severity / blocks:** S2 · P.
- **Evidence:**
  - `[live]` 0 Traefik middlewares.
  - `[static]` No limiter in the gateway.
  - `[static]` The PAT `rate_limit_per_min` is stored but never read.
  - `[static]` `projects.upload_file` reads the whole file into memory.
  - `[static]` `POST /api/public/access-requests` is unauthenticated, with no captcha or limit.
  - See B2 §4, S-13.
- **Resolution:**
  - Traefik `rateLimit` and `buffering.maxRequestBodyBytes` middlewares.
  - Enforce the PAT rate.
  - Cap upload size.
  - A honeypot or captcha plus a per-IP limit on the public form.
- **Effort:** 1–2 d.
- **Acceptance:** requests above the threshold get 429; an upload over N MB gets 413.

### RR-106 Approved plans go nowhere downstream
- **Severity / blocks:** S3 · R (a product-scope decision).
- **Impact:**
  - Approve/reject is recorded and audited, but nothing consumes it: no order, transfer, export, report or eLMIS/QAT
    write-back.
  - `mart_pct_plan_decisions` has no consumer and is frozen by RR-101.
- **Evidence:** `[static]` Grep for consumers finds none; no Superset dataset exists. See E-11.
- **Resolution:**
  - Either define a downstream (approved-orders export or report, or a hand-off to eLMIS/QAT), or state in the UI and
    docs "decision log only".
- **Effort:** 0.5 d (labelling) to 5+ d (integration).
- **Acceptance:** a documented downstream with at least one consumer, or an explicit statement.

### RR-107 Terminology store and commodity MDM empty
- **Severity / blocks:** S3 · P, if MDM or terminology is promised.
- **Evidence:**
  - `[live]` All 6 `nhdw_ref` tables have 0 rows.
  - `[live]` `hub_commodity_conformed` and `lnk_same_as_commodity` have 0 rows.
  - `[live]` `mdm_release` has 0 rows.
  - `[live]` The matcher ran once, 28 days ago.
  - `[live]` Zambia's MDM-mapped share is effectively 0%; PCT uses eLMIS codes and 9 hand-mapped tracers.
  - See B-14, E Q6.
- **Resolution:**
  - Load the vocabulary (`bundle/seeds/ref-vocab/build_vocab.py`).
  - Schedule the matcher.
  - Publish an MDM release.
  - Or remove MDM/terminology from the release scope.
- **Effort:** 2–5 d.
- **Acceptance:** the vocabulary is populated, and at least one MDM release is published and consumed, or the scope
  statement is updated.

### RR-108 No backfill, incremental or schema-change strategy
- **Severity / blocks:** S3 · R.
- **Evidence `[static]`:**
  - The bridge does DROP+CREATE or TRUNCATE every sync.
  - There is no dlt `schema_contract`.
  - No DAG uses `data_interval`.
  - Re-ingest equals a full seed that purges the lake prefixes.
  - Restated records already caused RR-002.
  - See B-17.
- **Resolution:**
  - Schema contracts per lane.
  - An incremental bridge with watermarks.
  - A documented backfill runbook.
  - A reconciliation test (source Σ = mart Σ) per lane that can fail the build.
- **Effort:** 5–10 d.
- **Acceptance:** a restated source batch is loaded without duplicates (test), and a backfill of one month is
  rehearsed.

### RR-109 Ethiopian calendar and timezone handling implicit and approximate
- **Severity / blocks:** S3 · P (for an Ethiopian pilot).
- **Evidence `[static]`:**
  - The profile sets `fiscal_calendar: EFY`, but the UI never uses it.
  - The "fiscal YTD" window starts on Gregorian 1 July (`fetchers.py:100-117`; Hamle 1 is about 8 July).
  - IDSR uses ISO weeks.
  - Dates are parsed in browser-local time.
  - See C-25.
- **Resolution:**
  - A calendar utility for EC display and EFY boundaries.
  - Confirm the epi-week convention with the data owner.
  - Render dates in Africa/Addis_Ababa.
- **Effort:** 1–3 d.
- **Acceptance:** EFY YTD starts at Hamle 1, and dates match across browser timezones.

### RR-110 Country specifics hard-coded in Control Tower code and marts
- **Severity / blocks:** S3 · R (any third country).
- **Evidence `[static]`:**
  - Two hard-coded basemaps and `zm-*` layer ids (`MapView.tsx:25-28,323-381`).
  - The Zambia bounding box in `mart_pct_facility_geo.sql:32-33`.
  - Zambia-specific seeds.
  - Decision-snapshot constants (`ct.py:255-256`).
  - Fixed role list, a 30-day lead time and a Gregorian monthly calendar.
  - See E-14.
- **Resolution:** move the bounding box, basemap, outline, thresholds, lead time and roles into the profile.
- **Effort:** 3–5 d.
- **Acceptance:** a third test profile renders the Control Tower with no code change.

### RR-111 Catalogue, route and API inventories do not reconcile
- **Severity / blocks:** S3 · R.
- **Evidence:**
  - 12 catalogued internal-bi widgets are placed on no page.
  - 13 fetchers have no consumer (including `pub-hero`).
  - The public SPA ignores the catalogue spec.
  - The `pub-articles-list`/`pub-articles` id drift.
  - `pub-zm-*` exist only in the live DB and on the host.
  - `admin/backups` and the `demo/*` pages are empty.
  - `WIDGET_MARTS = {}` despite multi-mart fetchers (`fetchers.py:1462`), so policy attributes and exposures see only
    one mart.
  - See C §1.2, C-23.
- **Resolution:**
  - Prune or place the widgets.
  - Make the public SPA spec-driven.
  - Populate `WIDGET_MARTS` and regenerate exposures.
  - Add a reconciliation script to CI.
- **Effort:** 1–2 d.
- **Acceptance:** the CI reconciliation reports 0 unexplained orphans.

### RR-112 No URL routing in any app
- **Severity / blocks:** S2 · P.
- **Impact:** the public, internal-BI, admin and workshop apps keep the active page in React state, so every page has
  the URL `/`:
  - Refresh returns to the first page.
  - Back leaves the site, or returns to the OAuth callback URL.
  - A bookmarked or shared link cannot point to a page.
  - A logged-out deep link lands on the app root after login.
- **Evidence:**
  - `[live]` D §1, §2, §3, D-06.
  - `[static]` `App.tsx` and `useBiApp.setActive`.
- **Resolution:** hash or path routing synced with history, with the target preserved through the PKCE `state`.
- **Effort:** 2–3 d across 4 apps.
- **Acceptance:** bookmark `…/#/disease` while logged out, log in, and land on Disease; refresh keeps the page;
  back/forward step between pages.

### RR-113 Internal apps unusable at phone width
- **Severity / blocks:** S3 · P (D only if shown on a phone).
- **Evidence `[live]`:**
  - At 390×844, the fixed 250 px sidebar leaves about 140 px of content. Horizontal overflow is 332 px on BI
    Overview, 1,199 px on Disease and 618 px on Admin Topology.
  - At 1440×900, the Disease KPI strip clips its 6th card.
  - The public portal reflows correctly.
  - See D §6, D-12.
- **Resolution:** a collapsible sidebar under 900 px and a wrapping KPI strip.
- **Effort:** 1–2 d.
- **Acceptance:** no horizontal scroll at 390 or 1440 px on any BI or admin page.

---

## RR-2xx Configuration and security posture

### RR-201 Committed demo password is the live password for all 21 seeded users
- **Severity / blocks:** S1 · D (the login page is internet-facing).
- **Impact:**
  - Anyone with repository access, and anyone who has seen the demo, can log in as any seeded user. That includes 3
    super-admins and 2 ops admins, in both staff realms.
  - Keycloak, including the master admin console, is reachable from the internet.
  - The `moh-staff` realm has no brute-force protection in its committed configuration.
- **Evidence:**
  - `[live]` sha256 of the live `SEED_PASSWORD` equals the literal default at
    `7_security/keycloak/scripts/setup-keycloak.py:53`. That literal appears in 39 tracked files, including a doc
    (`docs/production-readiness-assessment.md:286`).
  - `[static]` The users are defined in `bundle/seed-pack/app/security/users.yaml`.
  - Compared by hash only; the value is not reproduced.
  - See B2 S-02.
- **Resolution:**
  1. Generate a random password per deployment (`gen-secrets.sh`) and fail if it is unset.
  2. Remove the literal from code, tests and docs; tests read it from the environment.
  3. Enable brute-force protection on all realms.
  4. Require OTP for privileged roles (RR-205).
  5. Reseed with the live host-base variables and verify the client redirect URIs afterwards. A reseed without them
     rewrites every redirect URI to localhost, a known failure mode.
  6. Decide whether exposure requires rotating everything.
- **Effort:** 1–2 d.
- **Acceptance:**
  - The live hash ≠ any literal in `git grep`.
  - `git grep` finds no password literal.
  - The redirect URIs equal the live host.
  - A privileged login requires OTP.
- **Verify:** hash check; logged-in walk of every SSO tool.

### RR-202 Cluster-admin kubeconfig world-readable on a shared host
- **Severity / blocks:** S2 · P.
- **Evidence `[live]`:**
  - `/etc/rancher/k3s/k3s.yaml` is `-rw-r--r--`, regenerated that way by `--write-kubeconfig-mode=644` in the k3s
    service file.
  - 5 local accounts each get `can-i '*' '*' -A = yes`, which includes reading every Secret.
  - Operator accounts are also in the `docker` group, which is root-equivalent.
  - See B2 S-03.
- **Resolution:**
  - Mode 600 (restart k3s in a window).
  - Per-user kubeconfigs bound to namespaced RBAC.
  - Review docker and sudo group membership.
  - Consider rotating the admin client certificate.
- **Effort:** 0.5–1 d.
- **Acceptance:** the file is mode 600 after a restart, and a non-admin user's `can-i get secrets -n nhdw` = no.

### RR-203 Direct data paths bypass gateway policy
- **Severity / blocks:** S2 · P. It is S1 for R if real person-level data ever lands.
- **Impact:** OPA row scoping, masking and audit apply only through the gateway. Other paths skip them:
  - Trino has no authentication and no access control.
  - Superset and JupyterHub query Trino directly.
  - The `bi_reader` account can read the person-level (synthetic) view `bi_staging.bi_demo_patient_observations`
    (220,795 rows) and `nhdw_landing.demo_patient_phi`.
  - The `ops` catalog exposes audit, permission and user tables.
  - There are 0 NetworkPolicies.
  - The `fhir_writer` DB login uses the committed placeholder password.
- **Evidence:**
  - `[live]` Grants; the Trino config; the NetworkPolicy count.
  - `[live]` A SCRAM verifier check on `fhir_writer`.
  - `[hyp]` That a notebook user can actually query restricted marts and `ops.*`; not exercised.
  - See B-11, B2 S-07.
- **Resolution:**
  - Default-deny NetworkPolicies.
  - Trino authentication and file-based access control per principal, or route notebooks through the gateway SQL API.
  - Revoke the `bi_staging` and landing grants from `bi_reader`.
  - Remove the `ops` catalog from notebook reach.
  - Rotate `fhir_writer` or make it NOLOGIN.
- **Effort:** 2–5 d.
- **Acceptance:** from a notebook pod, queries to `ops.*` and to a restricted mart are denied or masked, and `psql` to
  Postgres times out.
- **Verify:** a controlled test with a throw-away notebook user.

### RR-204 Self-signed TLS, no HSTS/CSP/frame protection, no HTTP→HTTPS redirect
- **Severity / blocks:** S2 · P. Accepted for the demo if the audience is told to expect a certificate warning, or the
  browsers are pre-configured.
- **Evidence `[live]`:**
  - The issuer is "NHDW Local Dev CA".
  - TLS 1.0 and 1.1 are refused (good).
  - Only Keycloak sends HSTS.
  - No app sends CSP, X-Frame-Options or nosniff.
  - The Traefik `web` entrypoint has no redirect, and the apps serve plain HTTP (D-17).
  - See B2 §3, S-08.
- **Resolution:**
  - A real DNS name with Let's Encrypt (cert-manager) or a ministry CA.
  - A Traefik redirect.
  - A headers middleware on all ingresses.
- **Effort:** 1–2 d (plus DNS).
- **Acceptance:** an SSL Labs-style check scores A, and the headers are present on every host.

### RR-205 Identity hardening absent
- **Severity / blocks:** S2 · P.
- **Evidence:**
  - `[live]` 0 OTP credentials across all realms.
  - `[live]` `sslRequired` NONE on three realms.
  - `[live]` Keycloak runs `start-dev` with `KC_HTTP_ENABLED=true` and `KC_HOSTNAME_STRICT=false`.
  - `[live]` The master admin console returns 200 from the internet.
  - `[live]` The `moh-staff` realm advertises implicit and password grants at realm level.
  - `[static]` 10 literal client secrets in realm JSON, imported at boot until a reseed.
  - See A R12, B2 §1.1, S-14.
- **Resolution:**
  - Production-mode Keycloak.
  - `sslRequired: external`.
  - OTP for privileged-ops and admin roles.
  - Brute-force protection on all realms.
  - Restrict `/admin` at Traefik to an admin IP range.
  - Placeholder client secrets in JSON.
  - Remove the SAML mock realm from the production profile.
- **Effort:** 1–2 d.
- **Acceptance:** a realm export shows these settings; `/admin` is unreachable from the internet; a privileged login
  prompts for OTP.

### RR-206 Delivery pipeline idle since 2026-09-21; deploy not gated by tests; no rollback
- **Severity / blocks:** S2 · P.
- **Impact:** there is no reliable, repeatable way to put a reviewed commit into production, or to go back.
- **Evidence `[live]`:**
  - The last runner jobs were Failed, Failed and Canceled on 2026-09-21, with no job since. The 2026-09-22 commits
    reached the cluster by manual rebootstrap.
  - The runner checkout is at `77136f2e`, 13 commits behind `develop`, with 18 modified files (+395/−51) and untracked
    scripts. A live profile-swap worker runs from that checkout.
  - `deploy.yml` has no `needs:` on tests.
  - Only 1 of 4 UIs is type-checked in CI. There is no `dbt parse`/`build` and no image scan.
  - The verify step is non-fatal.
  - The `1.0.0` tag is overwritten, so there is no previous image to roll back to.
  - Branch protection could not be verified.
  - See B2 S-06, S-19, B-16, A R17.
- **Resolution:**
  1. The owner commits or discards the runner-checkout changes. **Do this before any CI run, because a CI run destroys
     them.**
  2. Use a clean `actions/checkout` on the runner.
  3. Make deploy depend on tests and fail on verify.
  4. Add tsc for all UIs and `dbt parse` for the three projects.
  5. Tag by SHA (RR-004).
  6. Keep the previous image and write a rollback runbook.
  7. Export the branch-protection rules.
- **Effort:** 2–4 d.
- **Acceptance:**
  - A push to `develop` produces a green deploy.
  - A failing test blocks the deploy.
  - The runner checkout is clean.
  - A rollback is rehearsed.

### RR-207 Other internal endpoints and API docs reachable anonymously
- **Severity / blocks:** S2 · P.
- **Evidence `[live]`:**
  - Anonymous 200 on `/metrics`, `/docs` and `/openapi.json` (176 paths), `/api/marts` (45 mart names), `/api/ml`,
    `/api/groups` (with member counts), `/api/artifacts` (with owner usernames) and `/api/demo/health`. The last
    returns raw Trino error text.
  - The code comment claiming the ingress does not route `/metrics` publicly is false.
  - A sweep of all 112 GET paths in `openapi.json` without a token: **36 return 200** (D §4). They include
    `/api/marts/bi_facility/mart_facility_capacity` (500 facility rows with coordinates) and `/api/workspace/profiles`.
  - Anonymous `GET https://s3…/` lists bucket `nhdw-static` (ListAllMyBuckets).
  - `public…/api/access-points` lists 14 internal services, including decommissioned ones (MinIO, Grafana, CloudBeaver).
  - See B2 §1.2, S-09, D-01, D-17.
- **Resolution:**
  - The same ingress allow-list as RR-001.
  - `docs_url=None, openapi_url=None` in production.
  - Require a login for catalogue listings.
  - Deny anonymous ListBuckets on the S3 endpoint.
  - Prune the access-points list.
- **Effort:** 0.5 d (with RR-001).
- **Acceptance:** a re-run of the anonymous sweep returns 401/403 for every path except `/api/public/*`,
  `/api/profile*` and `/health`, and anonymous ListBuckets returns 403.

### RR-208 JWT algorithm taken from the token; vulnerable JWT library; demo impersonation on
- **Severity / blocks:** S3 · R.
- **Evidence:**
  - `[static]` `auth.py:219-221` `algorithms=[unverified_header["alg"]]`.
  - `[static]` python-jose 3.3.0 (CVE-2024-33663/33664, fixed in 3.4.0).
  - `[static]` An unknown `kid` forces a JWKS refetch per request.
  - `[live]` `GATEWAY_DEMO_IMPERSONATION=true`, secret-gated and server-side only.
  - Exploitability is judged low `[hyp]`.
  - See B2 S-12, B-13.
- **Resolution:**
  - `algorithms=["RS256"]`.
  - Upgrade the library or move to PyJWT.
  - Rate-limit JWKS refetches.
  - Turn impersonation off per environment.
- **Effort:** 0.5 d.
- **Acceptance:** unit tests reject HS256 and `none` tokens; impersonation is off in pilot and production values.

### RR-209 Init SQL applied by CI contains `DROP … CASCADE` / `TRUNCATE`
- **Severity / blocks:** S3 · R.
- **Evidence `[static]`:**
  - CI pipes changed `3_storage/postgres/init/*.sql` into the live DB.
  - `10_mfr_landing.sql` has `DROP TABLE … CASCADE` ×3.
  - `30_demo_patient_phi.sql` does TRUNCATE+INSERT.
  - `01`, `03` and `25` contain DROP/TRUNCATE.
  - `05_ops_schemas.sql` lacks `\connect`, which left stray `ops_*` schemas.
  - See B2 S-16.
- **Resolution:**
  - Separate boot-only seed files from forward-only migrations.
  - Forbid destructive statements outside an explicit migration.
  - CI replays each changed file twice on a scratch DB.
- **Effort:** 1–2 d.
- **Acceptance:** CI refuses a destructive statement outside a migration.

### RR-210 Workload hygiene
- **Severity / blocks:** S3 · P.
- **Evidence `[live]`:**
  - 20 containers have no requests or limits, including Postgres, Keycloak, OPA, SeaweedFS, all dashboards, MLflow
    and Airflow.
  - The OM liveness timeout is 1 s.
  - 112 failed pods.
  - 134 ReplicaSets.
  - The Postgres data volume holds 8.5 GB against a nominal 10 Gi, and sizes are not enforced by `local-path`.
  - Disk is 65% used, with about 70 GB of reclaimable Docker images.
  - See B2 §7, S-11.
- **Resolution:**
  - Set requests and limits on stateful pods.
  - Probe timeouts and startup probes.
  - Pod TTLs.
  - Postgres volume headroom.
  - Image pruning.
- **Effort:** 1–2 d.
- **Acceptance:** a missing-requests/limits/probes scan is empty or has justified exceptions, and there are 0 restarts
  in 7 days.

### RR-211 End-of-life components and no vulnerability scanning
- **Severity / blocks:** S3 · R.
- **Evidence:**
  - `[live]` Images likely past vendor support: ClickHouse 24.3, Prometheus 2.53, Loki/Promtail 2.9, Alertmanager
    0.27, Superset 4.0, the old Jupyter stack. Verify each against the vendor pages.
  - `[live]` No scanner is installed or in CI.
  - `[static]` Base images are pinned by tag, not digest.
  - See B2 §5, S-15.
- **Resolution:**
  - Add a Trivy/Grype image scan and pip-audit/npm audit to CI.
  - An upgrade plan with dates.
- **Effort:** 1 d (scanners) plus 1–3 weeks (upgrades).
- **Acceptance:** the CI scan has no unaccepted critical CVE.

### RR-212 Out-of-git live configuration: unmanaged console, ingresses, host ports
- **Severity / blocks:** S3 · P.
- **Evidence `[live]`:**
  - 6 ingresses and 2 services have no `managed-by` label. Among them, `console.…` points to a host Docker app
    outside this repository with its own login and no SSO.
  - The `seaweedfs-gate` image comes from a registry that does not exist (it works only from the local cache).
  - The source replicas publish database ports on `0.0.0.0` (5433/5434, 1433, 33306, 8080, 11434 …). From inside the
    VM only 22 and 443 answer on the public IP, so the Azure NSG appears to be the only barrier. Confirm this from
    outside.
  - See B-12, B2 S-18, A R20.
- **Resolution:**
  - Bring the console under the chart with SSO, or remove its ingress.
  - Bind replicas to 127.0.0.1 or the cluster bridge.
  - Document the NSG rules as a control.
  - Fix the gate image reference.
- **Effort:** 1–2 d.
- **Acceptance:** `ss -ltn` shows no `0.0.0.0` DB ports; an external scan shows only 22/443, with 22 restricted; every
  ingress is chart-managed or documented.

### RR-213 Audit client IP spoofable; no audit retention
- **Severity / blocks:** S4 · R.
- **Evidence `[static]`:**
  - uvicorn runs with `--forwarded-allow-ips=*` (gateway `Dockerfile:23`).
  - There is no retention or partitioning job on `gateway_log`.
  - See B2 S-17.
- **Resolution:** trust only the ingress CIDR; add a retention job.
- **Effort:** 0.5 d.
- **Acceptance:** a spoofed `X-Forwarded-For` is not recorded, and a retention policy exists.

### RR-214 Any staff user gets full MLflow and Superset SQL Lab
- **Severity / blocks:** S2 · P.
- **Impact:**
  - An external-researcher account (R-CONS-RES) passes silent SSO into MLflow, where it gets the full UI with create,
    rename and delete on 12 experiments.
  - The same account gets Superset with SQL Lab and chart/dashboard creation.
  - The admin console says these tools are for R-OPS-ADM and R-SUPER only.
  - With RR-203, this is also a path around gateway policy.
- **Evidence:**
  - `[live]` Walk as `genet.e` (D §2.5, D-11).
  - `[static]` The oauth2 gate accepts any moh-staff session (no group or role check).
- **Resolution:**
  - `allowed_groups`/role checks on the MLflow gate.
  - Map Superset roles from Keycloak (no SQL Lab for consumer roles).
- **Effort:** 1 d.
- **Acceptance:** the researcher gets 403 on MLflow and no SQL Lab in Superset; the ops admin still gets access.

### RR-215 Access tokens stay valid after logout
- **Severity / blocks:** S3 · R.
- **Evidence `[live]`:**
  - After Keycloak logout, the old bearer still gets 200 on `/gw/me` and `/auth/me` until expiry (access-token
    lifetime 1,800 s).
  - The SPAs keep only the access token, in sessionStorage, with no refresh logic.
  - See D §3, D-13.
- **Resolution:** a 5-minute access TTL with silent refresh, or a `sid` check / back-channel logout.
- **Effort:** 1–2 d.
- **Acceptance:** after logout, the old token returns 401 within 60 s.

---

## RR-3xx External data dependencies

### RR-301 Four Ethiopian lanes never landed
- **Severity / blocks:** S2 · D, if the Resource or supply pages are shown.
- **Impact:**
  - HCMIS, mBrana, Climate and MFR facilities are zero at every hop.
  - 9 of 11 Resource-page widgets are empty or zero.
  - Climate columns are 100% NULL.
  - The public readiness strip is hidden.
- **Evidence:**
  - `[live]` No lake prefixes for these lanes.
  - `[live]` ClickHouse `raw_*` = 0 and landing = 0.
  - `[live]` No climate container.
  - `[live]` The MFR FHIR replica is unhealthy.
  - `[live]` The HCMIS SQL Server is healthy, yet nothing landed.
  - See B-04, C-11.
- **Cause:** `[hyp]` the ingestors failed or were skipped during the 2026-09-22 seed; the Job logs are gone.
- **Resolution:**
  - Decide per lane whether it is in the release scope.
  - For in-scope lanes, run each ingestor under observation and capture the logs.
  - For out-of-scope lanes, hide the widgets or label them "Source not connected" (with RR-010).
- **Effort:** 2–5 d per lane, plus partner time for real feeds.
- **Acceptance:** each in-scope lane reconciles source → mart; each out-of-scope widget shows "Source not connected".

### RR-302 All data is synthetic or demo seed; a pilot needs real, owner-approved data
- **Severity / blocks:** S1 · P.
- **Impact:**
  - Every source is a synthetic replica or a demo dump. The eLMIS history was produced by a synthesizer that exists
    only as uncommitted code in the CI runner checkout, and it was seeded non-deterministically.
  - There is no Zambia master facility list to cross-check the 2,807 eLMIS facilities against.
  - A pilot on synthetic data cannot validate a decision-support product.
- **Evidence:**
  - `[static]` `SEED-DATA-NOTICE.md` files.
  - `[live]` Source containers.
  - See E-16, C-22, B1 §1.
- **Resolution:**
  - Agree the pilot dataset with the data owner (real eLMIS or OpenLMIS extract, MFL, DHIS2 instance), its provenance
    and a refresh path.
  - Commit the synthesizer (or retire it) so the demo dataset is reproducible.
- **Effort:** external; at least 5 d of integration once access is granted.
- **Acceptance:** the pilot dataset provenance is documented; an MFL cross-check percentage is reported; the demo
  dataset rebuilds deterministically.

### RR-303 Data-protection applicability and small-cell threshold not established
- **Severity / blocks:** S2 · P.
- **Impact:**
  - The platform holds Zambian data and is designed for Ethiopian health data, on an Azure VM.
  - The Zambia Data Protection Act 2021 and Ethiopia's Proclamation 1321/2024 may apply. Their applicability, the
    controller and processor roles, and data residency have not been assessed.
  - The public marts enforce k ≥ 5 on facility counts, by SQL plus one dbt test only. The threshold has not been
    agreed with a data owner, and event-count suppression is untested.
- **Evidence:**
  - `[static]` `2_pipelines/marts/tests/k_anonymity_public_marts.sql`.
  - See the [standards framework](06-standards-and-acceptance-criteria.md) S25–S29 and B2 §1.1.
- **Resolution:**
  - An applicability memo with counsel.
  - A data-owner sign-off on the threshold, plus secondary suppression.
  - A DPIA if person-level data is in scope.
- **Effort:** external.
- **Acceptance:** a signed memo and a threshold decision; the public marts are tested against that threshold.

---

## RR-4xx Documentation drift and misleading claims

### RR-401 No forecast accuracy figure in the repository can be cited; three conflicting stories
- **Severity / blocks:** S1 · D.
- **Evidence:**

  | Where | Claim |
  |---|---|
  | `final-pct-build-handoff.md:38` | "MASE 0.977" (never logged) |
  | `bundle/seed-pack/app/ml/elmis_consumption_forecast/model_card.md:26-28` and `docs/decisions/2026-09-21-pct-product-phase.md` #20/#24/#27/#28 | "WAPE 0.598, v4 champion" (that run no longer exists) |
  | `docs/pct-forecast-contract.md` §8 | "2.78M → 7.07M units" (measured on pre-rebuild data) |
  | MLflow, live | v1 champion, MASE 0.887 / WAPE 0.253, trained on double-loaded data |

  See A-01.
- **Resolution:**
  - Flag every figure "not citable until retrained on de-duplicated data".
  - After RR-002 and RR-003, regenerate the model card from the MLflow run, with run id and date (script, not by hand).
- **Effort:** 0.5 d now, 0.5 d after the retrain.
- **Acceptance:** `git grep` for MASE/WAPE figures returns only the generated model card, whose run id equals the
  champion's.

### RR-402 Front-door docs describe a different system
- **Severity / blocks:** S2 · P (handover).
- **Evidence:** `README.md`, `docs/architecture.md` and `docs/deployment.md` say:
  - k3d and `*.127.0.0.1.nip.io`;
  - "only sources seeded" (false: a 220,836-row demo PHI fixture is seeded);
  - "a bridge moves them into ClickHouse" (the bridge actually goes ClickHouse → Postgres);
  - "the gateway is the only door" (Superset and notebooks bypass it).

  They omit eLMIS, PCT, country profiles, OpenMetadata, Helm/Ansible and the live host. See A-06, B-15.
- **Resolution:** rewrite them to the as-built topology in the [coverage map](02-coverage-map.md), and move k3d to a
  "local development" section.
- **Effort:** 1–2 d.
- **Acceptance:** a new engineer brings up and describes the system from the docs alone (handover exercise).

### RR-403 `security.md` overstates identity hardening
- **Severity / blocks:** S2 · P.
- **Evidence:**
  - It claims "for sensitive roles, a second factor"; there are 0 OTP credentials.
  - It says Fayda is a Keycloak IdP; the only IdP is the `ehia-saml` SAML mock.
  - It omits start-dev, `sslRequired NONE`, the self-signed CA, impersonation on, the audit route (RR-001) and the
    shared demo password.
  - It contains hand-off wording (L81).
  - See A-04.
- **Resolution:** a "Current posture (demo-grade)" section plus a hardening checklist linked to RR-201 to RR-208.
- **Effort:** 0.5 d.
- **Acceptance:** every control claimed in the doc is verified by a test or an evidence link.

### RR-404 Only readiness verdict is a stale July snapshot that contains a credential
- **Severity / blocks:** S2 · P.
- **Evidence:** `docs/production-readiness-assessment.md`:
  - is dated 2026-07-14;
  - says MinIO, k3d and "no CI";
  - says "ML Met: drift + retrain";
  - contains the demo seed password in plain text at L286;
  - references an assistant-generated artifact (L7).

  See A-05.
- **Resolution:**
  - Banner it "historical, superseded by `docs/release-readiness/`".
  - Redact L286 (and rotate per RR-201).
  - Remove the artifact reference.
- **Effort:** 0.25 d.
- **Acceptance:** `git grep` finds no password literal in `docs/`.

### RR-405 Agent prompts, AI traces and private paths committed to the shared repo
- **Severity / blocks:** S2 · P (handover quality, and the team's own rule).
- **Evidence `[static]`:**
  - These root files are agent prompts or first-person agent writing, not product documentation:
    `data-layer-handoff-track-B.md` (including commit-trace rules naming the assistant vendor, L91),
    `final-pct-build-handoff.md`, `pct-demo-execution-plan.md` and `docs/decisions/2026-09-21-overnight-judgment-calls.md`.
  - `security.md:81` contains "handoff".
  - `IMPROVEMENTS.md:68` cites a scratch-pad path.
  - Home-directory paths appear in 10+ tracked files, including the SeaweedFS README/LEDGER, the OpenLMIS README and
    `deploy.yml`.
  - The repository is private (an anonymous API request returns 404), so this is a handover risk, not a public leak.
  - See A-10.
- **Resolution:**
  - Move the hand-off and plan prompts out of the tree; the house rule is archive, never delete.
  - Scrub the traces and paths.
  - Add a CI grep guard.
- **Effort:** 0.5–1 d.
- **Acceptance:** the CI guard is green, and no home-directory path appears in tracked files.

### RR-406 eLMIS volumes in docs and lineage claims are false
- **Severity / blocks:** S2 · D (if the docs are shared with the customer).
- **Evidence:**
  - Four documents quote 7,543,506 lines / 73,926 requisitions "reconciled end to end"; the source now has 2,607,247
    / 163,453.
  - `docs/metadata-plane.md` and decision records #7/#9/#17 claim source → widget lineage, which is false (RR-019).
  - `data-layer-enhancement-plan.md` claims "nhdw_ref LIVE 163 concepts" (now 0).
  - See A-02, A-03, A §2.
- **Resolution:**
  - Re-measure after RR-002 and update with dated figures.
  - Mark lineage "currently broken" until RR-019 is fixed.
- **Effort:** 0.5 d.
- **Acceptance:** every volume figure in `docs/` carries a date and matches a re-run query.

### RR-407 Presentation guide has no PCT page and describes empty widgets
- **Severity / blocks:** S3 · D.
- **Evidence:**
  - `docs/dashboard-presentation-guide/*` has no Control Tower page.
  - 17 MinIO references.
  - Its widgets are backed by absent or empty marts.
  - See A-15.
- **Resolution:**
  - Replace it, for demo purposes, with the [demo script](05-demo-and-operations-handover.md).
  - Update the guide after WP-1.
- **Effort:** 1 d.

### RR-408 CI/CD doc contradicts the workflows
- **Severity / blocks:** S3 · P.
- **Evidence:**
  - `test.yml` is undocumented.
  - It says "push-to-main" (deploys actually run from `develop`).
  - It says the runner is "not installed" (it is).
  - It says rclone; the workflow uses `hydrate-data.sh`.
  - The `deploy.yml:24` comment contradicts it ("overlay is applied" vs "detected").
  - It tells readers that a PAT and an app password were once exposed, with no rotation evidence.
  - See A-07.
- **Resolution:** update it with RR-206; get the owner to confirm rotation.
- **Effort:** 0.5 d.

### RR-409 Dictionaries, changelog, decision records, deployment plan and profile doc drift
- **Severity / blocks:** S3 · P.
- **Evidence:**
  - The data dictionaries document 40/52 sections against 80 live relations, with no columns and 3 ghost relations.
  - The changelog stops on 2026-09-21.
  - Decision records were reversed silently.
  - `production-deployment-plan.md` progress is stale (Helm live; ArgoCD manifest only).
  - `profile-swappability.md` is stale.
  - See A-13, A-14, A-16 to A-18.
- **Resolution:**
  - Generate the dictionaries from the live schema plus dbt yml.
  - Append dated "post-rebuild" addenda.
  - Update the plan and the profile doc.
  - Add a complete `docs/` index and release notes per tag.
- **Effort:** 2–3 d.

### RR-410 Broken repo-path references in 7 READMEs
- **Severity / blocks:** S4 · R.
- **Evidence:** links to `docs/observability-integration.md`, `docs/user-roles.md`, `3_storage/minio/README.md` and
  others that do not exist. See A-21.
- **Resolution:** fix or archive them; add a link check to CI.
- **Effort:** 0.25 d.

---

## RR-5xx Optional improvements

### RR-501 Accessibility gaps against WCAG 2.2 AA
- **Severity / blocks:** S3 · P (as a recommendation; no contractual accessibility obligation has been verified).
- **Evidence `[live]`:** axe-core 4.10.2 (WCAG 2.0/2.1/2.2 A+AA) on 28 page states. Every page failed.
  - 8 rules, 694 nodes.
  - 4 critical rules on 33 nodes: unlabelled sort `<select>`, icon-only pagination buttons, an unlabelled input in
    the public access form, and `aria-required-children`.
  - Colour contrast fails on 26/28 pages (536 nodes).
  - Target size (2.2) fails on 12 pages.
  - Charts render to canvas with no table alternative, and region axes use codes rather than names.
  - See D §5 and the [coverage map §8](02-coverage-map.md#8-accessibility-and-responsive-rendering).
- **Resolution:**
  - Fix the serious and critical violations on the demo path first.
  - Then do a manual keyboard pass of approve/reject and the filters.
- **Effort:** 3–5 d (token-level contrast fix plus labels; chart alternatives extra).
- **Acceptance:** 0 serious or critical axe findings on the demo pages; the keyboard walk passes.

### RR-502 No internationalisation
- **Severity / blocks:** S3 · R (for Ethiopian users).
- **Evidence:** `[static]` No i18n library in any SPA `package.json` (A §3).
- **Resolution:** extract strings and add Amharic, if the customer requires it.
- **Effort:** 5–10 d.

---

## Verification gaps (checks that could not be run)

| Gap | Why | How to close |
|---|---|---|
| Live approve/reject/revert round-trip | It would write to the live decision log (2 rows by design) | Approve one write with a test user holding R-DEC, or run on a scratch copy (WP-1 acceptance) |
| Authenticated `/api/ct/plan` payload vs mart | The read-only rules allowed no token use outside the browser walk | Covered partly by the logged-in walk; full payload diff in WP-1 |
| OPA row filters and masking per persona | The authenticated API replays ran unscoped | Persona matrix test (WP-3) |
| Notebook → Trino bypass (RR-203) | It needs a throw-away notebook user | Controlled test (WP-3) |
| Live Keycloak token lifetimes and brute-force settings | Needs a realm-admin read | The realm owner runs a read-only `kcadm.sh get realms/<r>` |
| CI run history and branch protection | `gh` not installed; repo private | The owner runs `gh run list` and `gh api …/branches/{develop,main}/protection` |
| External port exposure | Only the VM-internal (hairpin) view was available | `nmap` from an outside host, or an NSG export |
| Image CVEs | No scanner installed | Trivy in CI (RR-211) |
| Clean-environment reproducibility (cold boot) | Never reset a shared environment; no isolated VM was available | A throw-away VM rehearsal (WP-4); the last recorded from-bare boot was 2026-09-21 |
| Performance under representative load | No load tool run against a shared environment | k6 against a scratch copy (WP-4) |
| Causes of RR-012, RR-301 | 2026-09-22 Job logs garbage-collected | Re-run under observation (WP-1/WP-2) |
| Post-fix eLMIS figures | From the 2026-09-29 scratch rebuild, not re-run | Re-run in WP-1 |
