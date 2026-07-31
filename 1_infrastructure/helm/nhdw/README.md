# NHDW Helm chart

Packages NHDW as a Helm chart so that **single-node vs fleet is a values choice**, replacing the
kustomize base + dev overlay as the declarative deployment definition. See
`docs/production-deployment-plan.md`.

## Status — P3.1 conversion + P3.3 parity
- ✅ Chart skeleton + values schema + topology profiles (`values-single.yaml` / `values-fleet.yaml`).
- ✅ Image helper `nhdw.image` — `image.repository` + `image.tag` as values (the P2.1 knob).
- ✅ **All base + observability workloads converted** — dashboards (internal-bi/admin/workshop/public),
  gateway (+RBAC +HPA), postgres-vault, minio, clickhouse, trino, opa, keycloak (+seed job), mlflow,
  superset, dbt-docs, tool-gates, jupyterhub, airflow, headlamp, prometheus/alertmanager/loki/promtail,
  the ingress, and the namespace.
- ✅ **Parity-verified** against `kustomize build overlays/dev`: every workload/Service/RBAC/HPA/Ingress
  the chart renders is byte-identical to the overlay output (deep structural diff, `helm template` vs
  `kustomize build`). The only kustomize objects the chart does NOT render are the deploy-role
  dependencies below — by design.

## Deploy
```
helm template  nhdw . -f values-single.yaml                        # render + eyeball
helm lint .
helm upgrade --install nhdw . -n nhdw -f values-single.yaml        # single-node
helm upgrade --install nhdw . -n nhdw -f values-fleet.yaml         # fleet
```
The chart renders the **final, overlay-applied** form parameterized by values: image refs via
`image.*`, hostnames via `hostBase` / `keycloak.*` / `fayda.*`, storage via `storageClass`,
replicas/resources via `components.<name>.*`. Env-var order matches the kustomize strategic-merge
result (the overlay *prepends* patched vars), so the two renderers stay byte-identical.

## Deploy-role dependencies (obstacle #2, resolved)

Helm's `.Files.Get` is chart-relative and cannot reach the kustomize `configMapGenerator` inputs that
live outside the chart (`../../../bundle/seed-pack/…`, `7_security/…`, `3_storage/…`). Rather than
duplicate those files into the chart, the chart references them **by name** and the Ansible **deploy
role (P4.2) creates them as a pre-step** from their canonical source. `disableNameSuffixHash: true`
in the base means these names are stable (no hash), so name references are safe.

**ConfigMaps the deploy role must create (from external files) before `helm upgrade`:**

| ConfigMap | Source |
|---|---|
| `postgres-vault-init` | `3_storage/postgres/init/*` |
| `opa-policies` | `7_security/opa/policies/*.rego` |
| `keycloak-realm-configs` | `7_security/keycloak/realm-configs/*.json` |
| `keycloak-seed-script` | `7_security/keycloak/scripts/setup-keycloak.py` |
| `keycloak-users-seed` | `bundle/seed-pack/app/security/users.yaml` |
| `clickhouse-users-d` | `3_storage/clickhouse/config/users.d/*.xml` |
| `workspace-profiles` | `6_access-points/jupyterhub/profiles.yaml` |

**Inline** configMaps (defined directly in a manifest, no external-file dependency) travel WITH the
chart and are templated verbatim (only `metadata.namespace` parameterized): `opa-config`,
`trino-catalog`, `trino-etc`, `prometheus-config`, `loki-config`, `promtail-config`. Alertmanager has
no configMap — it renders its config at runtime via an initContainer into an emptyDir.

**Secrets** stay external too — the deploy role creates them from `overlays/dev/secrets.yaml`
(dev; `changeme-*` placeholders committed) or a real secret store (prod). Real material is never
committed. Names the workloads expect: `keycloak-secrets`, `nhdw-gateway-secrets`, `minio-secrets`,
`postgres-vault-secrets`, `smtp-secrets`, `alert-eval-secrets`, `jupyterhub-secrets`,
`superset-secrets`, `mlflow-secrets`, `airflow-secrets` + `-oidc`, the four `*-gate-secrets`,
`headlamp-token`, `source-creds`, `keycloak-idp-secrets`, and the rest listed in `secrets.yaml`.

**Cluster infra the chart does NOT own** (the provision/cni roles handle it, like the CNI):
`metrics-server` (kube-system; the gateway HPA needs it) and the wildcard TLS secret
`nhdw-wildcard-tls` (from `gen-tls.sh`). Pipeline **Jobs** (`dbt-jobs`, `ingestor-jobs`) are run by
the seed step, not the always-on chart.

## Verifying parity yourself
```
kustomize build --load-restrictor LoadRestrictionsNone 1_infrastructure/k8s/overlays/dev > /tmp/ks.yaml
helm template nhdw 1_infrastructure/helm/nhdw -f 1_infrastructure/helm/nhdw/values-single.yaml > /tmp/hm.yaml
# deep-diff by (kind,namespace,name); everything in ks-but-not-hm must be a ConfigMap/Secret above.
```
**P3.3** then does the live `helm upgrade --install` on the running cluster and confirms the pods
reconcile with no spec drift.
