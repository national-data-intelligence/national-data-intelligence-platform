# Architecture

The system is a straight line from operational source systems to governed
analytics, with a single gateway in the middle that every read passes through.

## The path data takes

Raw data originates in replicas of the systems the Ministry runs in production.
Each one is a real instance of the real software, seeded to a demoable state:

- **DHIS2** — aggregate HMIS reporting and IDSR disease surveillance.
- **EthioEMR** — an OpenMRS-based electronic medical record.
- **HCMIS-WDM** — the health commodity and supply-chain system (SQL Server).
- **mBrana** — a community/USSD reporting channel.
- **MFR** — the Master Facility Registry, exposed over FHIR.
- **Climate** — a weather/climate feed used for outbreak signals.

Ingestors read from those sources and land the data, untyped, in a SeaweedFS (S3-compatible) object
lake. From there ClickHouse stages it, a bridge moves it into Postgres, and a dbt
project builds two layers: a Data Vault (hubs, links, satellites) that keeps an
insert-only history, and a set of `bi_*` marts that are the serving layer the
dashboards read. Typing and business logic happen in the warehouse, not at the
edge — the raw surface is deliberately all-string, the way a real ingestion tool
would leave it.

The gateway is the only door to the marts. Dashboards never touch Postgres
directly; they call the gateway, which resolves the caller's identity, asks OPA
whether the read is allowed, applies the row filter, and returns the result. That
is what makes access control uniform: one policy engine, one enforcement point.

## Running on Kubernetes

Everything except the source replicas runs as Kubernetes workloads. The source
systems run as separate Docker Compose stacks and are reached from inside the
cluster over `host.k3d.internal`; keeping them outside the cluster mirrors the
real world, where sources are systems the warehouse ingests from rather than owns.

The cluster is k3d (k3s in Docker) locally, and the same manifests target a cloud
cluster with only the hostnames changing. The network layer is Cilium, which also
feeds the live topology view in the admin console. Traefik terminates TLS and
routes the `*.127.0.0.1.nip.io` hosts to the services.

## The pieces

- **Storage** — Postgres (the warehouse and the operational databases),
  ClickHouse (staging), SeaweedFS (the lake and an artifact store), and Trino as a
  federating query engine over them.
- **Pipeline** — the per-source ingestors, the three dbt projects, and the
  ClickHouse-to-Postgres bridge.
- **Gateway** — a FastAPI service that serves the marts, runs the OPA checks,
  issues exports, and backs the dashboards and the assistant.
- **Identity** — Keycloak for authentication (staff and privileged-operator
  realms, plus a mock Fayda citizen identity provider) and OPA for authorization.
- **Access points** — the five dashboards and the analyst tools.

## How access control works

Authorization has two independent jobs. The gateway decides *which rows* a caller
may read: OPA takes the subject, the data class, the granularity and the verb,
and returns an allow/deny plus a row filter scoped to the caller's geography and
programme. Separately, a visibility layer decides *which widgets and pages* a role
sees at all, so a dashboard never renders a panel a role has no data for. The two
are kept consistent — a granted widget always has data behind it, and a denied
read is denied at the gateway regardless of what the UI shows.

Every external tool a dashboard links to (dbt docs, Airflow, Superset, MLflow and
the rest) is reached through Keycloak single sign-on and gated by role, either by
the tool's own OIDC or by a small reverse proxy that enforces the role before
proxying. See `docs/security.md` for the full model.
