# F. Standards framework and acceptance criteria (demo / pilot / production)

Part of the [release-readiness pack](README.md). Prepared 2026-10-20; sources checked against their publishers on that date. Scope: single-node k3s on one Azure VM, with a Postgres data vault and dbt marts, Trino, ClickHouse, a SeaweedFS lake, Airflow, Keycloak and OPA, a FastAPI gateway, React dashboards (public unauthenticated, internal BI, and a Control Tower with ML forecasts and human approve/reject), OpenMetadata, MLflow, and Prometheus/Loki/Alertmanager.

## 0. How to read this

**Labels used for every source**

| Label | Meaning |
|---|---|
| **CONTRACTUAL** | Required by a signed agreement with the customer. **We have not verified any contractual obligation.** No contract, statement of work, data-sharing agreement or donor (Palladium / Global Fund) term has been seen. Nothing below is labelled contractual. If a contract later names a standard (for example "WCAG 2.1 AA" or "ISO 27001"), move that item here and re-baseline. |
| **REGULATORY-TO-CONFIRM** | A law exists that *may* apply. Applicability, the controller/processor roles and the hosting location still need legal confirmation. It is **not** a verified obligation. |
| **ENGINEERING RECOMMENDATION** | Good practice we choose to adopt because it lowers real risk for this platform. It is proportionate to a single VM and a small team. |

**Proportionality rule.** This is one VM run by a small team. We use the standards as checklists to *select from*, and we do not adopt any of them wholesale. We do not recommend HA control planes, service meshes, SIEMs, formal SLSA L3 builders or ISO certification for the demo or the pilot. Where a standard assumes enterprise scale, the criteria below say which part we take and why.

---

## 1. Source register (verified 2026-10-20 against primary sources)

### 1.1 Application and API security

| # | Source | Publisher | URL | Version / date | Why relevant here | Label |
|---|---|---|---|---|---|---|
| S1 | Application Security Verification Standard (ASVS) | OWASP Foundation | https://owasp.org/www-project-application-security-verification-standard/ | **5.0.0**, released 30 May 2025 (verified; project page lists 5.0.0 as latest). About 350 requirements in 17 chapters, levels L1–L3, IDs of the form `v5.0.0-x.y.z` | Gives a testable requirement list for the FastAPI gateway, the Keycloak OIDC flows, session handling, authorisation (OPA) and logging. Use L1 as the floor for the pilot and L2 on the authN/authZ, session, API and data-protection chapters for production. Cite requirement IDs with the version prefix, because numbering changed from 4.0.3. | ENGINEERING RECOMMENDATION |
| S2 | OWASP Top 10:2025 | OWASP Foundation | https://top10.owasp.org/2025 (old path owasp.org/Top10/2025 redirects) | **2025 edition** (RC Nov 2025, final early 2026). A01 Broken Access Control; A02 Security Misconfiguration; A03 Software Supply Chain Failures; A04 Cryptographic Failures; A05 Injection; A06 Insecure Design; A07 Authentication Failures; A08 Software or Data Integrity Failures; A09 Security Logging and Alerting Failures; A10 Mishandling of Exceptional Conditions | Awareness and threat-model checklist. A01 covers the public/internal split and approve/reject authorisation. A02 covers k3s and default credentials. A03 covers images and pip/npm dependencies. A09 covers the audit trail for plan decisions. A10 covers how the gateway fails (fail closed when OPA is unreachable). It is not a test standard; use ASVS for tests. | ENGINEERING RECOMMENDATION |
| S3 | OWASP API Security Top 10 – 2023 | OWASP Foundation | https://owasp.org/API-Security/editions/2023/en/0x11-t10/ | **2023** (current edition) | Our FastAPI gateway is the main attack surface. API1 BOLA and API5 BFLA apply to plan approve/reject and per-programme data. API3 BOPLA applies to over-exposed fields in public endpoints. API4 Unrestricted Resource Consumption applies to unauthenticated public queries hitting Trino/ClickHouse. API9 Improper Inventory Management applies to undocumented or legacy routes. | ENGINEERING RECOMMENDATION |

### 1.2 Accessibility

