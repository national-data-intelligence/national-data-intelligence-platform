# E. Demo and operational handover

Part of the [release-readiness pack](README.md). This is the script and runbook for a **credible, repeatable customer
demonstration** once the demo-gate work packages (WP-0 to WP-3 in the [execution plan](04-execution-plan.md)) are done.
It also says plainly what may and may not be shown **before** they are done.

> **Status on 2026-10-21: the platform is not demo-ready.**
> - The Control Tower is unreachable under the live profile (RR-005).
> - Every PCT volume is about 4× too high (RR-002).
> - The public open-data page shows fabricated datasets (RR-007).
> - The gateway access log is publicly readable (RR-001).
>
> Do not demonstrate against the live host until the [preflight](#3-preflight-checklist) passes. If a demo cannot be
> moved, use [§7 Fallback](#7-fallback-if-the-preflight-fails) only.

## 1. What the demo shows, and what it must not claim

**The story, in one sentence.** One governed pipeline takes source-system data through a lake and a data vault into
policy-enforced dashboards. On top of it, a supply-chain Control Tower turns consumption history into an explained
replenishment plan that a human approves or rejects, with every decision recorded.

| May say | Must not say |
|---|---|
| "The data is a synthetic Zambian eLMIS archive (Mar 2017 – Aug 2018); the plan is for September 2018." | Anything implying live or current national data. |
| "Ethiopian dashboards run on demonstration seed data that ends June 2026." | That any figure is an official statistic. |
| "The plan sizes orders with a min–max policy on average monthly consumption (AMC); a statistical forecast is used only when it beats the baselines, and today it does not." | Any forecast accuracy figure (MASE, WAPE, coverage). None is citable until the model is retrained on corrected data (RR-401). |
| "Routes are a sweep ordering on straight-line distance, compared with one round trip per facility." | "Optimised routes", "AI optimisation", cost or vehicle savings. |
| "Approvals are recorded with who, when and a frozen snapshot of the reasoning." | That approvals create orders or feed eLMIS. They are a decision log only (RR-106). |
| "Access is governed by role and geography; a regional user sees only their region." | That the platform is production-ready, has MFA, or is backed up (RR-102, RR-205). |
| "Coverage" for HMIS figures, until WP-8 | — the metric is a reporting rate (RR-009). Say "reporting rate". |

## 2. Prerequisites and roles

| Item | Requirement |
|---|---|
| Build | One tagged commit. Every running custom image is labelled with its SHA, and `/health` shows it (WP-1 step 6). |
| Profile | The demo profile decided in D1, with the Control Tower visible to the demo roles and the "archive replay" banner shown (RR-005, RR-104). |
| Data | Marts rebuilt with the eLMIS fix; planning basis per decision D4 (AMC expected); `mart_data_quality` built (RR-012). |
| Credentials | Fresh per-deployment password from the secret store (WP-0). **Never type a password that appears in the repository.** |
| Browser | Desktop, 1440 px or wider (the internal apps are not responsive, RR-113). If the certificate is still self-signed (RR-204), trust the dev CA on the demo machine beforehand. |
| Fallback | Recorded video and screenshots of the full script (§7). |

**Personas.** All users are seeded by `bundle/seed-pack/app/security/users.yaml` (or the Zambian file if D1 chooses
`zm-v1`).

| Persona | Realm / role | Used for |
|---|---|---|
| Anonymous | — | Public portal |
| National analyst | moh-staff / R-CONS-ANA | Overview, Disease, Service |
| Regional health bureau user | moh-staff / R-RHB-<region> | Scope demonstration |
| National decision-maker | moh-staff / R-DEC | Control Tower approve/reject |
| External researcher | moh-staff / R-CONS-RES | Denial demonstration (after RR-214) |
| Ops administrator | privileged-ops / R-OPS-ADM | Admin console, health, lineage |

## 3. Preflight checklist

Run all of these on the day, and again 30 minutes before. They are read-only. Each line must pass; record the output.

| # | Check | Command / action | Pass when |
|---|---|---|---|
| P1 | Pods healthy | `kubectl -n nhdw get pods --field-selector=status.phase!=Running,status.phase!=Succeeded` | No Failed or CrashLoop pods (RR-022 fixed) |
| P2 | Disk | `df -h /` | < 80% used |
| P3 | Running build = tag | `curl -s https://gateway.<host>/health` | Reported SHA = the release tag |
| P4 | Audit log closed | `curl -sk -o /dev/null -w '%{http_code}' https://gateway.<host>/api/audit/events` | `401` or `403` |
| P5 | No placeholders | `curl -sk https://public.<host>/api/proxy/profile/copy/public \| grep -c '{'` | `0` |
| P6 | eLMIS reconciles | SQL: `SUM(quantity_dispensed)` on `bi_supply.mart_elmis_hist_facility_product_month` vs the landing table | Equal |
| P7 | Planning basis | SQL: `planning_basis, count(*)` on `bi_supply.mart_pct_position` | Matches decision D4 (100% AMC-based if the rule fails) |
| P8 | DQ mart present | SQL: `to_regclass('bi_quality.mart_data_quality')` | Not null |
| P9 | SSO round-trip | Headless login script as each persona: BI, admin, OpenMetadata, MLflow, dbt-docs | All land on their home page; no redirect to `127.0.0.1`/`localhost` |
| P10 | Control Tower visible | Log in as the decision-maker | "Supply Control Tower" is in the navigation, and the banner shows "Data as of Aug 2018 · plan for Sep 2018" |
| P11 | Region filter populated | Log in as the analyst | The Region chip lists every region (RR-025) |
| P12 | Demo values unchanged | Re-run the 5 KPI queries in §5 | Identical to the values recorded at rehearsal |

## 4. Script (about 25 minutes)

| Beat | Time | Persona | Action | Expect to see | Talking point |
|---|---|---|---|---|---|
| 1 | 0–3 | Anonymous | Open the public portal home | KPI tiles each showing region count, facility count and data month; provenance ribbon | "Public statistics come from the same governed pipeline, with small cells suppressed." |
| 2 | 3–5 | Anonymous | Scroll to coverage by region and the trend | Real regions only (no "all 14" unless 14 are present) | "Where the data is thin, the page says so instead of filling the gap." |
| 3 | 5–9 | National analyst | Log in → Overview → Disease | Brief, benchmarks, outbreak signal chart, region map shaded | "Observed cases against the model's expected band; the alarm is a model signal, shown as a band, not a certainty." |
| 4 | 9–11 | Regional user | Log in → Overview | Region locked; only that region's numbers; tampering with the filter is refused | "Policy is enforced at the gateway, not in the browser." |
| 5 | 11–20 | Decision-maker | Supply Control Tower | Banner with the anchor dates; KPI cards; map; dispatch | "History → stock position → what each facility needs → a plan, with each line's reasoning." |
| 6 | 13–16 | Decision-maker | Open one movement | The 5-step "why" walk; demand basis = AMC; straight-line distance | "Every number is explainable. The forecast is not used because it did not beat the baselines; that rule is enforced." |
| 7 | 16–19 | Decision-maker | Approve one line, then revert it | Badge changes; reload keeps it; revert restores "Planned" | "Who, when and a frozen snapshot are recorded and audited." (This writes 2 rows; use the demo environment only, per D9.) |
| 8 | 20–23 | Ops administrator | Admin → Health & topology → Quality & lineage | Live topology; DQ results; lineage source → widget in OpenMetadata | "Operators see health, quality incidents and where every number comes from." |
| 9 | 23–25 | — | Close with the limitations sheet (§6) | — | State what is synthetic, what is next (the pilot data, WP-9). |

Skip the Resource page and the Service cascades unless WP-2 has labelled them "source not connected" and the
customer asks (decision D2).

## 5. Expected data and outcomes

Record the actual values at the rehearsal (WP-3) and paste them here. The preflight check P12 compares against them.

| KPI | Source query | Value **today, before the fixes** (do **not** present) | Value after WP-1/WP-2 (record at rehearsal) |
|---|---|---|---|
| Control Tower units to ship (Sep 2018) | `SUM(units)` on `bi_supply.mart_ct_movements` for the current period | 11,081,832 (inflated) | ≈2.78M expected on AMC basis (scratch-rebuild estimate, re-measure) |
| Facilities in plan / at risk | `mart_ct_movements` distinct `to_node` / at-risk | 2,806 / 2,749 | record |
| On-shelf availability, Aug 2018 | `mart_pct_kpi` pooled `osa_s8` | 99.7% (inflated denominators) | record |
| eLMIS Σ dispensed | `mart_elmis_hist_facility_product_month` | 1,570,993,435 | must equal source: 394,083,470 |
| Public Penta3, latest month | `bi_public.mart_public_indicator_kpis` | 96.9% from 5 regions | record, with its region count |

## 6. Known limitations to state

- All data is synthetic or demonstration seed (RR-302). The Zambian PCT archive ends August 2018, and the Ethiopian
  data ends June 2026.
- Nothing refreshes on a schedule yet (RR-101). Numbers do not change between demos.
- No forecast accuracy figure is citable. The plan uses AMC while the forecast fails its rule (RR-003, RR-401).
- Routing is a straight-line sweep heuristic, not an optimiser (RR-021). Lead time of 30 days is an assumption.
- Approvals are recorded but go nowhere downstream (RR-106).
- Ethiopian supply, climate and mBrana feeds are not connected (RR-301).
- The service metrics labelled coverage are reporting rates until WP-8 (RR-009).
- The internal apps have no URL routing (RR-112) and are desktop-only (RR-113).
- Security hardening for a pilot is not yet done: MFA, real TLS, backups, alerting (RR-102 to RR-105, RR-201 to
  RR-205).

## 7. Fallback if the preflight fails

Present the recorded video and screenshots. Do not "fix live" in front of the customer. Do not bypass the pipeline to
patch numbers. If asked about a visible defect, name it from the limitations list and its finding ID.

## 8. Safe reset and recovery

| Situation | Safe action | Not allowed |
|---|---|---|
| A demo approval must be undone | Use the Revert action in the UI (it is audited) | Deleting rows from `ops_plan.plan_decision` |
| A dashboard shows stale UI | `kubectl -n nhdw rollout restart deploy/<app>` (same digest); confirm `/health` SHA | Rebuilding an image under the same tag |
| Profile copy shows placeholders | Fix the deck in git and redeploy the profile (RR-011) | Hand-editing the host profile directory |
| SSO redirects to `127.0.0.1` | Re-run the Keycloak seed with `PUBLIC_HOST_BASE` and all `DASH_BASE_*` set to the live host; dump client redirect URIs to verify | Re-running the seed with defaults |
| OpenMetadata says "Redirect URI must exactly match" | Check the `openmetadata-env` ConfigMap for `127.0.0.1.nip.io`; re-render with the live host base; restart OM | Editing the Keycloak client instead |
| Marts wrong or missing | `dbt build` at the release tag in the marts Job (scratch first); re-run the P6–P8 checks | Ad-hoc SQL edits to mart tables |
| Platform unrecoverable | Restore from the latest backup (needs WP-6; **no backup exists today**, RR-102) | Cold-booting the shared environment without the owner's go-ahead |

## 9. Troubleshooting (symptom → cause → fix)

| Symptom | Likely cause | Fix |
|---|---|---|
| Control Tower missing from the navigation | Profile disables the page (RR-005) | Switch to the demo profile per D1 |
| "No plan data available." on the Control Tower | Plan load failed, or 403 (same message, RR-016) | Check `/gw/ct/plan` status in devtools; reload (the old build caches the failure) |
| Disease map: "No geographic surveillance data" | `mart_data_quality` missing → 502 (RR-012) | Build the mart; preflight P8 |
| Region filter shows only "All areas" | Profile reference fetched without a token (RR-025) | Needs the WP-2 fix; a reload does not help |
| Overview brief prints "OTHER retains 0.0%" | Programme mapping (RR-013) | WP-2 hides the line; WP-8 fixes the mapping |
| Resource page all zeros | HCMIS lanes empty (RR-301) | Skip the page, or show the "source not connected" labels |
| SSO login loops or errors | Redirect URIs or OM env rendered with localhost | See §8 |
| Old UI (missing forecast range, "Optimized routes") | Image not rebuilt from the tag (RR-004) | Rebuild from the tag; check `/health` SHA |

## 10. Operational runbook gaps

These runbooks are required for the pilot and **do not exist yet**:

| Runbook | Status | Closed by |
|---|---|---|
| Backup and restore (Postgres, Keycloak, SeaweedFS), with RPO/RTO | Missing; no backup has ever been taken | WP-6 |
| Alert response (what each alert means, who responds, within what time) | Missing; alerts go nowhere | WP-6 |
| Data refresh: scheduled chain, freshness SLAs, re-run and backfill procedure | Missing; refresh is manual | WP-5, RR-108 |
| Release and rollback (tag, build by SHA, deploy, verify, roll back) | Missing; tags are mutable | WP-4 |
| Keycloak reseed / password rotation with host-base verification | Known failure mode, not written as a procedure in the repo | WP-0 / WP-10 |
| Profile switch (which pointer is authoritative, what it changes, how to verify) | Two pointers disagree; the procedure is undocumented | WP-1 / WP-10 |
| Incident: data defect found in a published number (correction notice, re-run, communication) | Missing | WP-11 (R-DT2) |
| Access review (who holds which role; tool access) | Missing | WP-7 |
| Support model (hours, severity, contacts, named backup operators) | Missing | WP-11 (R-DS1) |
