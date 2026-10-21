# System tools inventory

Every tool the platform runs, listed in the order data flows through them.
For each: the service it gives, how it is wired into the rest of the system,
what goes in and who supplies it, and what comes out and who consumes it.
Compiled 2026-09-22 against the `develop` branch and the live palladium2 host.

---

1. **Docker (host daemon)**
   - Service: runs the seven source replicas, Ollama and the Palladium console outside the cluster, and builds every image.
   - Connected: pods reach host containers through the `host.k3d.internal` DNS alias.
   - Input: compose files and Dockerfiles from the repo, run by `sources-up.sh` and `ci-redeploy.sh` at seed and deploy time.
   - Output: running containers and image tars, consumed by k3s via image import.

2. **DHIS2 2.40 with PostGIS**
   - Service: the aggregate HMIS and IDSR replica.
   - Connected: host port 8080, reached by the DHIS2 ingestor.
   - Input: a seeded pgdump or the Ethiopia seeder scripts at first boot.
   - Output: org units, data elements and data values over its web API during the ingest stage, consumed by the DHIS2 ingestor.

3. **OpenMRS on MySQL 8 (EthioEMR)**
   - Service: the EMR replica.
   - Connected: host port 33306.
   - Input: a SQL dump plus the synthesizer at boot.
   - Output: encounters and observations read by the EthioEMR ingestor.

4. **SQL Server 2025 (HCMIS WDM and mBrana)**
   - Service: the national warehouse and mobile-reporting replicas in one instance.
   - Connected: host port 1433.
   - Input: `.bak` restores plus synthesizers at boot.
   - Output: stock, dispatch and facility tables read by the two ingestors. Skipped under the Zambia profile.

5. **HAPI FHIR 8 (MFR)**
   - Service: the master facility registry replica.
   - Connected: host port 8093.
   - Input: FHIR bundles posted by `seed.py` at boot.
   - Output: Organization, Location and Device resources read by the MFR ingestor, plus CSVs landed directly into Postgres.

6. **Climate API**
   - Service: a small custom HTTP server for weekly climate rows.
   - Input: a generated CSV.
   - Output: JSON read by the climate ingestor. Skipped under Zambia.

7. **PostgreSQL 16 (eLMIS / OpenLMIS archive)**
   - Service: the only genuinely Zambian source.
   - Connected: host port 5434.
   - Input: a historical dump if present, else the deterministic synthesizer at boot.
   - Output: 16 reference and requisition tables read by the eLMIS history ingestor.

8. **Fayda replica**
   - Service: a custom email-OTP identity verifier standing in for the Ethiopian national ID.
   - Connected: host port 8096, proxied by the public dashboard.
   - Input: a citizen seed file.
   - Output: a verification result consumed by the public access-request form.

9. **Ollama 0.6.8 with qwen2.5 14b**
   - Service: the local language model on the T4 GPU.
   - Connected: the gateway calls it over the host alias.
   - Input: prompts and a tool catalogue from the gateway's chat route when a user talks to the assistant.
   - Output: answers and tool calls consumed by the gateway, which executes them within the user's permissions.

10. **dlt 1.4 ingestors (seven Python packages)**
    - Service: extract each source and land raw records as Parquet.
    - Connected: run as Kubernetes Jobs by `seed-realistic.sh`.
    - Input: the source APIs and databases above, at ingest time.
    - Output: Parquet files and a manifest sidecar per table in the lake, consumed by ClickHouse raw views and the DQ freshness checks.

11. **SeaweedFS 4.45**
    - Service: the S3-compatible object lake and artifact store.
    - Connected: master, filer and volume pods; a filer database in Postgres.
    - Input: ingestor Parquet, ML packages, exports, docs and profile assets, written by ingestors, `seed-ml.sh`, the gateway and `seed-docs.sh`.
    - Output: objects read by ClickHouse, the ML runner, JupyterLab, the docs route and presigned downloads. `mc` is the client used by scripts.

12. **ClickHouse 24.3**
    - Service: the staging engine that reads the lake fast.
    - Connected: raw views over the S3 files, then dbt-staging models.
    - Input: Parquet from SeaweedFS, exposed by the `ch-raw-views` Job.
    - Output: cleaned `stg_*` views consumed by the bridge.

13. **Bridge (custom Python)**
    - Service: copies every ClickHouse staging view into Postgres landing tables.
    - Connected: the `bridge-sync` Job.
    - Input: ClickHouse views after dbt-staging.
    - Output: `nhdw_landing.stg_*` tables consumed by dbt-vault, plus lineage events to OpenMetadata.