| # | Source | Publisher | URL | Version / date | Why relevant here | Label |
|---|---|---|---|---|---|---|
| S4 | Web Content Accessibility Guidelines (WCAG) 2.2 | W3C | https://www.w3.org/TR/WCAG22/ | W3C Recommendation, **12 Dec 2024** edition (first published Oct 2023) | **Level AA is the sensible target.** It is the level most public-sector policies reference, and AAA is not expected for whole sites. Most relevant to dashboards: 1.1.1 Non-text content (text alternative or data table for each chart); 1.3.1 Info and relationships (real table markup); 1.4.1 Use of colour (status must not be colour-only, e.g. RAG stock status); 1.4.3 Contrast 4.5:1 for text; 1.4.11 Non-text contrast 3:1 for chart lines, bars and focus rings; 1.4.10 Reflow at 320 CSS px; 2.1.1 Keyboard (filters, tooltips, approve/reject buttons); 2.4.7 Focus visible; new in 2.2: 2.4.11 Focus not obscured (AA), 2.5.7 Dragging movements (AA, e.g. chart brushing needs a non-drag alternative), 2.5.8 Target size minimum 24×24 px (AA), 3.3.8 Accessible authentication (AA, Keycloak login), 4.1.2 Name, role, value; 4.1.3 Status messages (live-region confirmation after approve/reject). | ENGINEERING RECOMMENDATION (becomes CONTRACTUAL or REGULATORY if a customer or national policy names it, which we have not verified) |
| S4a | WAI "Complex Images" tutorial | W3C WAI | https://www.w3.org/WAI/tutorials/images/complex/ | Living tutorial | Practical pattern for charts: a short alt text plus a long description or data table. | ENGINEERING RECOMMENDATION |

### 1.3 Kubernetes and platform operations

| # | Source | Publisher | URL | Version / date | Why relevant here | Label |
|---|---|---|---|---|---|---|
| S5 | Resource Management for Pods and Containers | Kubernetes project | https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/ | Living docs (current release) | On one node, a pod with no requests or limits can starve Postgres or Trino and trigger OOM kills. Set requests on everything and memory limits on the JVM and query engines. | ENGINEERING RECOMMENDATION |
| S6 | Liveness, Readiness and Startup Probes | Kubernetes project | https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/ | Living docs | Readiness gates traffic and liveness restarts hung processes. Slow starters (Trino, OpenMetadata, Keycloak) need startup probes so they are not killed while booting. | ENGINEERING RECOMMENDATION |
| S7 | Specifying a Disruption Budget (PDB) | Kubernetes project | https://kubernetes.io/docs/tasks/run-application/configure-pdb/ | Living docs | **Limited value on one node.** A PDB only governs voluntary evictions such as drains. With `replicas: 1`, a PDB with `minAvailable: 1` blocks the node drain. Record this as an accepted single-node limitation rather than adding PDBs for show. | ENGINEERING RECOMMENDATION (mostly N/A) |
| S8 | Role Based Access Control Good Practices | Kubernetes project | https://kubernetes.io/docs/concepts/security/rbac-good-practices/ | Living docs | Least privilege for service accounts (Airflow KubernetesPodOperator, operators). Avoid wildcard verbs and cluster-admin bindings. Note that `list` on Secrets exposes their contents. | ENGINEERING RECOMMENDATION |
| S9 | Good practices for Kubernetes Secrets | Kubernetes project | https://kubernetes.io/docs/concepts/security/secrets-good-practices/ | Living docs | Secrets are unencrypted in etcd/kine by default. Enable encryption at rest (k3s `--secrets-encryption`), restrict get/list/watch, never commit Secret manifests (base64 is not encryption), and do not log secret values. | ENGINEERING RECOMMENDATION |
| S10 | Pod Security Standards (Privileged / Baseline / Restricted) and Pod Security Admission | Kubernetes project | https://kubernetes.io/docs/concepts/security/pod-security-standards/ ; https://kubernetes.io/docs/concepts/security/pod-security-admission/ | Living docs | Label namespaces at least `baseline` in enforce mode and `restricted` in warn/audit mode. This finds privileged or root containers without breaking third-party charts on day one. | ENGINEERING RECOMMENDATION |
| S11 | Single-node limitation (derived from S5–S7) | — | — | — | One VM means one failure domain. A VM reboot, disk loss or Azure maintenance causes a full outage. The answer at this scale is a stated availability target, tested restore and documented maintenance windows, **not** multi-node HA. Revisit HA only if a production SLA demands it. | ENGINEERING RECOMMENDATION |

### 1.4 Software delivery and supply chain

