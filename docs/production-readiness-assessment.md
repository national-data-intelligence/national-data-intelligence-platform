# Ethiopia NHDW — Production-Readiness Assessment

**Assessed:** 14 July 2026 · **Yardstick:** Ethiopia NHDW High-Level Requirements (FINAL, 28 Nov 2024, 182 pp.)
**Method:** code-level audit of every subsystem + requirement extraction from the HLR.
**Scope note:** the *Call for Expression of Interest* is an EMR facility-deployment tender, **not** a data-warehouse specification (no DW functional/non-functional requirements, no KPIs, no Data Vault modelling). The HLR is therefore the sole scoring yardstick; the EOI is context only.

> An interactive version of this report (scorecard, traceability matrix, prioritized backlog) is published as an Artifact.

## Overall verdict — 2.7 / 5 · Advanced prototype, not yet production-ready

The application and data-modelling layers are genuinely built and real-data-backed. What stands between the NHDW and a national deployment is **operational and security hardening**.

- **Application & data modelling ≈ 3.0/5** — ingestion, Data Vault 2.0 + marts, gateway/authz, dashboards, ML are all above demo grade, real data end to end.
- **Operational & security hardening ≈ 2.0/5** — storage durability, infrastructure/HA/DR, and identity hardening are single-node, demo-grade for a national system.

Scoring key: 5 = production-grade for a national health system; 3 = correct and real, but not hardened; 2 = demo-grade. The gap is not "does it work" (much does) — it is "would it survive a node failure, a breach attempt, a bad source record, or an Amharic-speaking user."

## Subsystem scores

| # | Subsystem | Score | Verdict |
|---|-----------|:---:|---------|
| 1 | Data platform (DV2.0 + marts) | 3/5 | Idiomatic insert-only vault; marts from real pipeline data; quality gates unwired |
| 2 | Source ingestion | 3/5 | Real dlt ingestors on real product replicas; batch-only, no scheduler/CDC/DLQ |
| 3 | Gateway API + authorization | 3/5 | Fail-closed two-plane authz; no rate limiting, near-zero PEP tests |
| 4 | Dashboards / 5 SPAs | 3/5 | Excellent real-data catalog runtime; no i18n, DEV_AUTH default, chart a11y |
| 5 | ML / Data Quality / Observability | 3/5 | Real models + drift/retrain + honest monitoring; dead SLO alert, no DQ gating |
| 6 | Security & identity | 2.5/5 | Real fail-closed OPA core; no MFA, self-signed TLS, OpenBao inert |
| 7 | Storage (PG / ClickHouse / MinIO) | 2/5 | Excellent schema; no backup/DR, no encryption at rest, no HA |
| 8 | Infrastructure / bootstrap / cold-boot | 2/5 | Disciplined single bootstrap; zero HA, no DR, no CI/CD, network policy off |

## Requirements traceability (HLR)

Status reflects what the code actually implements. Met = production-capable; Partial = real but incomplete/unhardened; Gap = largely absent or demo-only.

| Requirement area | Status | Evidence & gap |
|------------------|--------|----------------|
| Ingestion (A1) | Partial | Real ETL from real replicas (SQL/API/FHIR). Missing scheduling (FR-ING-5), push/events (FR-ING-3), OpenHIM (FR-ING-7), real-time/CDC (FR-ING-8). |
| Storage & DV2.0 (A2) | **Met** | Data lake, idiomatic insert-only Data Vault 2.0, dimensional marts — strong. Real-time store view-only. |
| Data quality (A3) | Partial | DQ computed across 6 sources + EARS anomaly detection, but not enforced as a gate; timeliness never computed; no referential-integrity tests. |
| BI & dashboards (A4) | **Met** | Role-scoped dashboards, drill-down/filter, geospatial, forecasting, OLAP/Superset, secure open-data API. |
| ML / forecasting (A5) | **Met** | Real trained models, MLflow registry, drift + retrain, anomaly detection. Ethical-AI controls nominal. |
| Security & access (A6) | Partial | Strong RBAC, audit, PII de-id, Keycloak SSO. Gaps: no enforced MFA (FR-SEC-3), consent purpose hardcoded. |
| Interoperability (A7) | **Gap** | EMR reshaped to FHIR on ingest, but no OpenHIM, no terminology service (SNOMED/ICD/LOINC), no OpenHIE, no FHIR export. |
| Metadata & catalog (A8) | **Gap** | dbt lineage + model docs, but no data dictionary (FR-MET-1), no data catalog (FR-MET-3); MDM = facility-resolution only. |
| Public / open data (A9) | **Met** | Public dashboards, k-anonymized open-data catalogue, transparency surfaces (k-anon enforcement needs tightening). |
| Ops & monitoring (A10) | Partial | Prometheus + Loki + Alertmanager with real gateway metrics, but the error-rate alert is broken and no SLOs. |
| NFR — Security | **Gap** | RBAC + audit met; encryption at rest absent, MFA absent, TLS self-signed, incident response undefined. |
| NFR — Availability / DR | **Gap** | All tiers single-replica; no backup, no PITR, no failover; Tier-II / ISO 27001 / 99.741% unaddressed. |
| NFR — Performance / scale | Partial | Gateway autoscales (HPA); databases single-instance, no pooling or load testing. |
| NFR — Governance / privacy | Partial | PII zone + real consent-gate macro, but purpose-of-use is a constant, retention (15-yr) not enforced. |
| NFR — Maintainability / testing | **Gap** | Modular, but thin tests and no CI/CD — nothing gates a change before an image is built. |
| NFR — Usability / i18n | Partial | Usable UI, but no internationalization — Amharic is two strings; a Federal-MoH blocker. |
| NFR — Auditability | **Met** | Comprehensive request + policy audit logging (append-only grants). Not yet tamper-evident. |
| Localization | Partial | Ethiopian fiscal/HMIS calendar + Fayda (now real email-OTP) implemented; UI language localization outstanding. |
| MVP KPIs — Malaria (Table 7) | Partial | Malaria KPI mart + disease page cover core metrics; ITN/IRS-coverage + per-1,000-PY rates need verifying against all 10. |
| MVP KPIs — Service delivery (Table 8) | Partial | HIV/TB/MNCH cascades, zero-dose, immunization built; several of 16 (contraceptive acceptors, C/S, postnatal, nutrition, infant death rate) not yet distinct marts. |
| Subject areas — Financing & mortality | **Gap** | Health financing/CBHI (BR5) and mortality/CRVS in-scope but no marts; equity geography-only. |

## Production-readiness backlog

Priority: **P0** blocks go-live for a health system · **P1** required for trustworthy operation · **P2** required for completeness. Effort: **S** ≤ days · **M** ≈ weeks · **L** ≈ months.

