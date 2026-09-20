# The metadata plane — OpenMetadata, lineage, classification

The catalog/lineage layer of the data-layer enhancement (Track B, batch 1).
**OpenMetadata (OM) describes the estate; it never enforces or serves it.** OPA
keeps reading the committed `ops_perm` seed; every pipeline and dashboard works
identically with OM scaled to zero (verified — the regression suite is green
with 0 replicas).

## What runs

| Piece | Where | Notes |
|---|---|---|
| OpenMetadata server 2.0.2 | `1_infrastructure/k8s/base/openmetadata.yaml` (+ Helm mirror, gated by `values.openmetadata.enabled`) | `db-migrate` initContainer runs OM's schema migrations; UI/API on :8585 |
| OpenSearch 2.19.6 | `base/opensearch.yaml` | single node, security plugin off, 1 GiB heap; OM is its only consumer; "yellow" health is normal on one node |
| Metadata DB | `nhdw_openmetadata` on postgres-vault | init `3_storage/postgres/init/37_openmetadata_db.sh`; writer `openmetadata_writer` |
| Ingestion DAG | `5_orchestrator/dags/openmetadata_ingestion.py` | daily 05:00; five connectors (postgres, clickhouse, datalake, dbt, airflow); every task best-effort — a failed connector never fails the run |
| Bootstrap | `bundle/scripts/seed-openmetadata.sh` | waits for OM, validates the bot token, triggers the DAG once |
| Lineage emitters | `2_pipelines/ingestor/*/src/lineage.py` | source-system → raw-view hop; silent no-op unless `OM_LINEAGE_API`/`OM_LINEAGE_JWT` are set; never touches the `_manifest.json` sidecars |
| dbt exposures | `bundle/scripts/gen-exposures.py` → `2_pipelines/marts/models/_exposures.yml` | the marts→widget hop, derived from the gateway's `fetchers.py` registry (parsed read-only); rerun after widget changes, then rebuild the marts image |
| Classification sync | `bundle/scripts/sync-om-classification.py` | one-way OM tags → `ops_perm.column_classification` + a committed seed file; `managed_by='openmetadata'` rows only, can never overwrite `seed`/`steward` rows; dry-run by default, writing needs `--apply` **and** `OM_CLASS_SYNC_ENABLED=true`; skips cleanly while the governance table does not exist yet |

Access: `https://openmetadata.<hostBase>` (ingress + Helm list entry), Keycloak
SSO (`moh-staff`); admin tile on the admin dashboard's Documentation page
(R-STEW / R-OPS-ADM / R-SUPER). OM admins: the `admin` bootstrap principal and
`superadmin` (SSO) — `AUTHORIZER_ADMIN_PRINCIPALS`.

## SSO — the wiring that actually works (hard-won, keep it)

Confidential client `moh-staff/openmetadata` (seeded by `setup-keycloak.py`
TOOL_CLIENTS). The OM **server** exchanges the code at `/callback` and hands
the browser a session cookie; discovery/JWKS go to Keycloak's internal http
Service, only the browser leg uses the public host (split-URL, like
Superset/Airflow). Three gotchas, each found the hard way:

1. **`OIDC_SERVER_URL` must be set to OM's public base.** It is the
   trusted-redirect base for the login servlet; its default (`localhost:8585`)
   makes every sign-in fail with *"Redirect URI must exactly match a trusted
   redirect URI"*.
2. **No PKCE attribute on this Keycloak client.** Keycloak enforces
   `pkce.code.challenge.method` against the server-side flow too, which sends
   no challenge (*"Missing parameter: code_challenge_method"*). Keycloak merges
   client attributes on update — clearing one means setting it to `""`.
3. **OM persists auth/authorizer config into its DB on first boot and prefers
   the DB copy.** After changing auth env:
   `DELETE FROM openmetadata_settings WHERE configtype IN
   ('authenticationConfiguration','authorizerConfiguration');` then restart.

Do **not** switch the client to public/PKCE: OM 2.0.2's SPA initiates that
flow but never completes the exchange at `/auth/callback`
(open-metadata/OpenMetadata#26311) — validated with a scripted browser.

Also deliberate: HikariCP capped (`DB_CONNECTION_POOL_MAX_SIZE=10`). OM's
default pool of 100 exhausted Postgres `max_connections` and took Airflow down.

## Cold boot order

1. init 37 creates the DB (registered in the postgres init configmap);
   `openmetadata-secrets` from the secrets template (DB + OIDC tokens).
2. Deploy opensearch + openmetadata; keycloak-seed creates the client
   (the seed Job needs `PUBLIC_HOST_BASE`/`DASH_BASE_*` — the base manifest now
   pins dev defaults so a rerun can never regress clients to localhost).
3. **One manual step:** an OM admin issues the ingestion-bot token
   (Settings → Bots → ingestion-bot) and stores it:
   `kubectl -n nhdw patch secret openmetadata-secrets --type merge -p
   '{"stringData":{"INGESTION_BOT_TOKEN":"<token>"}}'`
4. `bundle/scripts/seed-openmetadata.sh` (validates, triggers the DAG).

## Known limits / deferred (deliberate, with cause)

- **Airflow lineage backend**: the OM provider is not in the shared Airflow
  image (heavy dependency surface); the Airflow *connector* already catalogs
  the DAGs. Revisit with the image owner.
- **Widget hop inside OM**: OM links dbt exposures only to entities from a
  dashboard connector; none exists yet. The exposures ship in the dbt manifest
  and render in dbt-docs. Option: a minimal dashboard-service registration.
- **dbt-docs stays** alongside OM on the Documentation page (product decision).
- Connector configs use `awsRegion: us-east-1`: OM validates against real AWS
  regions and rejects custom names; SeaweedFS ignores the value.
- The datalake connector models lake *files* individually — noisy but harmless;
  the meaningful per-table lineage runs through the raw views.