| # | Source | Publisher | URL | Version / date | Why relevant here | Label |
|---|---|---|---|---|---|---|
| S12 | SLSA specification | OpenSSF / SLSA project | https://slsa.dev/spec/v1.2/ (v1.1: https://slsa.dev/spec/v1.1/) | **v1.2 is current** (it adds the Source track). v1.1 is a backward-compatible clarification of v1.0. | A vocabulary for build provenance. Proportionate target: **Build L1** (scripted build that emits provenance) for the pilot and **Build L2** (hosted CI such as GitHub Actions with signed provenance) for production. Skip L3. | ENGINEERING RECOMMENDATION |
| S13 | NIST SP 800-218 Secure Software Development Framework (SSDF) | NIST | https://csrc.nist.gov/pubs/sp/800/218/final (v1.1, Feb 2022); draft Rev 1 / SSDF **v1.2** IPD at https://csrc.nist.gov/pubs/sp/800/218/r1/ipd (17 Dec 2025, comments closed 30 Jan 2026, **not final** at time of writing) | v1.1 final; v1.2 draft | A practice checklist (PO/PS/PW/RV groups): protect the code, review, test, track vulnerabilities, keep provenance. Use it as a gap list, not as an attestation. It is a US federal procurement reference, so it is not binding here. | ENGINEERING RECOMMENDATION |
| S14 | DORA software delivery performance metrics | DORA (Google Cloud) | https://dora.dev/guides/dora-metrics-four-keys/ | Page updated 5 Jan 2026. It now names **five** metrics: change lead time, deployment frequency, failed deployment recovery time, change fail rate, deployment rework rate. | Lightweight production health of the delivery process. Measure from git tags and the deploy log; no tooling purchase needed. Use it for production, not for gating the demo. | ENGINEERING RECOMMENDATION |
| S15 | Image references by digest; reproducible/traceable builds | Kubernetes docs "Images" (https://kubernetes.io/docs/concepts/containers/images/) ; Reproducible Builds (https://reproducible-builds.org/) | Living docs | Pin images by `@sha256:` digest (or an immutable tag plus a recorded digest) so the running cluster maps exactly to a commit. This matters here: every custom image is tagged `1.0.0` and rebuilt in place, so "what is running?" cannot be answered (RR-004). | ENGINEERING RECOMMENDATION |

### 1.5 Observability and SRE

| # | Source | Publisher | URL | Version / date | Why relevant here | Label |
|---|---|---|---|---|---|---|
| S16 | Site Reliability Engineering, ch. 4 "Service Level Objectives" | Google (O'Reilly, free online) | https://sre.google/sre-book/service-level-objectives/ | 2016, online | Define a few SLIs and SLOs per user journey (public dashboard availability and latency, Control Tower load, nightly pipeline completion) instead of "everything up". | ENGINEERING RECOMMENDATION |
| S17 | SRE book, ch. 6 "Monitoring Distributed Systems" (the four golden signals) | Google | https://sre.google/sre-book/monitoring-distributed-systems/ | 2016 | Latency, traffic, errors and saturation at the gateway and ingress. Alert on symptoms users feel; route cause metrics (pod restarts, disk) to dashboards or tickets unless they predict an outage, such as disk fill. | ENGINEERING RECOMMENDATION |
| S18 | The Site Reliability Workbook, "Alerting on SLOs" | Google | https://sre.google/workbook/alerting-on-slos/ | 2018 | Burn-rate alerting pattern for Alertmanager. Use a simple multi-window form only at production. | ENGINEERING RECOMMENDATION |

### 1.6 Data quality and reliability

| # | Source | Publisher | URL | Version / date | Why relevant here | Label |
|---|---|---|---|---|---|---|
| S19 | "The Six Primary Dimensions for Data Quality Assessment" | DAMA UK Working Group | (DAMA UK white paper, Oct 2013; no stable official URL, cite as such) ; DAMA-DMBOK 2nd ed. (DAMA International, 2017; revised 2024) https://www.dama.org/cpages/body-of-knowledge | 2013 / DMBOK2 | Completeness, uniqueness, timeliness, validity, accuracy and consistency give each data-truth criterion a named dimension. Uniqueness is directly relevant to the eLMIS **double-load** (RR-002, marts about 4×). Accuracy needs reconciliation to a trusted external figure. | ENGINEERING RECOMMENDATION |
| S20 | dbt data tests (generic: unique, not_null, accepted_values, relationships; singular tests) | dbt Labs | https://docs.getdbt.com/docs/build/data-tests | Living docs | Executable form of validity and uniqueness on hubs, links and marts. Gate mart builds with `dbt build` so a failed test stops the downstream models. | ENGINEERING RECOMMENDATION |
| S21 | dbt `freshness` config and `dbt freshness` / `dbt source freshness` | dbt Labs | https://docs.getdbt.com/reference/resource-properties/freshness | Living docs. Config sits under `config:` from v1.9; `loaded_at_field` moved and `loaded_at_query` was added in v1.10 | Executable timeliness: `warn_after` and `error_after` per source, tied to an agreed **freshness SLA** for each feed (DHIS2, eLMIS, etc.). Check which syntax our pinned dbt version accepts. | ENGINEERING RECOMMENDATION |

### 1.7 Backup, recovery and contingency

| # | Source | Publisher | URL | Version / date | Why relevant here | Label |
|---|---|---|---|---|---|---|
| S22 | NIST SP 800-34 Rev. 1, Contingency Planning Guide for Federal Information Systems | NIST | https://csrc.nist.gov/pubs/sp/800/34/r1/upd1/final | Rev. 1 (May 2010, updated Nov 2010) | Defines the terms (BIA, RTO, RPO, MTD) and the plan-test-exercise cycle. Take the concepts and a one-page BIA, not the federal paperwork. | ENGINEERING RECOMMENDATION |
| S23 | "Data Backup Options" | US-CERT / CISA | https://www.cisa.gov/sites/default/files/publications/data_backup_options.pdf | 2012 | States the **3-2-1 rule** verbatim: 3 copies, 2 media types, 1 offsite. For us that means the live Postgres plus a SeaweedFS/local backup plus an off-VM copy (Azure Blob in another region or account). A backup that sits only on the same VM is not a backup. | ENGINEERING RECOMMENDATION |
| S24 | PostgreSQL 18 docs §25.3 "Continuous Archiving and Point-in-Time Recovery (PITR)" | PostgreSQL Global Development Group | https://www.postgresql.org/docs/current/continuous-archiving.html | PG 18 (current) | Base backup plus continuous WAL archive gives a low RPO. Monitor archiving (a failing `archive_command` grows `pg_wal` until the disk fills) and verify the restored data. Daily `pg_dump` alone is acceptable for the demo and pilot if the RPO of about 24 h is accepted in writing. | ENGINEERING RECOMMENDATION |

### 1.8 Health-data privacy and governance

| # | Source | Publisher | URL | Version / date | Why relevant here | Label |
|---|---|---|---|---|---|---|
| S25 | Handbook on Statistical Disclosure Control (Hundepool, Domingo-Ferrer et al.) | ESSnet on SDC / Statistics Netherlands (CASC); 2nd edition 2025 under the STACE project | https://research.cbs.nl/casc/handbook.htm (ESSnet edition); Wiley book 2012 ISBN 9781119978152 | ESSnet edition; 2nd ed. Aug 2025 | The recognised methods reference for tabular outputs. Frequency tables need **primary suppression** of small cells **and secondary (complementary) suppression** so suppressed cells cannot be back-calculated from totals or other dimensions (e.g. region × month × sex). | ENGINEERING RECOMMENDATION |
| S26 | CMS Cell Size Suppression Policy (as summarised by ResDAC) | US CMS / ResDAC | https://resdac.org/articles/cms-cell-size-suppression-policy | ResDAC summary dated 26 Jan 2024 | A concrete, widely cited threshold example: no cell of 1–10 may be shown or derivable, zero is allowed, and percentages that reveal such a cell are also barred. **Use it only as a benchmark.** The threshold for Ethiopia and Zambia must be set by the data owner (MoH). Thresholds of <5 and ≤10 are both common in practice. | ENGINEERING RECOMMENDATION (benchmark only, not applicable law) |
| S27 | WHO Data Principles | World Health Organization | https://www.who.int/data/principles | Adopted 2020 | Data as a public good, released "when safe and ethical", stewardship and FAIR. Supports a documented release policy for the public dashboard. | ENGINEERING RECOMMENDATION |
| S28 | Zambia Data Protection Act, 2021 (Act No. 3 of 2021) | Parliament of Zambia (text at ZambiaLII) | https://zambialii.org/akn/zm/act/2021/3/eng@2021-03-24 | Assented March 2021. Office of the Data Protection Commissioner. Data Protection (Registration and Licensing) Regulations SI 58/2021. | We hold Zambian eLMIS data. Possible duties: controller/processor registration, cross-border transfer and localisation, breach handling. **Applicability to aggregated logistics data hosted on an Azure VM, and who the controller is, are to be confirmed.** Secondary sources disagree on the commencement date and on whether the regulator is operational. | REGULATORY-TO-CONFIRM |
| S29 | Ethiopia Personal Data Protection Proclamation No. 1321/2024 | House of Peoples' Representatives (Federal Negarit Gazette) | Official gazette text not retrieved. Tracker: https://digitalpolicyalert.org/event/24895-adopted-personal-data-protection-proclamation-proclamation-no-13212024 | Adopted Apr 2024; reported in force Jul 2024. Ethiopian Communications Authority named as supervisor (secondary sources). | Reported provisions include local storage of personal data, transfer restrictions, DPIA, a DPO, and 72-hour breach notification. **Verify against the gazette text.** It matters most if any person-level or small-cell data enters the lake or the Azure region is outside Ethiopia. | REGULATORY-TO-CONFIRM |

### 1.9 ML transparency and forecast evaluation

| # | Source | Publisher | URL | Version / date | Why relevant here | Label |
|---|---|---|---|---|---|---|
| S30 | Mitchell et al., "Model Cards for Model Reporting" | FAT* 2019 (ACM) | https://arxiv.org/abs/1810.03993 | 2019 | A one-page model card per Control Tower forecast model: intended use (decision support with human approval, not automatic ordering), training data and its known defects (**the current champion was trained on double-loaded eLMIS**), metrics by disaggregation (product, facility tier), and caveats. | ENGINEERING RECOMMENDATION |
| S31 | Hyndman & Koehler, "Another look at measures of forecast accuracy" | International Journal of Forecasting 22(4) | https://doi.org/10.1016/j.ijforecast.2006.03.001 | 2006 | Defines **MASE** (scaled against a naive or seasonal-naive baseline; below 1 beats the baseline). It suits intermittent, zero-heavy consumption series, where MAPE breaks. | ENGINEERING RECOMMENDATION |
| S32 | Hyndman & Athanasopoulos, *Forecasting: Principles and Practice* 3rd ed., §5.8 "Evaluating point forecast accuracy", §5.9 "Evaluating distributional forecast accuracy", §5.10 time-series cross-validation | OTexts | https://otexts.com/fpp3/accuracy.html ; https://otexts.com/fpp3/distaccuracy.html ; https://otexts.com/fpp3/tscv.html | Online edition | Rolling-origin backtests, scaled errors, and prediction-interval evaluation (coverage, Winkler score, CRPS). **WAPE** (sum of absolute errors divided by sum of actuals) is common practice for aggregating across products. There is no single standards-body definition, so state the formula in the model card. | ENGINEERING RECOMMENDATION |

---

## 2. Acceptance criteria

Each criterion has an ID, the criterion, and **how it is verified** (the evidence a reviewer can rerun or inspect). "Evidence" means a file committed under the assessment folder or a linked CI run. Prose claims do not count. Criteria are cumulative: the pilot includes everything in the demo set and production includes everything in the pilot set, unless a criterion is tightened.

### 2.1 Set 1: Credible, repeatable customer demonstration (16 criteria)

Goal: a scripted walk that any team member can run twice in a row with the same numbers, and that shows nothing false, nothing private and nothing broken.

**Data truth**
- **D-DT1. No known-wrong headline numbers.** Every figure on the demo path (public dashboard KPIs, Control Tower tiles) comes from a mart with no open S1 data finding in the [findings register](03-findings-register.md), so the eLMIS double-load must be fixed or the affected figures hidden. *Verify:* for each demo figure, run a reconciliation query from source row count to mart and record it in a table. Distinct-key counts equal total counts in the hubs and links (uniqueness).
- **D-DT2. Demo dataset is frozen.** Snapshot date and version are recorded, so a rerun shows the same values. *Verify:* run the demo twice and diff the screenshots or values of 5 named KPIs; there must be no differences.
- **D-DT3. No unsupported metric claims.** No accuracy figure (e.g. MASE) appears in slides or UI unless it is logged in MLflow for the model actually served and that model was trained on corrected data. *Verify:* the MLflow run ID for each quoted metric matches the deployed model version; otherwise remove the claim.

**Functional journeys**
- **D-FJ1. Scripted journeys pass end to end:** (a) public dashboard loads without login; (b) SSO login to internal BI; (c) Control Tower shows forecast, plan, then approve/reject, and the decision persists. *Verify:* the written demo script is executed and timed with screenshots, twice, on the live URL.
- **D-FJ2. No dead ends on the demo path.** No placeholder text, blank panels, console errors or 4xx/5xx on the scripted pages. *Verify:* browser devtools capture (console and network) for each scripted page.

**Security and privacy**
- **D-SP1. Public endpoints expose only aggregates.** *Verify:* enumerate public API routes from the OpenAPI spec and the ingress, call each one unauthenticated, and confirm no row-level or person-level fields. Internal routes return 401/403 without a token (OWASP API1/API5).
- **D-SP2. Small-cell rule applied on public pages, or the risk recorded.** *Verify:* a query of the public marts for counts between 1 and the agreed threshold (provisionally <5 or ≤10, per S25/S26) returns zero displayed cells. If it does not, record a signed-off exception that states the data is aggregated logistics data, not patient data.
- **D-SP3. No default or demo credentials, TLS on all exposed hosts.** *Verify:* check the Keycloak admin, Airflow, OpenMetadata, Grafana and MLflow login pages for default passwords. A TLS check (e.g. `curl -vI`) on every ingress host must show a valid certificate. Keycloak client redirect URIs point at the live host and not at localhost.

**Accessibility**
- **D-AC1. Demo pages pass automated checks with no "serious" or "critical" findings.** *Verify:* axe-core (or Lighthouse accessibility) report saved per scripted page.
- **D-AC2. Keyboard walk of the approve/reject journey.** *Verify:* a manual tab-through (focus visible, operable, confirmation announced) is recorded as pass/fail.

**Reliability and ops**
- **D-RO1. Stack healthy before the demo.** *Verify:* the pre-demo checklist output shows all pods Ready, zero CrashLoopBackOff, disk below 80%, and the last Airflow DAG runs green.
- **D-RO2. A recent backup exists and has been restored once.** *Verify:* a Postgres dump from the last 24 h is restored into a scratch database and its row counts match the key marts.

**Delivery and traceability**
- **D-DL1. What is running is identified.** *Verify:* `kubectl get pods -o jsonpath` lists the image digest of each app image, and those digests map to a git commit or tag recorded in the release note.
- **D-DL2. The demo build is tagged.** *Verify:* a git tag exists, and the deployed manifests at that tag match the cluster (spot-check 3 deployments).

**Documentation and support**
- **D-DS1. Demo script plus a known-limitations sheet.** It states the data period, the sources (Zambian eLMIS vs Ethiopian data), what is synthetic or provisional, and that forecasts are decision support. *Verify:* the document exists and a second team member has run the script from it alone.
- **D-DS2. Fallback plan.** Recorded video or screenshots in case the live system fails. *Verify:* the file exists and plays.

### 2.2 Set 2: Controlled customer pilot (19 criteria)

Goal: named customer users work on the real system for weeks with real decisions logged, and we can detect, explain and recover from problems.

**Data truth**
- **P-DT1. Automated data tests gate the marts.** dbt generic tests (unique, not_null, relationships, accepted_values) run on hubs, links and every pilot mart, and `dbt build` stops downstream models on failure. *Verify:* the CI or Airflow log of the last 10 runs, plus one deliberately injected duplicate that is caught.
- **P-DT2. Freshness SLAs per source, agreed with the data owner and enforced.** `warn_after` and `error_after` are set for each source, and the dashboard shows an "as of" date. *Verify:* `dbt source freshness` output, plus a stale source simulated to show the warning.
- **P-DT3. Reconciliation to an external reference.** For at least 3 key indicators, the mart value is within an agreed tolerance of the owner's official figure (DHIS2 / eLMIS report) (accuracy dimension). *Verify:* a signed reconciliation sheet.
- **P-DT4. Lineage is complete for pilot marts.** *Verify:* OpenMetadata shows source to vault to mart to dashboard for each pilot KPI. Spot-check 5 KPIs; none may be broken.
- **P-DT5. A model card for each served forecast model,** retrained on corrected data. It reports backtest MASE against the seasonal-naive baseline, WAPE, and 80%/95% prediction-interval empirical coverage, measured with rolling-origin evaluation (S30–S32). *Verify:* the model card file and its MLflow run ID. Coverage is within ±10 points of nominal or the shortfall is disclosed.

**Functional journeys**
- **P-FJ1. Pilot user journeys accepted by named customer users** (UAT script per role: public viewer, analyst, supply-chain approver). *Verify:* UAT sign-off sheet with defects triaged.
- **P-FJ2. Approve/reject decisions are auditable:** who, when, which plan version, which forecast run, and the reason. *Verify:* query the audit table after a test decision and check that all fields are populated and the record is immutable to normal users.

**Security and privacy**
- **P-SP1. ASVS 5.0 L1 self-assessment complete for the gateway, SSO and dashboards,** with no open high findings. *Verify:* the checklist with requirement IDs and pass/fail/N-A for each.
- **P-SP2. Authorisation tests for each role.** Negative tests show a viewer cannot approve, a user cannot fetch another programme's restricted data (BOLA), and the gateway fails closed when OPA is down (OWASP A01, A10; API1/API5). *Verify:* automated test run output.
- **P-SP3. Dependency and image vulnerability scan** (e.g. Trivy/Grype on images, pip-audit/npm audit). There are no unaddressed criticals with a known fix. *Verify:* the scan report attached to the release.
- **P-SP4. Secrets hygiene.** k3s secrets encryption at rest is enabled, no secrets are in git history for current values, and RBAC grants no `list secrets` to app service accounts (S8/S9). *Verify:* the k3s config flag, a `gitleaks` run, and `kubectl auth can-i --list` per service account.
- **P-SP5. Data protection applicability memo.** Zambia DPA 2021 and Ethiopia Proclamation 1321/2024 are assessed for this data and hosting location, the controller/processor named, and the small-cell threshold agreed with the data owner in writing. *Verify:* the memo plus the data-owner sign-off.

**Accessibility**
- **P-AC1. WCAG 2.2 AA review of pilot pages:** automated checks plus a manual check of the S4 list (charts have a table or text alternative; colour is not the only status cue; contrast; target size; keyboard; status messages). *Verify:* the issue list with open AA failures either fixed or logged with dates.

**Reliability and ops**
- **P-RO1. Requests and limits on every workload, probes on every long-running service** (S5/S6). *Verify:* a script that lists containers missing requests, limits or probes, with an empty output (or justified exceptions).
- **P-RO2. Symptom alerts reach a human.** Alerts cover public and internal endpoint availability, gateway 5xx rate, p95 latency, Airflow DAG failure, freshness breach, disk above 80%, and backup job failure. *Verify:* fire each alert once (synthetic) and show it received in the agreed channel.
- **P-RO3. RPO and RTO stated and a restore drill completed.** Example: RPO ≤ 24 h and RTO ≤ 8 h, agreed with the customer. *Verify:* a timed restore drill log of Postgres plus SeaweedFS buckets to a clean namespace or VM, with measured time below the RTO. One backup copy is off-VM (3-2-1).

**Delivery and traceability**
- **P-DL1. Images are deployed by digest from a scripted, repeatable build that records provenance** (commit, builder, digest), approximately SLSA Build L1. *Verify:* the release manifest lists digests, and rebuilding from the tag reproduces the same artefact list.
- **P-DL2. Changes go through a reviewed PR before reaching the pilot environment, and a rollback is rehearsed.** *Verify:* PR links for each change in the release note, and a rollback drill log.

**Documentation and support**
- **P-DS1. Runbook, support contact, hours and severity definitions;** pilot users know how to report issues. *Verify:* the runbook covers restart, restore, freshness breach and alert response, and a non-author has followed one runbook procedure successfully.

### 2.3 Set 3: Supported production deployment (20 criteria)

Goal: the customer relies on the system for routine decisions under an agreed service level, and operations do not depend on any one person.

**Data truth**
- **R-DT1. Data-quality SLOs across the six DAMA dimensions,** published and tracked (e.g. ≥99% of scheduled loads on time; zero uniqueness failures reaching marts; validity test pass rate). *Verify:* monthly DQ report generated from test results.
- **R-DT2. Data incidents handled through a defined process:** detection, publish a correction notice on affected dashboards, root cause. *Verify:* one tabletop exercise record, and that the correction-banner mechanism works.
- **R-DT3. Model governance.** Scheduled backtest monitoring of the forecast models with a drift/degradation threshold that triggers retraining or rollback. Model card updated on each promotion, and the champion is promoted only if it beats the baseline on holdout. *Verify:* MLflow registry history and the last monitoring report.

**Functional journeys**
- **R-FJ1. Automated end-to-end smoke tests** for the critical journeys (public load, login, Control Tower approve/reject) run after every deploy and on a schedule. *Verify:* CI or synthetic-check history.
- **R-FJ2. Performance meets the agreed SLO under the expected load,** e.g. public dashboard p95 < 3 s at N concurrent users and a rate limit on unauthenticated queries (API4). *Verify:* load test report (k6/Locust) and a rate-limit test.

**Security and privacy**
- **R-SP1. ASVS 5.0 L2 on the authentication, session, access-control, API and data-protection chapters;** independent penetration test of the internet-facing surface with high and critical findings fixed. *Verify:* the assessment and the pentest report with retest evidence.
- **R-SP2. Pod Security Admission:** `baseline` enforced on all app namespaces and `restricted` warn/audit with a burn-down list. *Verify:* namespace labels and the audit output.
- **R-SP3. Audit logging and retention** for authentication events, admin actions and plan decisions, stored outside the app's own database with retention agreed. *Verify:* a Loki query for a known event older than 30 days.
- **R-SP4. Legal obligations confirmed and met.** The REGULATORY-TO-CONFIRM items are resolved to applies or does not apply. If they apply, registration, DPIA, breach procedure and data-residency decisions are documented. *Verify:* legal sign-off memo.
- **R-SP5. Patch cadence.** OS, k3s and images are updated on a schedule (e.g. monthly, criticals within 14 days). *Verify:* patch log for the last 3 cycles.

**Accessibility**
- **R-AC1. WCAG 2.2 AA conformance statement** for the public dashboard and internal BI, with known exceptions and a feedback contact. Accessibility checks run in CI. *Verify:* the published statement and the CI job.

**Reliability and ops**
- **R-RO1. SLOs per user journey with an error budget,** for example 99.5% monthly availability for the public dashboard (realistic on one VM, about 3.6 h/month). Alerting uses symptom and burn-rate rules (S16–S18). *Verify:* SLO dashboard plus 1 month of measured data.
- **R-RO2. Single-node risk explicitly accepted, or mitigated.** The customer signs off on the single-VM failure domain and the maintenance windows, or HA is funded. VM-level backup or snapshot and a documented rebuild-from-scratch procedure exist. *Verify:* signed risk acceptance plus a rebuild drill on a fresh VM within the RTO.
- **R-RO3. Postgres PITR (base backup plus WAL archive) if the agreed RPO is below 24 h,** with archive-failure alerting. Quarterly restore tests are scheduled and logged. *Verify:* `pg_stat_archiver` plus alert test plus restore logs (S24).
- **R-RO4. Capacity monitoring and forecast** (disk, memory, Postgres size, SeaweedFS growth) with a headroom threshold. *Verify:* capacity dashboard and the last review note.

**Delivery and traceability**
- **R-DL1. CI-built images with signed provenance (approximately SLSA Build L2), an SBOM per release, and deploys by digest only.** *Verify:* provenance and SBOM attached to the release, and an admission check or script showing no tag-only references.
- **R-DL2. DORA metrics tracked** (lead time, deployment frequency, change fail rate, failed-deployment recovery time, rework rate). *Verify:* a quarterly figure computed from git and the deploy log.
- **R-DL3. SSDF gap list reviewed** with owners for the open practices. *Verify:* the dated gap list.

**Documentation and support**
- **R-DS1. Support model agreed:** hours, severity levels, response and resolve targets, escalation, and named backup operators (no single person), all in a support agreement. *Verify:* the signed support agreement and an on-call or rota record.
- **R-DS2. Operator and user documentation complete:** architecture, runbooks, data dictionary and metric definitions (from OpenMetadata), model cards, release notes, and handover tested by a non-author. *Verify:* doc index plus a handover exercise record.

---

## 3. Notes and caveats

- **Contractual:** none verified. Before the pilot, ask the customer and Palladium for any required standards (accessibility, hosting location, security certification, data-sharing agreement terms) and re-label items accordingly.
- **Regulatory:** S28 and S29 are flagged only. Secondary sources disagree on details (Zambia's commencement date and regulator status; Ethiopia's provision specifics). Read the official texts with counsel.
- **Small-cell threshold:** no single universal number exists. S25 gives the method (primary plus secondary suppression) and S26 gives one recognised benchmark (1–10). The data owner must set the threshold. For aggregated stock and consumption data with no patient attributes, the risk is lower, but the decision should still be written down.
- **WAPE** is industry practice rather than a standard. Define it in each model card. MASE and interval coverage are grounded in S31/S32.
- **Kept out on purpose (not proportionate now):** multi-node HA, service mesh, SLSA Build L3, a formal ISO 27001 ISMS, a SIEM, and PDBs on single-replica workloads. Revisit if a production contract or an SLA above about 99.5% requires them.