### P0 — Security & compliance
- **Enforce MFA** on both realms (TOTP/WebAuthn required), brute-force protection, stop clearing required-actions for privileged users. *(FR-SEC-3, M)*
- **Real TLS** — cert-manager + trusted CA, `sslRequired: external`, disable Keycloak HTTP/dev mode, HSTS, parameterize base domain. *(NFR-SEC-1, M)*
- **Encryption at rest** — etcd secret encryption, MinIO SSE-KMS, encrypted storage class, intra-cluster TLS. *(NFR-SEC-1, M)*
- **Remove demo auth from prod** — `DEV_AUTH=false` default, disable `GATEWAY_DEMO_IMPERSONATION`, per-user passwords, scope down super-user. *(FR-SEC-2, S)*
- **Deploy OpenBao + External Secrets** with dynamic short-TTL DB creds + rotation (design already exists, inert). *(NFR-SEC-1, L)*
- **Tamper-evident audit** — hash-chain/sign rows, WORM sink, retention/prune job. *(NFR-AUD-2, M)*

### P0 — Availability, durability & disaster recovery
- **High availability** — multi-node cluster; Postgres HA (Patroni/CloudNativePG), replicated ClickHouse, distributed MinIO; PDBs + anti-affinity; replicas > 1. *(NFR-AVAIL-1, L)*
- **Backup & DR automation** — scheduled pg_dump/WAL archiving + MinIO replication + cluster-object backup + tested restore runbook. *(NFR-AVAIL-2/4, M)*
- **Resource requests & limits** on every data workload (Guaranteed QoS for DBs) + tuned Postgres + PgBouncer. *(NFR-PERF, S)*

### P1 — Data trust
- **Wire quality gates into the run** — `dbt test`, generated-vault-test drift check, sat-payload alignment must fail the build. *(FR-DQ-1, S)*
- **Safe casting + threshold gates** — `try_cast` on every cast; fail/quarantine partitions below HLR thresholds; auto-unpublish public marts on k-anon failure. *(FR-DQ-3/5, M)*
- **Close test gaps** — schema tests for 25 untested staging models; referential-integrity tests across marts; compute timeliness. *(FR-DQ-6, M)*

### P1 — Pipeline operations
- **Schedule the pipeline** — ingestion + the paused warehouse-refresh as scheduled Airflow DAGs/CronJobs. *(FR-ING-5, M)*
- **CDC + dead-letter** — real CDC for fact sources; per-record error lane. *(FR-ING-2/8, L)*
- **Trustworthy ingest telemetry** — real row counts in manifests, push metrics, freshness-SLA alerts. *(FR-OPS-4, S)*
- **Fix & deepen monitoring** — correct the dead error-rate alert, add latency SLOs + burn-rate alerts, export ML/DQ health. *(FR-OPS-2/4, S)*

### P1 — Platform & delivery hardening
- **CI/CD** — lint + `opa test` + `dbt build` + SPA typecheck + Trivy/cosign + GitOps. *(NFR-MAINT-2, M)*
- **Network segmentation** — default-deny NetworkPolicies per tier (CNI supports it, currently disabled). *(NFR-SEC-2, M)*
- **API abuse protection** — rate limiting on anon + LLM endpoints; stop leaking DB exception text. *(NFR-SEC-4, S)*
- **Schema migration framework** — versioned migrations decoupled from cold-boot; partition/prune audit tables. *(NFR-MAINT-1, M)*

### P2 — Product completeness
- **Internationalization** — i18n framework + Amharic/Oromo/Tigrinya/Somali locales + language switcher + localized numbers/dates. *(NFR-USE-1, L)*
- **Accessibility to WCAG 2.1 AA** — chart text alternatives, modal focus management, skip links, labelled widgets, theme support. *(NFR-USE-1, M)*
- **Complete the auth lifecycle** — token refresh/silent-renew, first-login "provisioning pending" state, JWKS key-rotation handling. *(FR-SEC-1, M)*
- **Frontend test + delivery** — unit-test layer, SPA CI, code-splitting, remove fabricated-on-empty widgets + runtime CDN. *(NFR-MAINT-2, M)*

### P2 — Requirements coverage
- **Interoperability layer** — OpenHIM mediator, terminology service (SNOMED/ICD/LOINC via OpenConceptLab), OpenHIE registries, FHIR export APIs. *(FR-INT-1/2/3/6, L)*
- **Metadata & MDM** — real data dictionary (NHDD), data catalog with ownership/lineage, MDM registries (MPI + Client + Health-Worker). *(FR-MET-1/3/6, L)*
- **Missing subject areas** — financing/CBHI + mortality/CRVS marts, equity stratification (sex/age/wealth), complete Table 7/8 KPI set. *(BR3/4/5, L)*
- **Enforced data governance** — purpose-of-use binding + consent registry, retention/archival automation (15-yr), column-level masking. *(GOV-5/6, M)*

## Bottom line

This is a real, well-engineered system — not a mock-up. The warehouse is modelled correctly, the marts compute from real pipeline data, the authorization is genuinely fail-closed, and the ML and monitoring are honestly wired — the hard, differentiating half. The remaining work is almost entirely the operational and security engineering that turns a working system into one a Ministry can run at national scale: survive failure (HA/DR), be defensible (MFA, TLS, encryption, secrets, network policy), be self-driving (scheduling, CI/CD, quality gates), and serve everyone (Amharic, accessibility). The P0 tracks are the go-live gate; P1 makes it trustworthy; P2 makes it complete against the full HLR.

---

# Appendix A — Per-subsystem detail

Each section: score, strengths, severity-ranked gaps, and remaining tasks, from a code-level audit.