14. **PostgreSQL 16 (postgres-vault)**
    - Service: the warehouse and the operational store.
    - Connected: one StatefulSet holding `nhdw_vault` (landing, raw vault, business vault, marts, reference vocabulary, Keycloak schema) and `nhdw_ops` (identity, permissions, governance, ML, plans), plus databases for Airflow, MLflow, Superset, OpenMetadata and the SeaweedFS filer.
    - Input: init SQL at first boot, dbt builds, gateway writes.
    - Output: everything downstream reads it. Extensions in use: postgres_fdw for the ops-to-vault read seams, pg_trgm for fuzzy matching, uuid-ossp for master ids.

15. **dbt with AutomateDV (staging, vault, marts projects)**
    - Service: builds the Data Vault and the `bi_*` marts from SQL models.
    - Connected: three images run as Jobs in sequence; also runnable from the host.
    - Input: landing tables, seeds and the decision-log seams, at pipeline time and on CI when models change.
    - Output: hubs, links, satellites, resolution views, marts, plus `manifest.json`, `run_results.json` and docs written to a shared volume, consumed by Trino, the gateway DQ route and dbt Docs.

16. **MDM matcher (custom Python Job)**
    - Service: proposes same-entity candidates.
    - Input: the resolution view after dbt-marts.
    - Output: candidate rows in the ops database, consumed by the steward console.

17. **Trino 476**
    - Service: the SQL engine the application layer queries through.
    - Connected: a `marts` catalog over the vault Postgres.
    - Input: SQL from the gateway fetchers, the SQL Lab, reports and Superset.
    - Output: result rows consumed by the gateway, which masks and filters them before dashboards see them.

18. **OPA 1.5**
    - Service: the policy decision point.
    - Connected: a Deployment reading a ConfigMap of Rego compiled from the permission store by `regen-opa-policy.sh`.
    - Input: a decision request per data read from the gateway, carrying user, role, scope, mart attributes and classified columns.
    - Output: allow or deny plus row-filter and masking obligations, consumed by the gateway.

19. **Keycloak 26 (custom image with the login theme)**
    - Service: identity for staff and operators.
    - Connected: two login realms, a mock SAML realm, Google as a broker, one client per dashboard and tool.
    - Input: realm JSON and the users file applied by the seed Job at boot and on cast switches.
    - Output: OIDC tokens consumed by every dashboard, the gateway and every tool gate.

20. **NHDW gateway (custom FastAPI)**
    - Service: the single API every dashboard uses.
    - Connected: validates Keycloak tokens, asks OPA, queries Trino, reads and writes the ops database, calls Ollama and MLflow.
    - Input: dashboard requests at run time; Airflow calls for DQ detection and alert evaluation.
    - Output: JSON for widgets, exports, audit rows, plan and steward decisions; consumed by the four SPAs, notebooks via tokens, and the demo console.

21. **Dashboard backends (four small FastAPI apps)**
    - Service: serve each React build and proxy `/gw` to the gateway with the user's token.
    - Input: browser requests.
    - Output: static assets and proxied API responses.

22. **React and Vite SPAs (internal BI, public, admin, workshop)**
    - Service: the user interfaces. Libraries: ECharts for charts, MapLibre with pmtiles for the offline Control Tower map, Cytoscape for the topology graph.
    - Input: the resolved widget catalogue and data from the gateway.
    - Output: what people see.

23. **Traefik (bundled with k3s)**
    - Service: the ingress that routes `*.<hostBase>` hostnames to services and terminates TLS with the self-signed wildcard from `gen-tls.sh`.
    - Input: browser and CI requests.
    - Output: routed traffic.

24. **Tool gate (custom OIDC forward-auth, five instances)**
    - Service: puts a Keycloak login in front of MLflow, Prometheus, Alertmanager, Headlamp and SeaweedFS, with a role allowlist per tool.
    - Input: the browser session cookie.
    - Output: allow or a 403 page.

25. **Airflow (custom image, DAGs baked in)**
    - Service: the scheduler.
    - Connected: its own Postgres database; runs pods through the Kubernetes operator.
    - Input: six DAGs: batch prediction 04:00, catalog ingestion 05:00, drift check 06:00, DQ detection 06:15, alert evaluation every 15 minutes, and a paused nightly pipeline refresh.
    - Output: ML runner pods, HTTP calls to the gateway, and OpenMetadata ingestion runs.

