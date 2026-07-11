# NHDW · Architecture diagrams

Seven-page draw.io file covering every component, connection, and
workflow in the system. Open
[`nhdw-architecture.drawio`](nhdw-architecture.drawio) in any draw.io
client (web at https://app.diagrams.net, or the VS Code Draw.io
extension).

| # | Page | What it shows |
|---|------|---------------|
| 1 | **System Overview** | All 7 tiers (Users · Access · Identity · Orchestrator · Processing · Storage · Sources) with every cross-tier flow. The big picture. |
| 2 | **Identity & Token Exchange** | OIDC sign-in step-by-step + OpenBao JWT-keycloak swap → short-TTL Postgres credential. |
| 3 | **Data Pipeline** | Source replicas → staging (ClickHouse + MinIO) → vault (Postgres schemas) → marts (`bi_*`) → consumers. Includes consent_extract feeding the consent gate. |
| 4 | **Submission Flow** | submit.dev → Submission Portal → OpenHIM channel → FHIR mediator → HAPI → `fhir_resources`. 12-step sequence with response relay. |
| 5 | **Internal BI Request Lifecycle** | The manifest-driven model: registry → resolver → OPA decision → per-component data fetch via the source-handler registry. Two OPA checks (defense in depth). |
| 6 | **Audit & Monitoring** | 8 components push FHIR `AuditEvent` to Loki; Prometheus scrapes 3 sources; Grafana queries both. Audit-event-timeline component on Internal BI's Governance page tails the same stream. |
| 7 | **ML Pipeline** | Training (sklearn) → MLflow tracking + registry → MinIO artifacts → ML Serving → /predict. Includes the stage-transition path triggered by `ml_promote_to_staging` DAG. |

## Reading conventions

- **Blue solid arrows** — sync request/RPC (HTTP, OIDC, OPA decide)
- **Green thick arrows** — data flow (reads/writes against storage)
- **Red dashed arrows** — credential or token mint (OpenBao, Keycloak)
- **Gold dashed arrows** — audit event (Loki push, Prometheus scrape)
- **Gray faint arrows** — orchestration / lifecycle (Airflow triggers, manifest dispatch)

Every diagram has a legend block in its corner.

## Regenerating

The XML is generated from
[`_build.py`](_build.py). Edit the Python (it's where the
node coordinates and edge routing live) and re-run:

```bash
python3 docs/diagrams/_build.py
```

The script places every node on a grid and declares explicit
exit/entry points on each edge so draw.io's orthogonal router doesn't
push lines through boxes.
