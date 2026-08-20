# QAT integration plan — supply-chain quantification for NHDW

> **Status: PARKED (design only, not yet implemented).** This captures the analysis and
> decision for integrating the capabilities of **QAT (Quantification Analytics Tool)** into
> NHDW. Revisit when the deployment-hardening epic (`docs/production-deployment-plan.md`) is
> in a good state. Source material: the `qat-full-stack.zip` evaluation bundle (gitignored)
> + a verified deep-research pass on the open-source landscape (2026-07).

## 1. What QAT is
QAT is the modern, open-source, country-led **quantification / forecasting + supply-planning**
tool from the USAID GHSC-PSM / Global Fund ecosystem (Apache-2.0, steward Chemonics; a
certified Digital Public Good; actively maintained — last push 2026-07-23, ~14k commits; used
at Ethiopia's EPSS/MoH). Stack: React 16 UI + Spring Boot 3 / Java 17 API + MySQL 8 (business
logic largely in ~105 stored procedures). It is the official successor to the legacy PipeLine
(JSI, supply planning) and Quantimed (MSH, forecasting) tools.

## 2. Tool recommendation (research-backed)
**For the quantification/forecasting capability, QAT is the right open-source choice — no
better OSS option exists for that layer.** The key insight is a *layer taxonomy*: the other
tools are complementary layers, not substitutes.

| Layer | Tools | For NHDW |
|---|---|---|
| **Quantification / forecasting** (need estimation + supply planning) | **QAT** ✅ · Quantimed, PipeLine (QAT's own *dormant* predecessors) | The gap to fill. QAT owns it. |
| **LMIS / inventory / warehouse** | HCMIS (*already ingested*), OpenLMIS v3 (AGPL-3.0), Open mSupply (⚠️ *source-available, not OSI-open* — field-of-use AGPL) | Already covered by HCMIS; supplies QAT's *inputs*. |
| **Aggregate stock reporting** | DHIS2 stock modules (*already ingested*) | Reporting, not quantification. |

Caveats from the research: QAT advertises API + CSV/JSON export but **no direct DB/CDC**;
Ethiopia-deployment evidence is a single promotional source (production-vs-pilot unproven);
OpenBoxes / eLMIS / Logistimo / DHIS2-stock were not fully adjudicated (none surfaced as a
quantification competitor).

## 3. Capability decomposition (the load-bearing finding)
Reading QAT's actual engine (`07-engine-map.md` in the bundle) shows QAT is **two separable
capabilities**, and its "engine" is deterministic arithmetic — not statistics:

1. **Forecasting / quantification** — predict consumption/need per commodity. QAT uses
   ARIMA + Triple-Exponential-Smoothing in MySQL stored procs (+ a morbidity "mod2" module).
2. **Supply planning** — a monthly stock roll-forward: `opening balance → +shipments
   −consumption(actual|forecast) → FEFO/LEFO batch expiry → closing balance`, then **AMC,
   Months-of-Stock, Min/Max stock (guardrails + reorder freq), unmet demand, pipeline
   reconciliation**. Row-by-row Java over SQL result sets — deterministic.

These map onto the two homes NHDW already has — and NHDW already does *partial* versions of #2
(`mart_supply_stockout_forecast` computes AMC-12 + projected days-of-stock; `mart_resource_allocation`
does AMC/MOS).

## 4. Decision: migrate the functionality, don't host QAT as-is
Weighed both options:

| | Keep QAT as-is (host app + ingest its MySQL) | **Migrate functionality (dbt marts + ML lifecycle)** ✅ |
|---|---|---|
| Fidelity | ✅ exact certified tool | ⚠️ you own correctness (engine map is a full spec) |
| Stack fit | ❌ adds MySQL + JVM + React foreign runtime | ✅ native Postgres/ClickHouse + dbt + Python |
| Forecasting | ❌ 2010-era ARIMA/TES stored procs | ✅ **proper ML** (Prophet/GBM) + existing backtest/drift |
| Data flow | ❌ circular (push HCMIS into QAT, extract back) | ✅ feed real HCMIS/DHIS2 straight in |
| Getting it working | ❌ their own PRODUCTION-PLAN is multi-phase; 90 missing tables, broken commit path, MySQL 8.0 EOL | ✅ extends existing `bi_supply` marts |
| Authz | ❌ QAT's own auth to reconcile | ✅ flows through OPA/`mart_attrs`/role-grants |

**Verdict: reimplement QAT's capabilities natively (Option B)**, using QAT as the **reference
specification + validation oracle** (its engine map + data dictionary tell you the right AMC
windows, MOS, Min/Max, FEFO logic; spin the real QAT app in a sandbox to check numbers against
the acceptance harness). Keep-as-is only wins if the goal is to give EPSS staff QAT's
interactive *workbench* in-platform, or if exact fidelity to the certified tool is a hard
procurement requirement.

## 5. Native integration blueprint
- **A · Forecasting → ML lifecycle:** new forecasting models (consumption-based first,
  morbidity-based later) as workshop projects producing `ml_predictions`, with backtest/drift.
- **B · Supply planning → dbt marts:** a monthly supply-plan mart (`bi_supply.mart_qat_*`)
  implementing the engine-map math, reading the forecast (A) + HCMIS stock/shipments. Grow
  `mart_supply_stockout_forecast`.
- **C · Surface → Resource Management page** via the standard per-widget wiring (`fetchers.py`
  + `mart_attrs.yaml` + catalog + `role_grants` + OPA `role_r_*.rego`).

## 6. Open questions to resolve before building
1. Is EPSS's QAT real production or a pilot? (If national-production, ingesting *its* outputs
   as a data source could beat standing up forecasting ourselves.)
2. Does the demo need the interactive *workbench*, or is analytics enough? (Only thing pushing
   toward hosting QAT.)
3. DHIS2's own stock module as an input path — quick follow-up (DHIS2 already ingested).