26. **MLflow (custom image)**
    - Service: experiment tracking and the model registry with champion and challenger aliases.
    - Connected: its own Postgres database and lake artifacts.
    - Input: runs and metrics logged by the ML runner; alias changes from the gateway promote route.
    - Output: registered versions and aliases read by the runner, the admin models page and the workshop.

27. **ML runner (custom image, Jobs and Airflow pods)**
    - Service: trains, scores, checks drift and performance for the six model packages.
    - Input: packages from the lake and feature queries over the marts.
    - Output: predictions, run and performance rows in the ops ML schema, which flow through a foreign-data seam into the forecast marts and the disease widgets.

28. **JupyterHub with per-user JupyterLab pods**
    - Service: the research sandbox.
    - Connected: Keycloak login, a lab pod spawned per user from a project.
    - Input: project files from the lake and a token to the gateway.
    - Output: notebooks and artifacts saved back to the project, reviewed through graduation.

29. **Superset (custom image)**
    - Service: self-service SQL and charts.
    - Connected: Keycloak login, a Trino connection to the marts catalog.
    - Input: analyst queries.
    - Output: charts and dashboards inside Superset. Reached only by the super role from the admin tile today.

30. **dbt Docs (custom image)**
    - Service: serves the model lineage graph and column docs.
    - Input: the docs folder written by the dbt Jobs to a shared volume.
    - Output: a browsable site behind Keycloak.

31. **OpenMetadata 2.0.2 with OpenSearch 2.19**
    - Service: the data catalog and column-level lineage.
    - Connected: its own Postgres database, OpenSearch as its index, Keycloak SSO, an ingestion bot token.
    - Input: the daily ingestion DAG over Postgres, ClickHouse, the lake, dbt and Airflow; lineage events from ingestors and the bridge; dashboard structure from `sync-om-dashboards.py`.
    - Output: a searchable catalog and tags, which the classification sync can copy into the masking denylist. It describes only; nothing depends on it at run time.

32. **Prometheus 2.53 and metrics-server**
    - Service: metrics store.
    - Input: scrapes of the gateway, Kubernetes and Hubble.
    - Output: time series read by the admin topology and alert rules.

33. **Alertmanager 0.27**
    - Service: alert routing and silences.
    - Input: firing rules from Prometheus.
    - Output: alerts read by the admin Alert routing page and the gateway alerts route. Email is disabled by values.

34. **Loki 2.9 and Promtail**
    - Service: log store and shipper.
    - Input: pod logs collected by Promtail.
    - Output: per-workload error counts read by the topology view.

35. **Cilium with Hubble**
    - Service: the cluster network and flow observability.
    - Input: pod traffic.
    - Output: flow metrics exported to Prometheus, drawn as edges in the topology.

36. **Headlamp 0.31**
    - Service: a raw Kubernetes console.
    - Connected: behind a tool gate at `admin.<hostBase>/k8s`.
    - Input: operator actions.
    - Output: edits, scales and execs on the namespace.

37. **k3s (palladium2) and k3d (laptop)**
    - Service: the Kubernetes runtime.
    - Input: the Helm chart on k3s, the kustomize overlay on k3d.
    - Output: the running namespace.

38. **Helm, kustomize, Ansible**
    - Service: deployment definition and provisioning.
    - Input: chart values with the host base, the dev overlay, the inventory.
    - Output: applied manifests and a provisioned host.

39. **GitHub Actions with a self-hosted runner on palladium2**
    - Service: CI and deployment.
    - Input: pushes to develop and main.
    - Output: rebuilt images imported into k3s, reseeds, reruns of the dbt chain, and verification.

40. **Palladium demo console (FastAPI, Postgres, Caddy) and the in-repo demo console (Python)**
    - Service: the presenter's cockpit.
    - Input: the gateway's demo contract for health, profile switch and scripted actions; a scenarios file.
    - Output: status pages, profile switch requests picked up by the host swap worker, and credential lists.

41. **Gmail SMTP relay**
    - Service: real outbound mail.
    - Input: access-request decisions and onboarding from the gateway mailer.
    - Output: email to the configured recipients. Alert email is off.

42. **Playwright**
    - Service: browser test automation.
    - Input: test scripts and demo logins.
    - Output: pass and fail lines plus screenshots, used only in verification.

---

Present in the repo but not running on palladium2: OpenHIM and a FHIR mediator
under the API folder, OpenBao under security, and a Grafana database with no
Grafana.
