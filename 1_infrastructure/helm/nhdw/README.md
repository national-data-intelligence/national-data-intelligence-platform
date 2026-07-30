# NHDW Helm chart (application tier)

Packages the NHDW app tier as a Helm chart so that **single-node vs fleet is a values
choice**, replacing the kustomize base + dev overlay. See `docs/production-deployment-plan.md`.

## Status — P3.1 FOUNDATION
- ✅ Chart skeleton + values schema + topology profiles (`values-single.yaml` / `values-fleet.yaml`).
- ✅ Image helper `nhdw.image` — `image.repository` + `image.tag` as values (the P2.1 knob).
- ✅ Reference component converted + `helm template`-verified: **internal-bi** (Deployment + Service).
- ⏳ Remaining: convert the other ~23 base manifests (checklist below) + resolve obstacle #2.

## Deploy
```
helm template nhdw . -f values-single.yaml                         # render + eyeball
helm upgrade --install nhdw . -n nhdw -f values-single.yaml        # single-node
helm upgrade --install nhdw . -n nhdw -f values-fleet.yaml         # fleet
```

## Two real conversion obstacles (why this isn't a mechanical sed)
1. **The dev overlay transforms the base.** It remaps 14 image names+tags and *patches env*
   (e.g. OIDC hostnames from localhost placeholders → `*.nip.io`). Templates must render the
   **final, overlay-applied** form, parameterized by values (`image.*`, `hostBase`,
   `keycloak.*`). `templates/internal-bi.yaml` is the reference for the pattern.
2. **7 `configMapGenerator`s read files OUTSIDE the chart** (`../../../bundle/seed-pack/…`,
   `7_security/keycloak/…`, `7_security/opa/…`). Helm's `.Files.Get` is **chart-relative** and
   cannot reach them. Options: (a) relocate the referenced files under the chart's `files/`;
   (b) have the Ansible deploy role create those configMaps as a pre-step and reference them by
   name; (c) keep a thin kustomize post-render for just those. **Decide before converting the
   keycloak-seed / opa / security configmaps.**

## Remaining base manifests → `templates/`
`namespace, postgres-vault, clickhouse, minio, trino, keycloak (+seed-job), opa, mlflow,
nhdw-gateway (+hpa), dashboards (public/admin/workshop), superset, airflow, jupyterhub,
dbt-docs, headlamp, tool-gates, gateway-rbac, metrics-server, dbt-jobs, ingestor-jobs`.
Each: image via `nhdw.image`, replicas/resources via `.Values.components.<c>`, hostnames via
`.Values.hostBase`. **P3.3** then diffs `helm template` vs `kustomize build` for full parity
and deploys on the live cluster.
