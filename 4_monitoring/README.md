# `4_monitoring/` — Grafana (datasources + dashboards)

> **Moved 2026-07-06 (#81).** Prometheus, Loki and Promtail are now first-class
> Kubernetes manifests under `1_infrastructure/k8s/base/observability/`
> (Prometheus + Loki + Alertmanager + Promtail), wired into the base
> kustomization — see `docs/observability-integration.md`. The compose-era
> `prometheus/` and `loki/` configs that used to live here were archived to
> `_archive/2026-07-06/monitoring-compose-era/`. Only the **Grafana**
> provisioning + dashboards remain in this folder, pending Grafana's own k8s
> manifest in the operator-tools / SSO workstream. Grafana's datasources
> (`prometheus:9090`, `loki:3100`) resolve to the new k8s Services unchanged.

## What lives here now

| Component   | Port (127.0.0.1) | Source of truth                                     |
|-------------|-----------------:|-----------------------------------------------------|
| Grafana     | 3000             | `grafana/provisioning/` + `grafana/dashboards/`     |

The Prometheus (`:9090`) and Loki (`:3100`) that Grafana reads are the
in-cluster k8s Services from the #81 observability stack.

## Provisioned dashboard

- **Audit Events** (`grafana/dashboards/audit-events.json`)
  - AuditEvents-per-minute by `app`
  - Stat tiles: events in window, distinct users, apps emitting
  - Recent raw events stream

This is the dashboard called out in `docs/implementation-plan.md` as the
Phase-2 exit criterion ("Grafana dashboard for *audit events per minute*
is reachable from the Ops Hub").

## Scrape targets

Prometheus' scrape config now lives in the k8s ConfigMap inside
`1_infrastructure/k8s/base/observability/prometheus.yaml` (was
`prometheus/prometheus.yml`, archived). Current jobs + which expose `/metrics`
today vs. remaining `/metrics` gaps are documented in
`docs/observability-integration.md`.

## Bring-up

The observability plane comes up with the normal k8s bootstrap
(`bundle/scripts/bootstrap.sh`) — it is part of the base kustomization. Grafana
itself is not yet a k8s manifest (this folder is its provisioning source until
that lands). There is no longer a `docker compose` path here (Kubernetes-only).

## Status

- **Alertmanager** — now shipped by #81 (`observability/alertmanager.yaml`),
  routed to the external Google SMTP relay (`smtp-secrets`), the same centralised
  mail path the gateway app mailer uses (Mailpit retired 2026-07-06).
- **OIDC for Grafana** — uses `privileged-ops` realm; part of the operator-tools
  / SSO workstream (with the future Grafana k8s manifest).
- **Postgres / OpenBao exporters** — still deferred; add as sidecars + a
  `prometheus.io/scrape` annotation and the generic `kubernetes-pods` job picks
  them up with no Prometheus config change.
