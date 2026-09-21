# Data, dashboards and machine learning

## The warehouse

The serving layer is a set of `bi_*` marts in Postgres, built by dbt from a Data
Vault that sits over the raw landed data. The marts are organised by subject —
programme cascades (HIV, TB, malaria and others), HMIS service indicators, IDSR
outbreak signals, supply and stock, facility readiness, data quality — and each
carries the geography and programme keys the access control filters on.

`data-dictionary.md` is the generated catalogue of every element the warehouse
carries: programmes, HMIS indicators with their calculation and denominator,
supply commodities and the services they enable, the outbreak-response map, hubs
and catchments, regions, and every mart with its description. It is generated from
the entity model and the dbt schema files, so it stays in step with what the
system actually serves rather than drifting into a hand-maintained list.

## Reference data and master data

Two governed layers decide what things ARE across sources.

**Reference vocabulary (`nhdw_ref`)** — an OMOP-style concept store (concepts,
crosswalks, bitemporal validity) built from the entity model plus curated
supplements (`bundle/seeds/ref-vocab/`). The vault's resolution views join the
crosswalk instead of carrying regex/CASE mappings in code, so a mapping change
is a data edit, not a model edit. Concept identity is stable across rebuilds
(an append-only committed registry assigns ids).

**Master data (MDM)** — a matcher (`2_pipelines/mdm`, a side-lane Job after the
marts build) proposes same-entity candidates with scores and evidence: exact
normalised-name twins across sources, ambiguous names with a geo/admin-area
tie-break, and trigram near-names. It never merges anything. A steward works
the queue in the admin console (MDM Stewardship); every verdict lands in an
append-only, bitemporal decision log that the vault build reads — accept re-keys
the source record onto its master on the next pipeline run, revert supersedes
and falls back to the deterministic derivation, and an empty log leaves every
conformed key byte-identical. Facility masters are conformed hub entities;
commodity masters are vocabulary concepts (an exact-name commodity conforms
implicitly because the concept code IS the normalised name). Downstream, the
facility dimension and marts carry `master_entity_uid` (a stable UUID derived
from the conformed key) and `mdm_state` (`conformed` vs `single_source`) so
consumers can see and filter conformance provenance.

## The dashboards

Five surfaces sit on the gateway:

- **Public portal** — open data, articles and headline indicators, no login.
- **Internal BI** — the analyst console: programme and service dashboards driven
  by a widget catalogue, with filters (region, programme, period) that reshape
  every panel, plus an assistant that answers questions against the marts.
- **Admin and operations** — users and access, roles and permissions,
  data-quality and lineage, the live health-and-topology view, and the operator
  tool launchers.
- **Community workshop** — the space for researchers and community
  contributors: datasets, models, projects, a JupyterLab sandbox, and a review
  path for graduating community work.
- **Operator control room** — a host-run cockpit for bringing the system up and
  watching it.

The dashboards are catalogue-driven: a page is a set of widgets, each widget
declares the mart it reads, and the gateway serves that read under OPA. Adding or
changing a panel is a catalogue change, not bespoke code per dashboard.

## Machine learning

The ML layer follows a lightweight, reproducible pattern. Each model is a small
package — training code, a feature spec, parameters — that trains against the
marts and registers to MLflow, where a champion alias marks the version in
service. Batch inference runs as short-lived Kubernetes jobs orchestrated by
Airflow, writing predictions back for the dashboards to read. The models cover the
kinds of question the surveillance and supply stories need: outbreak and
early-warning signals, seasonal and stockout forecasting, and a couple of
community-contributed models that graduate through the workshop's review path.

The internal BI assistant is wired to the same gateway and the same access rules,
so a question it answers is bounded by the asker's role exactly as a dashboard
read would be. It reads the widget catalogue and the live page to ground its
answers in what the user can actually see.

### Standard practice for every model (binding)

Every model package (`bundle/seed-pack/app/ml/<name>/`) follows the same lifecycle,
whoever builds it. The layers already exist; a model is not done until it uses all
of them.

1. **Exploratory analysis and census** — `eda/` in the package holds the reproducible
   queries behind the modelling choices: the target population, what is excluded
   and why, demand/series classes, missingness and censoring. Nothing is decided on a
   notebook that is not committed as a query or script.
2. **Target and features** — `feature_spec.yaml` names every column explicitly (never
   `SELECT *`) and reads a governed mart. The target is defined once (for PCT: the
   `adjusted_demand` of `mart_pct_demand_month`). Every feature is available at the
   forecast's `as_of` date — a leakage test in `tests/` proves it.
3. **Evaluation before promotion** — a rolling-origin fold ledger with an untouched
   final holdout, predeclared baselines, and a predeclared promotion rule. Metrics
   are chosen for the data: no MAPE on series with zeros, no seasonal comparator
   without a prior season.
4. **Tracking** — every training run logs its parameters, metrics (per fold,
   holdout and segment), feature-query hash and artifacts **inside the MLflow run**,
   and registers a version. A metric that exists only in job output does not exist.
5. **Uncertainty** — quantiles come from a stated method with nominal coverage that
   is checked on the holdout; intervals are never relabelled.
6. **Serving** — batch inference by the Airflow batch DAG into `ops_ml`, contract
   keys in `attrs` (the shared prediction schema stays stable), and a governed mart
   that the dashboards read — dashboards never read `ops_ml` for a product surface.
7. **Monitoring** — an `actuals` block in the manifest so the performance scorer can
   compare predictions with what happened; drift checks on the inputs. Surfaces say
   "backtest performance" until live actuals exist.
8. **Promotion and audit** — promotion by the gateway's promote route (MLflow alias +
   audit event), only when the predeclared rule passes; the model card states the
   evidence.
9. **Delivery** — package changes reach the cluster through `seed-ml.sh`
   (`--retrain` when a champion already exists); the runner and packages are not yet
   rebuilt by CI, which is a known platform gap.
10. **Model card** — purpose, data, target, exclusions, method, evaluation, limits and
    owner, kept current with the code.

The PCT forecast contract (`docs/pct-forecast-contract.md`) is this practice applied
to supply-chain demand forecasting.