## Data Platform (DV2.0 + marts) — 3/5
Idiomatic Data Vault 2.0 + dbt marts, marts backed by REAL pipeline-computed data (not seeded), vault correctly insert-only. Advanced pre-production prototype.
## Strengths
- Idiomatic DV2.0 insert-only (35 hubs/14 links/30 sats; ban on unique_key architecturally enforced). Payload/hashdiff single-source macro + alignment checker. SHA-256 keys.
- Real cross-source entity resolution (v_facility_resolution unions 6 feeds, same-as links keys-only, source_system in PK hash to avoid collisions — cited live collision evidence).
- Marts backed by real vault rows; 5 CSV seeds strictly reference/dims. Genuine analytics (EARS outbreak detection mean+2SD, densified ML grid, cascade monotonicity guard, honest 6-source DQ pulse).
- Auto-generated structural test suite (371 refs: not_null/unique/relationships/(hk,load_ts)); rich persisted lineage docs.
## Gaps
- [CRITICAL] Quality gates NOT wired into runtime — vault/entrypoint.py runs dbt run only; gen-vault-tests.py, check-sat-payload-alignment.py, dbt test not invoked → contract defects ship if CI doesn't call them.
- [HIGH] Unsafe hard casts over inference-typed raw layer — 160 naive ::type casts, ZERO try_cast; one non-numeric DHIS2 value errors the whole model build.
- [HIGH] Staging ~untested (1 of 26 models has tests; ethioemr/hcmiswdm/mbrana/climate none); staging does no casting despite docstring claiming it; no relationships/accepted_values.
- [HIGH] No relationships tests anywhere in marts (region_id/commodity_id/indicator_id FKs untested → silent orphans).
- [MEDIUM] No PIT tables, no DV bridge tables, no effectivity sats (v_*_current = latest-row only; no as-of reconstruction; part-of hierarchy can't be end-dated).
- [MEDIUM] Two sats break insert-only contract (sat_dhis2_period_resolved table full-refresh w/ CURRENT_DATE; sat_date_eth_calendar insert-once).
- [MEDIUM] Uneven/cosmetic k-anonymity on public data (k=5 stamped uniformly; guard vacuous for zero_dose/workforce; test covers 4 of 8).
- [MEDIUM] Missing national-HDW domains: no financing/NHA, no mortality/CRVS, equity geography-only (no sex/age/wealth/urban-rural though EthioEMR has gender/birth_date unused).
- [MEDIUM] MFR modelled in vault ahead of ingest (no stg_mfr__*, no raw view).
- [LOW] Two hash regimes; stale docs (README lists 3 of 34 models).
## Remaining tasks
1. (S) Wire dbt test + gen-vault-tests drift check + sat-alignment check into entrypoint/Jobs.
2. (S) try_cast macro on every measure/date cast.
3. (M) Close test gaps (25 staging models + reported_vs_recorded + 4 public marts; relationships tests; k-anon on all 8).
4. (S) Reconcile k-anon (facility-count guard or stop stamping k=5 where vacuous).
5. (M) Real PIT capability (AutomateDV PIT over high-traffic sats + effectivity sats).
6. (M) Harden reproducibility (parameterize as-of date, magic constants → seeds, dedupe CASE blocks).
7. (M) Bring MFR into staging contract.
8. (L) Perf: promote nested view chains + mart_ml_disease_input to tables/incremental.
9. (L) Domain expansion (financing, mortality/CRVS, equity stratification, HIV/TB/MNCH marts).


## Source Ingestion — 3/5

Well-architected dlt ingestor code + REAL product replicas (DHIS2 2.40.4, OpenMRS/MySQL, MSSQL 2025, HAPI FHIR v8), NOT stubs. Only Climate + Fayda are custom stubs; IDSR = DHIS2 weekly surveillance data elements. But operationally: batch-only, no scheduler, no CDC, no DLQ, once-seeded synthetic sources, manifests hardcode row_count=0.

## Strengths
- Real-replica realism (real wire protocols; "swap URL, no code change").
- Contract-stable all-string lake surface; partitioned Parquet + content-hash filenames + _manifest.json sidecars.
- Thoughtful idempotency (replace rewrites prefix; append restores watermark, strict `>`; --full-refresh escape hatch). EthioEMR boundary-row care = senior-level.
- Explicit table allowlists (tables.py = schema-change audit trail).
- Secret hygiene: env-driven, no committed creds, reader-only DB logins with DENY INSERT/UPDATE/DELETE.
- 3x exponential backoff on 5xx; serial-retry pass for host-OOM resilience. Pinned deps.

## Gaps
- [HIGH] No scheduler / no continuous ingestion — runs only as one-shot Jobs from bootstrap; no CronJob/Airflow ingest DAG. DHIS2 README says "hourly" but nothing schedules it.
- [HIGH] No CDC — batch pull only; updates/deletes to rows older than watermark invisible → silent divergence over time.
- [HIGH] No dead-letter / partial-failure isolation — one bad record/table fails the whole Job (backoffLimit:1), no DLQ/quarantine.
- [MEDIUM] Manifests hardcode row_count=0 (all 7 pipelines) yet dq.py surfaces "records last cycle" from them → ingestion-health widget misreports; can't detect silent partial loads.
- [MEDIUM] Incremental state persistence implicit — k8s Jobs mount no PVC/DLT_PIPELINE_DIR; append watermarks rely on dlt's implicit destination-state restore from MinIO (undocumented in k8s path).
- [MEDIUM] Once-seeded synthetic sources never mutate → delta path unproven; Climate cursor=week_start (not mutation time) + append+no-merge → double-count risk.
- [MEDIUM] Weak/default source creds (DHIS2 admin/district over HTTP Basic); MinIO ingestor uses ROOT user not a scoped write key.
- [LOW] Thin tests (one smoke test that bypasses DHIS2; no unit tests for OpenMRS→FHIR reshapers, flatteners, watermark logic).
- [LOW] Containers run as root; no push metrics (Prometheus).

## Remaining tasks (ordered)
1. [S] Populate real row_count in manifests (highest value/effort).
2. [M] Schedule ingestion (CronJob or Airflow DAG), decouple from bootstrap.
3. [M] Make incremental state explicit/durable (PVC DLT_PIPELINE_DIR) + post-run dup-count assertion.
4. [M] Dead-letter lane (_errors/ prefix, raise backoffLimit).
5. [L] Graduate high-cardinality tables to incremental.
6. [M] Real CDC for fact sources (DHIS2 changelog / OpenMRS binlog / MSSQL CDC) or OpenFn.
7. [L] Push metrics + freshness-SLA alerts.
8. [L] Harden (non-root, scoped MinIO key, PAT/OAuth for DHIS2, rotate reader pw).
9. [M] Unit tests for FHIR reshapers + watermark boundary logic.

Caveat: static read only; no live cold-boot/ingest observed.


## API Gateway + Authz — 3/5
Sophisticated fail-closed two-plane authz that enforces correctly on the happy path and defaults to deny; held back by no rate limiting, near-zero PEP tests, a role-source inconsistency feeding OPA, splice-based SQL in fetchers, and DB-exception leakage.
## Strengths
- Two-plane model real + separated (Plane1 visibility resolver DB-authoritative; Plane2 OPA row_filter AND-applied). Both default-deny.
- Fail-closed throughout; boot self-test refuses catalog↔rego drift. Direct-data guard limits raw/ad-hoc SQL to unscoped roles. PAT narrows only; act_as_owner from role_capability. Comprehensive audit. Good Pydantic write validation; SQL Lab well-defended (sqlglot + allowlist + LIMIT + per-table OPA).
## Gaps
- [HIGH] No rate limiting/abuse protection anywhere (per-PAT rate_limit stored, never enforced); anon access-request POST dup-guard by email only; LLM chat unthrottled → DoS/enum/cost-abuse.
- [HIGH] Near-zero automated PEP tests (only 2 shell scripts; no Python tests for JWT/fail-closed/resolver/row_filter/IDOR).
- [MEDIUM/HIGH] OPA fed only user.primary_role ("first R- role in unordered claim"); Plane1 is DB-authoritative but direct mart/SQL endpoints rest solely on OPA(primary_role) → non-deterministic multi-role authz.
- [MEDIUM] Fetchers splice filter values into IN() via manual quote-doubling (escape not param); wildcard-cap dims (geography/programme/commodity) reach it.
- [MEDIUM] DB/Trino exception text returned to clients (schema/engine leak).
- [MEDIUM] api_tokens._has_cap checks user.roles not role_capability (dead admin authz, latent risk).
- [MEDIUM] GATEWAY_DEMO_IMPERSONATION=true in deployed base (non-constant-time secret compare, can assume R-SUPER).
- [MEDIUM] dq.py reads vault_business gated only by view_ops_console capability, bypassing OPA data-plane.
- [LOW] JWT decode echoes token's own alg (pin RS256); sequential enumerable tracking IDs + anon status lookup; /docs enabled.
## Remaining tasks
1. (S/M) Rate limiting (per-IP anon + LLM; enforce per-PAT limit; bot guard on access-request).
2. (M) Feed OPA full DB role set; reconcile two role sources; coarse can-use-SQL gate.
3. (M/L) Python PEP test suite (JWT bad iss/aud/alg/exp, fail-closed, resolver, row_filter, IDOR, PAT narrowing).
4. (S) Param/allowlist fetcher _in_clause values.
5. (S) Stop returning raw exception text (correlation id); disable /docs in prod.
6. (S) Fix _has_cap→role_capability; hmac.compare_digest; pin JWT algorithms.
7. (S) GATEWAY_DEMO_IMPERSONATION=false in prod; randomize tracking IDs.
8. (M) gateway_log retention/prune + OpenTelemetry tracing.


## Dashboards / SPAs — 3/5
Architecturally excellent, genuinely real-data-backed catalog-driven runtime (~50 OPA/Trino-gated mart fetchers, honest empty states, careful async/race handling), past prototype on happy path. Blocked by no i18n, auth-lifecycle gaps, DEV_AUTH=true default on privileged SPAs, no CI/unit tests, chart a11y failing WCAG.
## Strengths
- Real-data wiring standout (~94% widgets real gateway/mart fetch; admin+workshop ZERO synthetic). ~50 sophisticated OPA-gated Trino fetchers.
- Honest empty states (real rows or null→empty, never fabricated) enforced by 57/60 internal-bi widgets.
- Production-grade runtime engine (async re-render guards, scope-hide reflow, two-stage token gate kills 401 noise, single-flight PKCE).
- Real authz at tier boundaries (SPA backends verify JWKS; gateway requires DB grant — no JIT privilege). All 5 personas covered. Reproducible builds.
## Gaps
- [CRITICAL] No i18n whatsoever — no library/locale files; Amharic = 2 decorative strings; hardcoded lang="en". Federal MoH needs Amharic + Oromo/Tigrinya/Somali. From-scratch build.
- [CRITICAL] DEV_AUTH defaults TRUE on admin + workshop (only internal-bi false); a deploy not setting DEV_AUTH=false runs privileged ops dashboard with mock R-OPS-ADM, no real auth. .env.example ships true.
- [HIGH] First-login provisioning race unhandled — new user gets authenticated:true but gateway denies spec until admin grants; terminal SPEC_DENIED, no poll/backoff (ties to #154).
- [HIGH] No token refresh/silent-renew; mid-session expiry breaks silently (widgets empty via 401→null, needs manual reload).
- [HIGH] Charts invisible to assistive tech (echarts canvas, aria off; ~5 aria-labels across 55 widgets) → fails WCAG 2.1 AA.
- [HIGH] Admin breaks offline rule — loads echarts from jsdelivr CDN + Google Fonts at runtime (internal-bi forbids; cluster offline).
- [MEDIUM] Thin tests, not in CI (23 live-cluster Playwright E2E; no unit/vitest; workshop 0, admin 1; no gh workflows).
- [MEDIUM] Public dashboard fallback-heavy (all 4 widgets ship static copy w/ fabricated downloads/doi; masks empty backend).
- [MEDIUM] Two BI widgets fabricate on empty (ov-benchmarks, ov-outbreak-hero DEFAULTS) violating honesty contract; ov-outbreak-hero orphan/dead code.
- [MEDIUM] Monolithic bundles no code-splitting (admin 1.89MB, internal-bi 1.42MB, public 1.27MB).
- [LOW] SPA backends verify_aud=False + no JWKS kid-miss refetch (key rotation locks out until restart); bearer in sessionStorage+window global (XSS); boot-fetch fail → infinite spinner; caret dep drift; TS strict:false; assistant hard-depends external GPU Ollama.
## Remaining tasks
1. (S) Kill DEV_AUTH=true default on admin/workshop + .env.example; fix redirect_uri.
2. (S) Fix admin offline regression (drop jsdelivr echarts, self-host fonts).
3. (M) Complete auth lifecycle (token refresh/silent-renew, exp timer+re-login, first-login provisioning-pending poll, JWKS kid refetch, verify_aud).
4. (L) i18n framework + Amharic/Oromo/Tigrinya/Somali locales + language switcher + localized numbers/dates.
5. (M) Chart+modal a11y (echarts aria/decal, data-table alternatives, modal Escape/focus-trap, skip links, label widgets, prefers-color-scheme).
6. (M) Unit tests (vitest) + wire Playwright+build into CI; cover workshop+admin.
7. (S) Data-honesty cleanups (remove ov-benchmarks/ov-outbreak-hero DEFAULTS, archive orphan, gate public fallbacks behind "not yet published").
8. (M) Bundle hardening (manualChunks/lazy-load, pin deps+Node, .dockerignore, TS strict).


## ML Lifecycle / Data Quality / Observability — 3/5
Unusually real, honestly-built foundation (genuinely trained models + full MLflow registry/drift/retrain loop; real Prometheus/Loki/Alertmanager; rich multi-source DQ) but stops short of production hardening.
## Strengths
- Models REAL, trained, versioned (MLflow registry, @champion/@challenger alias promotion, per-version lineage, pinned reqs, reference profile). Not seeded predictions.
- Genuine closed-loop MLOps (scheduled inference → PSI/KS drift → accuracy scoring → drift-triggered retrain, model-agnostic; onboarding = a model_deployment row).
- DQ surface broad+honest (real per-source metrics, NULL where no signal, cross-source reconciliation from conformed keys, k-anon gate). ~250 dbt tests marts + 374 vault.
- Observability honestly wired (k8s-truth liveness, real gateway RED metrics, Promtail→Loki, alert path proven w/ Watchdog).
## Gaps
- [CRITICAL] The only meaningful SLO alert can never fire — gateway exports nhdw_gateway_requests_total but GatewayHighErrorRate queries http_requests_total (metric-name mismatch). Error-rate alerting silently dead.
- [HIGH] No DQ threshold gating — DQ failures don't gate downstream; HLR completeness/timeliness thresholds reported not enforced; ack workflow advisory.
- [HIGH] Timeliness never computed — timeliness_pct = NULL in every CTE; an entire HLR-mandated DQ dimension absent.
- [HIGH] Drift auto-promotes retrained model straight to @champion, no challenger/shadow/accuracy-compare/human approval/rollback.
- [MEDIUM] Model-validation harness (registry/validators.py) targets a DEAD contract (driver.py/deployment.yaml) — real packages use pyfunc/train.py + predict.py; not imported by any route → sandbox validation effectively doesn't run.
- [MEDIUM] No alerting on ML/DQ health (model_drift/performance/ml_run only in Postgres, not exported).
- [MEDIUM] No SLOs/recording rules (no p95/p99, no error budget/burn-rate).
- [MEDIUM] No dataset versioning (features re-run vs live warehouse; retrain not bit-reproducible).
- [MEDIUM] Grafana NOT deployed; 4_monitoring/ orphaned (violates archive rule).
- [LOW] No HA; Alertmanager emptyDir (state lost on restart), email-only; gateway_log no prune; accuracy tracking mostly inert (needs actuals: block).
## Remaining tasks
1. (S) Fix alert metric name http_requests_total→nhdw_gateway_requests_total; add latency-SLO burn-rate alert.
2. (S) Populate timeliness_pct from real reporting-deadline contracts.
3. (M) Threshold DQ gates (fail build/quarantine partition below HLR thresholds; auto-unpublish public marts on k-anon fail).
4. (M) One model-governance contract; wire validators into promote/graduation as hard gate.
5. (M) Drift retrain → @challenger + accuracy-compare gate + operator approval + rollback.
6. (M) Export ML/DQ status to Prometheus + alerts (failed inference, persistent drift, accuracy regression).
7. (M) Dataset versioning (snapshot/hash feature frame per run, pin to ml_run).
8. (L) Archive 4_monitoring or deploy Grafana properly.
9. (L) Production-harden observability (Alertmanager persistent+HA, on-call escalation, retention, prune job).


## Security & Identity — 2.5/5

Well-architected AUTHORIZATION core (two-plane RBAC+OPA, fail-closed, test-gated policy, row-level scope, least-privilege DB roles) wrapped in demo-grade hardening.

## Strengths
- Fail-closed is REAL + layered: OPA_FAIL_OPEN=false, unreachable OPA→deny, unknown role→deny, uncataloged mart→403, boot self-test refuses catalog↔rego drift.
- Policy CI-gated at deploy: regen-opa-policy.sh runs opa test, refuses to publish failing policy.
- Trust-tier guard: low-trust federated identities denied sensitive verbs + raw PHI even if R-SUPER. Tested.
- Row-level enforcement via user_scope → OPA row_filter AND-applied. Two realms (moh-staff + privileged-ops); admin realm password-only (ensure_no_brokers).
- Least-privilege DB roles; ops_gateway INSERT/SELECT only on audit, ops_writer UPDATE/DELETE REVOKED on audit. PAT sha256, scope narrows only, act_as_owner from DB not token.

## Gaps
- [CRITICAL] No enforced MFA anywhere — CONFIGURE_TOTP optional, setup-keycloak clears requiredActions for every seeded user; only sec.officer gets TOTP as a demo beat. Password login always available. (FR7.3 gap real.)
- [CRITICAL] Self-signed/TLS-optional transport — both realms sslRequired:none; KC_HTTP_ENABLED=true, KC_HOSTNAME_STRICT=false; Traefik default self-signed; no cert-manager/HSTS.
- [HIGH] OpenBao designed but bypassed — secrets are static files, no rotation/lease; 6 rotate-*.sh scripts inert.
- [HIGH] Dev/demo cred paths live in deployed build — GATEWAY_DEMO_IMPERSONATION=true (X-Mock-User/Role channel, non-constant-time secret compare) can assume R-SUPER; GATEWAY_PUBLIC_ANON=true.
- [HIGH] Shared/weak demo creds — single SEED_PASSWORD (NhdwDemo2026.OK) for every seeded user, committed in template default + scenarios.json; two R-SUPER root/superadmin accounts.
- [MEDIUM] Audit append-only-by-grant but NOT tamper-evident (no hash-chain/WORM; DBA can alter; no retention/prune; Loki not fed audit tables).
- [MEDIUM] OPA governs only data-plane; admin surface (perm-admin/access-requests/alerts/dq/workspace) gated by Python capability checks, no rego, opa tests don't cover it.
- [MEDIUM] No consent/data-dictionary/purpose-of-use enforcement — purpose_of_use hardcoded "public-health"; policy checks are no-ops.
- [MEDIUM] Column-masking plumbed (Decision.masked_columns) but NO policy emits it.
- [MEDIUM] R-SUPER blanket wildcard allow bypasses granular policy (only trust guard constrains).
- [LOW] JWT decode echoes token's own alg (should pin RS256); OPA "hot-reload" = rollout-restart; 30-min access-token TTL, no revocation.

## Remaining tasks
1. (M) Enforce MFA both realms (TOTP/WebAuthn REQUIRED, bruteForceProtected, stop clearing requiredActions for privileged).
2. (M) Real TLS: cert-manager+CA, sslRequired:external/all, disable KC_HTTP, KC_HOSTNAME_STRICT=true, HSTS.
3. (L) Deploy OpenBao + External Secrets Operator (dynamic short-TTL creds, wire rotate scripts, revoke root token).
4. (S) Remove dev/demo auth from prod (GATEWAY_DEMO_IMPERSONATION=false, per-user unique passwords, rotate defaults, scope R-SUPER).
5. (M) Tamper-evident audit (hash-chain/sign, WORM sink, retention job).
6. (M) Bring admin surface under OPA + expand opa tests (negative + scope-intersection + capability plane).
7. (M) Real consent/purpose binding + column masking + data-dictionary gate.
8. (S) Session hardening (shorter TTL, refresh rotation, revocation/introspection).


## Storage (Postgres / ClickHouse / MinIO) — 2/5

Excellent relational schema/DDL craftsmanship on a single-replica, no-backup, no-encryption, no-resource-limit deployment. Demo-grade ops posture.

## Implemented
- Postgres single StatefulSet postgres-vault (pg16-alpine, replicas:1, 10Gi local-path) hosts EVERYTHING: nhdw_vault (landing/vault_raw/vault_business/bi_* marts/fhir_resources), nhdw_ops (ops_identity/workspace/governance/export/artifact/audit/perm), + keycloak/airflow/superset/grafana/mlflow DBs. 35 numbered init scripts run only on empty data dir.
- ClickHouse single Deployment (24.3, replicas:1) — staging = all VIEWS over MinIO Parquet (no rows persisted). Marts actually materialize in POSTGRES (not CH — CH README aspirational).
- MinIO single Deployment single-drive server /data (replicas:1). Buckets + 4/7 least-privilege IAM + 2 lifecycle rules (exports-90d, backups-365d).

## Strengths
- Production-quality relational DDL: normalized ops model, correct PK choices, FKs ON DELETE CASCADE, enum CHECKs, timestamptz DEFAULT now(), append-only ops_audit, kc_sub natural-key FK survives realm migration, triggers.
- Strong indexing (FK cols, ts DESC, GIN on arrays, partial/expression unique indexes).
- Textbook RBAC normalization (permission + role_permission M:N, whole-tuple UNIQUE).
- Idempotent ordered dependency-aware init; multi-DB isolation by blast radius; least-privilege roles per workload.
- CH workload isolation via profiles+quotas; credential-free s3() via named collection.

## Gaps
- [CRITICAL] No working backup/DR — only backup.sh is a stale Docker script (docker exec, can't hit k3d pods), wired to NO CronJob; nhdw-backups bucket empty. Node/PVC loss = total data loss.
- [CRITICAL] No encryption at rest, storing PHI — local-path hostPath PVCs, no MinIO SSE/KMS, no PG TDE, k8s Secrets unencrypted in etcd. System holds patient PHI + Fayda FIN.
- [CRITICAL] No PITR/WAL archiving, no HA — stock pg16, no archive_command/wal_level/standby/pooler; replicas:1. One pod = vault+ops+keycloak+airflow+superset+mlflow.
- [HIGH] No CPU/mem requests or limits on ANY storage container → BestEffort QoS, DB first to be OOM-killed.
- [HIGH] Single-instance non-replicated MinIO (single-drive, no erasure) + ClickHouse (no ReplicatedMergeTree/Keeper).
- [HIGH] local-path provisioner (node-local, RWO, no snapshots, no failover).
- [HIGH] No connection pooling — stock max_connections=100 shared by KC/Airflow/Superset/MLflow/Grafana/gateway/dbt.
- [MEDIUM] No migration framework (no Flyway/Liquibase/sqitch, no schema_migrations); live schema change needs manual apply or wipe.
- [MEDIUM] Audit tables (gateway_log/policy_log/data_event) append-only, no partitioning/retention → unbounded bloat.
- [MEDIUM] Incomplete MinIO lifecycle (lake "90d" is prose only, no rule); object-lock/WORM skipped on backups.
- [LOW] fhir_writer hardcoded placeholder LOGIN password never cycled; no intra-cluster TLS (PG/CH/MinIO plaintext).

## Remaining tasks
1. (L) k8s backup/DR CronJob (pg_dump both DBs + mc mirror → nhdw-backups + CH DDL snapshot) + restore-verification Job.
2. (L) Postgres HA+PITR via operator (CloudNativePG/Zalando) — streaming replication, WAL archiving, failover, standby.
3. (M) Encryption at rest+transit (etcd EncryptionConfiguration, MinIO SSE-KMS, encrypted CSI SC, TLS on PG/CH/MinIO).
4. (S) CPU/mem requests+limits on the 3 storage containers (Guaranteed QoS for DB) + tuned postgresql.conf.
5. (M) PgBouncer transaction pooling.
6. (M) Migration framework + schema_migrations ledger decoupled from cold-boot.
7. (M) Distributed MinIO (erasure) + ReplicatedMergeTree if CH persists marts.
8. (S) Partition + retention-prune ops_audit; explicit mc ilm rule for nhdw-lake.
9. (S) MinIO object-lock/WORM on backups; rotate fhir_writer password.


## Infrastructure / Bootstrap / Cold-boot — 2/5

Exceptionally well-engineered DEMO with production-SHAPED discipline (one canonical kustomize bootstrap, idempotent seeding, offline image bundle, honest source-only seeding), but every hard NFR of a national deployment is demo-grade or absent.

## Strengths
- One rigorously-enforced boot path (bundle/scripts/bootstrap.sh); retired "speedy" mode gone; --fast is opt-in cache w/ fallback.
- Genuine idempotency + cold-boot reproducibility (synth-version guards, gen-secrets never rotates live, verify-system.sh gate, race-hardening init containers).
- Offline-first air-gap-friendly (all images as tars, no boot pulls). External images pinned by tag. Probes broad. Cilium CNI + real gateway HPA (1→6).

## Gaps
- [CRITICAL] Zero HA — k3d 1 server/1 agent; replicas:1 on all 25 workloads; Airflow Recreate single-instance; no PDB, no anti-affinity. Any node/pod loss = full outage.
- [CRITICAL] No DR/backup automation — postgres-vault holds EVERYTHING on single 10Gi local-path PVC; no WAL archiving/pg_dump/Velero/restic in manifests.
- [CRITICAL] No network segmentation — NetworkPolicy DISABLED at cluster creation (--disable-network-policy); zero policies; flat open namespace.
- [HIGH] Self-signed TLS, no cert-manager/ACME; hostnames hardcoded to *.127.0.0.1.nip.io across ~8 patches (no BASE_DOMAIN param).
- [HIGH] No CI/CD — no gh workflows/gitlab-ci/Argo/Flux; nothing lints scripts, runs opa test/dbt build/SPA typecheck before baking images.
- [HIGH] Core warehouse-refresh pipeline NOT scheduled — pipeline_refresh DAG ships paused + un-wired; marts only refresh via manual seed-realistic.sh re-run. Scheduled DAGs are ML-only.
- [HIGH] Provisioning is ~3k LOC imperative bash, not declarative IaC (no Terraform/Ansible/kubespray).
- [MEDIUM] Missing resource requests/limits on most workloads (only ~9 limits cluster-wide); postgres/clickhouse/minio/keycloak/opa/mlflow/dashboards have none.
- [MEDIUM] Keycloak runs start-dev (KC_HOSTNAME_STRICT=false, KC_HTTP_ENABLED=true).
- [MEDIUM] Secrets = base64 k8s Secrets; OpenBao in-repo but NOT deployed. No rotation/dynamic secrets.
- [MEDIUM] Image supply chain: no digest pinning, no scanning/signing/SBOM; nhdw images mutable tag + imagePullPolicy:Always.
- [LOW] External deps (sources/Fayda/LLM) in host docker-compose (correct for demo; needs managed equivalents for prod).

## Remaining tasks
1. (L) Real HA cluster (3+ nodes), postgres HA (Patroni/CloudNativePG), replicated CH, distributed MinIO, PDBs, anti-affinity, minReplicas>1.
2. (M) DR: pg_dump/WAL archiving + MinIO replication + Velero + tested restore runbook.
3. (M) CI/CD: gh Actions (bash -n, opa test, dbt build, SPA build, Trivy, cosign) + GitOps.
4. (M) Default-deny NetworkPolicies per tier (Cilium already installed).
5. (M) cert-manager + ACME; parameterize BASE_DOMAIN everywhere.
6. (S/M) Keycloak start --optimized, strict hostname+HTTPS, clustered.
7. (M) Wire + enable pipeline_refresh (Airflow triggers canonical Jobs).
8. (S) Resource requests/limits on all workloads.
9. (M) Deploy OpenBao + External Secrets Operator w/ rotation, or drop from advertised arch; etcd Secret encryption.
10. (S) Digest-pin images + SBOMs.


---

# Appendix B — Extracted requirement register (HLR)

Roadmap phases: P1 centralize raw · P2=MVP · P3 master/metadata · P4 research/multi-org · P5 Data-Vault warehouse+real-time.

## A. FUNCTIONAL
### A1 Ingestion (Table 11 FR1, §6.4)
- FR-ING-1 source connectivity (VPN+internet) P1
- FR-ING-2 multi-method ETL (CDC/SQL/API/scrape) P1
- FR-ING-3 pull AND push (events/webhooks/replication) P1
- FR-ING-4 file deposit FTP/SFTP P1
- FR-ING-5 job scheduling/workflow automation (Airflow/NiFi) P1
- FR-ING-6 transmission consistency checks (no loss/dup/corruption) P1
- FR-ING-7 OpenHIM information-mediator → FHIR, queue, monitor P1
- FR-ING-8 real-time/near-real-time + streaming (Kafka) + log/trigger CDC P5/partial
- FR-ING-9 hard business rules before staging (DV2.0) P1
- FR-ING-10 ingestion encryption/de-id, SSL in transit P1
- FR-ING-11 upload tool for offline sources P1
### A2 Storage/DV2.0 (Table 11 FR2, §6.5, §2.7.4)
- FR-STO-1 central structured+unstructured store P1
- FR-STO-2 data lake raw/native staging→processed→archived P1
- FR-STO-3 lake↔warehouse integration P2/P5
- FR-STO-4 real-time processing store (time-series db) P5
- FR-STO-5 Data Vault 2.0 (Hubs/Links/Sats, 3-tier, metadata-driven, raw/rules separation) P5
- FR-STO-6 dimensional star-schema marts P2(MVP)
- FR-STO-7 data archiving + governance P3
- FR-STO-8 lakehouse interactive query all types (Presto/Drill) P4/P5
- FR-STO-9 warehouse tech (Postgres/Hive/ClickHouse) P2/P5
### A3 Data Quality (Table 11 FR5.4, §6.7.2)
- FR-DQ-1 DQ mgmt TQM (profiling/cleansing/validation) P3
- FR-DQ-2 data profiling every source → data map P1-P3
- FR-DQ-3 validation vs facility numbers + anomaly detect/remediate P2
- FR-DQ-4 dedup/golden-copy P3
- FR-DQ-5 DQ metrics accuracy/completeness/timeliness/consistency P3
- FR-DQ-6 referential integrity + consistency checks P2
### A4 BI/Dashboards (Table 11 FR4, §6.6)
- FR-BI-1 role-relevant customisable dashboards P2
- FR-BI-2 real-time visualisation (outbreak) P2/P5
- FR-BI-3 interactive drill-down/filter P2
- FR-BI-4 trend analysis + forecasting P2/P4
- FR-BI-5 geospatial analysis P2/P4
- FR-BI-6 querying/OLAP/self-service P2
- FR-BI-7 analyst notebooks (Jupyter/Superset/Metabase) P4
- FR-BI-8 secure API endpoints external consumption P4/P5
### A5 ML (Table 11 FR3, §6.6.1)
- FR-ML-1 access diverse lake data for training P4
- FR-ML-2 preprocessing/feature engineering P4
- FR-ML-3 data mining/exploration P4
- FR-ML-4 model dev+deploy (TF/PyTorch/sklearn); disease prediction/risk/resource opt P4
- FR-ML-5 prediction/forecasting P4
- FR-ML-6 MLOps (versioning/eval/CI-CD) P4
- FR-ML-7 ethical AI controls P4
- FR-ML-8 anomaly detection operational P3
- FR-ML-9 ETL pipelines feed analytics P2
### A6 Security/Access (Table 11 FR7, §6.9)
- FR-SEC-1 centralised user mgmt (provision/deprovision) P1
- FR-SEC-2 RBAC P1
- FR-SEC-3 authn+authz incl MFA P1
- FR-SEC-4 audit logging/accountability P1
- FR-SEC-5 secure data sharing P4
- FR-SEC-6 fine+coarse access + patient-consent gating P4
- FR-SEC-7 producer/consumer access matrix + org workspaces P4/P5
- FR-SEC-8 de-identify before lake/warehouse (PII in staging) P1
- FR-SEC-9 IAM/SSO (Keycloak) P1
### A7 Interoperability (§6.4.4, §6.7.1, §3.2.4)
- FR-INT-1 HL7 FHIR support P1
- FR-INT-2 terminology SNOMED/ICD-10-11/LOINC/CPT/NDC/CIEL P3
- FR-INT-3 terminology service (OpenConceptLab) + NHDD P3
- FR-INT-4 transport FTP/HL7v2-MLLP/FHIR/ADX P1
- FR-INT-5 comprehensive API support P1
- FR-INT-6 OpenHIE-aligned architecture P3
- FR-INT-7 interoperability testing/validation P3
- FR-INT-8 ISO22220/GS1/OMOP later
### A8 Metadata/Catalog (Table 11 FR5, §6.7.2)
- FR-MET-1 data dictionary P3
- FR-MET-2 data lineage P3
- FR-MET-3 data catalog (assets+metadata+ownership+access) P3
- FR-MET-4 business-rules docs P3
- FR-MET-5 metadata tooling (Atlas/DataHub/OpenMetadata) P3
- FR-MET-6 MDM registries (Client/MFR/MPI+Fayda/iHRIS/OCL) golden source P3
### A9 Public/Open-data (§2.2)
- FR-PUB-1 public dashboards + citizen own-records later
- FR-PUB-2 transparency + feedback/accountability later
- FR-PUB-3 open data/standards/source cross-cutting
### A10 Ops/Monitoring (Table 11 FR6, §6.8)
- FR-OPS-1 infra monitoring (cpu/mem/disk/net/power) P1
- FR-OPS-2 app monitoring (perf/errors/uptime) P1
- FR-OPS-3 centralised log mgmt P1
- FR-OPS-4 alerting (email/SMS/incident) P1
- FR-OPS-5 performance reporting/capacity planning P1
- FR-OPS-6 secure access of monitoring data P1
- FR-OPS-7 cost-efficiency mgmt later
- FR-OPS-8 data governance enforcement P3

## B. NON-FUNCTIONAL (Table 12, §5.2, Ch7-8)
Security: NFR-SEC-1 encryption at rest+transit · SEC-2 RBAC · SEC-3 audit+compliance · SEC-4 incident response · SEC-5 MFA · SEC-6 data masking · SEC-7 periodic security audits · SEC-8 breach notification
Perf/Scale: PERF-1 response time · PERF-2 throughput · SCAL-1 horizontal · SCAL-2 vertical · SCAL-3 elasticity · PERF-3 query optimisation/load-test · EFF-1 resource util · EFF-2 cost
Availability: AVAIL-1 HA+failover · AVAIL-2 DR+backup+test · AVAIL-3 reliability · AVAIL-4 backup/recovery windows · AVAIL-5 Tier-II 99.741% + ISO27001 + RAID
Interop: INT-1 standards compliance · INT-2 API · INT-3 multi-format integration
Governance: GOV-1 GDPR/HIPAA + Ethiopian law · GOV-2 governance policies · GOV-3 Ethiopian legal (Personal Data Protection Proc 1321/2024 etc) · GOV-4 privacy/de-id/anonymisation + re-id risk · GOV-5 patient consent · GOV-6 retention min 15yr no longitudinal gaps · GOV-7 ownership/stewardship/FAIR · GOV-8 governance metrics+audits
Usability: USE-1 intuitive UI · USE-2 documentation (full list §2.3) · USE-3 training
Maintainability: MAINT-1 modularity · MAINT-2 automated testing (ETL+regression) · MAINT-3 proactive monitoring · FLEX-1 configurability · FLEX-2 customizability · MAINT-4 e2e+UAT testing
DQ: NFR-DQ-1 accuracy · DQ-2 consistency · DQ-3 completeness
Audit: AUD-1 comprehensive logging · AUD-2 audit trail all access/mods
Localization: LOC-1 Ethiopian calendar/fiscal-year · LOC-2 rates over counts · LOC-3 National ID/Fayda 12-digit
Infra quantities: INFRA-1 1500 vCPU/2TB RAM/2PB/20 GPU (phased) · INFRA-2 power headroom, PUE 1.2-2.0 · INFRA-3 elastic private cloud

## C. MVP KPIs
Table7 Malaria (10): suspected cases; tested-microscopy; tested-RDT; test positivity rate; confirmed cases; confirmed rate/1000 PY; inpatient deaths; % infection; % at-risk covered by ITN; % ≥1 IRS round 12mo. Dims: time monthly, location facility/district/region, test-type. Rules: retain ≥15yr, encrypt, validate vs facility numbers, anomaly on outliers.
Table8 Service Delivery (16): contraceptive acceptors; ANC visits; skilled birth attendants; C/S; postnatal care; still/live births; zero-dose children; fully immunised; nutrition screened; HIV+; newly on ART; virally suppressed; MDR-TB; TB treatment completed; RDT+; infant death rate. Dims: patient/location/sex/facility-type/provider/service-type. Outputs: mart, KPI report, viz, query tools, API, OLAP cube, secured access. Rules: Ethiopian fiscal/HMIS calendar, rates over counts.
Subject areas (WHO blocks): service delivery, HR, governance/regulatory, finance/CBHI, medical products/labs, HIS/surveillance. BR1-6 use cases incl. financing/CBHI (BR5) + workforce (BR3) + supply chain (BR4).

## D. SOURCES (83 identified; DHIS2+eCHIS ~70%)
Core: eCHIS, DHIS2 (30192 facilities, 1B recs), EMR (PulseCare/Bahmni/SmartCare), UNISE, iHRIS, supply(Vitas/Dagu-eAPTS/MEMiS/mBrana/Fanos/NSC/QAT/GS1), MFR, LIS(Polytech/LDM/LabXpert), AACAHB HIV repo, HIV NDR, DHPI, ART/TB-Tracker/Simple/CBS/VL/RIS/regulatory/financing(IBEX/NHA/CBHI).
External(9): CSA/statistics, EIAR agriculture, MoE education, OSU animal-health, AAU cancer registry, NIA/Fayda, EMI climate, AHRI biomedical, SSGI geospatial.
Transmission: HealthNet VPN/SD1/internet; push+pull; batch/API/FTP/replication/offline-upload.

## E. PERSONAS (9)
Stakeholders; Administrators(high); Data Providers(high); Healthcare Providers(high, patient records); Data Analysts(mod-high); Researchers(mod-high); Policy Makers(mod, summary); IT/Data-Mgmt Staff(high, backend); General Public+Patients(low, own records + public dashboards).

## F. DQ THRESHOLDS
DQT-1 completeness eCHIS~70%/DHIS2~90%/HR+MFR~60% · DQT-2 uniqueness >90% large sources · DQT-3 MFR ~80% populated · DQT-4 PII 79% · DQT-5 >60% (near-)real-time · DQT-6 volumes (DHIS2 1B, eCHIS 2TB, 30192 fac) · DQT-7 45% individual/22% aggregate · DQT-8 19 API/16 none · DQT-9 retain min 15yr · DQT-10 dims accuracy/completeness/integration/timeliness/consistency/granularity/security/dedup · DQT-12 validate vs facility numbers + referential integrity · DQT-13 monthly review + DHIS2 audits · DQT-14 governance-set accuracy/completeness/consistency/timeliness metrics · DQT-15 TQM

## KEY FRAMING
- HLR does NOT tag reqs MVP individually; MVP = Roadmap Phase 2 (operationalize narrow use cases). Table7/8 are the two TWG MVP example use cases.
- EOI = EMR facility-deployment prequalification tender, NOT a DW spec (no DW FR/NFR/KPI/DV modelling). Only weak DW-adjacent themes (standards/interop, migration/cleaning/validation, secure infra). Do NOT score NHDW against EOI.
