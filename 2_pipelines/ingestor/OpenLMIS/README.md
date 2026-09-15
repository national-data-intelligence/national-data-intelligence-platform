# OpenLMIS ingestor

Pulls the OpenLMIS v3 source replica (`1_external/sources/OpenLMIS/`) into the
MinIO data lake as Parquet via dlt. One-shot job container, same skeleton as
the DHIS2 ingestor (repetition over shared coupling, per the working
agreement).

## Pipelines

| CLI verb | Tables (lake: `s3://nhdw-raw/openlmis/<table>/…`) | Disposition |
|---|---|---|
| `reference-data` | facilities, geographic_zones, programs, orderables (+`orderables__programs` child), processing_periods, lots | replace |
| `requisitions` | requisitions (+ dlt child tables for line items) | replace |
| `stock` | stock_cards (one paged sweep of `/api/stockCards`, embedded facility/program/orderable/lot + stockOnHand) | replace |
| `orders` | orders, proofs_of_delivery (PoDs fetched per order id — unfiltered endpoint 500s) | replace |
| `all` | everything above | — |

Everything is full-refresh (`replace`): demo-scale snapshots, and requisitions
mutate in place along their status workflow so a snapshot is the honest shape.

## Auth

OAuth2 password grant against `/api/oauth/token` (client id/secret via HTTP
Basic), token refreshed automatically on 401. See `.env.example` for all env
vars; in-cluster values come from the `source-creds` Secret via
`0_infrastructure/k8s/base/ingestor-jobs.yaml` (`openlmis-ingest`, args
`["all"]`, base URL `http://host.k3d.internal:8086`).

## Local smoke run

```bash
docker build -t nhdw/openlmis-ingestor:dev .
docker run --rm --network nhdw_net \
  -e OPENLMIS_BASE_URL=http://openlmis-nginx \
  -e OPENLMIS_USER=administrator -e OPENLMIS_PASSWORD=password \
  -e OPENLMIS_OAUTH_CLIENT=user-client -e OPENLMIS_OAUTH_SECRET=changeme \
  -e MINIO_ENDPOINT=http://<minio>:9000 -e MINIO_ACCESS_KEY=... -e MINIO_SECRET_KEY=... \
  nhdw/openlmis-ingestor:dev all
```
