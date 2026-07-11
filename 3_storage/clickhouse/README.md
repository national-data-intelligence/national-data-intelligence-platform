# NHDW ClickHouse engine

Single ClickHouse instance backing two logical databases:

| Database | Purpose | Owned by |
|---|---|---|
| `nhdw_staging` | Ephemeral views over MinIO Parquet (no rows persisted). Source for the vault loader. | `2_pipelines/staging/` (dbt-clickhouse) |
| `nhdw_marts` | Denormalised analytics aggregates fed from the Postgres vault. | `2_pipelines/marts/` (dbt-clickhouse, future) |

Following the project layout rule: **databases live in `3_storage/`**, **transformation code lives in `2_pipelines/`**.

---

## Why single engine, two databases (not two clusters)

Industry-standard pattern for self-hosted ClickHouse — used by Cloudflare, eBay, GitLab, and recommended by ClickHouse Cloud itself. Isolation is achieved via **per-user settings profiles + quotas** (see `config/users.d/profiles.xml`), not by spinning up a second cluster.

Benefits:

- **Staging → marts is just SQL.** Marts read from staging in-engine, no replication or cross-cluster export.
- **Single ops surface** — one upgrade, one backup, one health check.
- **Shared cache** between workloads.
- **Noisy-neighbour solved by quotas** — staging refreshes can't starve mart queries.

Split into separate clusters only if you hit one of:
1. Different compliance domain (e.g., PHI vs public).
2. Geographic separation (data residency).
3. Wildly different scale + workload that quotas can't reconcile.
4. Independent upgrade cadence per tier.

NHDW satisfies none of these today.

---

## Layout

```
3_storage/clickhouse/
├── docker-compose.yml          one engine, port 8123 (HTTP) + 9002 (TCP)
├── .env.example                MinIO creds, per-user passwords, data dir
├── config/
│   ├── config.d/
│   │   └── named_collections.xml    `nhdw_minio` for all s3() calls
│   └── users.d/
│       ├── profiles.xml              staging/marts/reader profiles + quotas
│       └── default-user.xml          written by entrypoint (lockdown default user)
├── init/                       runs once on a fresh data dir
│   ├── 01_databases.sql              CREATE DATABASE nhdw_staging + nhdw_marts
│   ├── 02_users.sh                   wrapper that envsubsts then applies:
│   ├── 02_users.sql.template         user DDL with ${PASSWORD} placeholders
│   └── 03_raw_views.sql              ext views: raw_<source>__<object>
└── scripts/
    └── verify.sh               post-boot sanity check
```

## Service users

| User | Profile | Grants | Used by |
|---|---|---|---|
| `staging_writer` | `staging` (4 GB / 4 threads / 30 min) | DDL/DML on `nhdw_staging`, `s3` source, `nhdw_minio` named collection | `2_pipelines/staging/` (dbt) |
| `mart_writer` | `marts` (6 GB / 6 threads / 10 min) | DDL/DML on `nhdw_marts`, `SELECT` on `nhdw_staging`, `POSTGRES` source | `2_pipelines/marts/` (dbt, future) |
| `bi_reader` | `reader` (2 GB / 2 threads / 2 min, readonly) | `SELECT` on `nhdw_marts` only | CloudBeaver, base dashboard, Superset |

Passwords live in `.env` (gitignored), wired into the user DDL by `init/02_users.sh` envsubst.

## MinIO access

Staging reads Parquet via the `nhdw_minio` named collection (defined in `config/config.d/named_collections.xml`, secrets injected from container env). All s3 reads use the existing `nhdw_transformer` MinIO service account — read on `nhdw-raw`, write on `nhdw-processed` (write half unused by CH).

## First boot

```bash
cd 3_storage/clickhouse
cp .env.example .env                    # fill from sibling .env files
docker compose up -d
docker logs -f clickhouse                # wait for "Ready for connections"
bash scripts/verify.sh                  # confirms s3() reads succeed
```

## Re-init (drop everything)

```bash
docker compose down
sudo rm -rf /data/storage/clickhouse/{data,logs}
sudo mkdir -p /data/storage/clickhouse/{data,logs}
sudo chown -R 101:101 /data/storage/clickhouse
docker compose up -d
```

## Adding a new source object

When the ingestor lands a new parquet path under `nhdw-raw/<source>/<object>/`, add the corresponding ext view to `init/03_raw_views.sql`:

```sql
CREATE OR REPLACE VIEW raw_<source>__<object> AS
    SELECT * FROM s3(nhdw_minio,
                     filename='nhdw-raw/<source>/<object>/**/*.parquet',
                     format='Parquet');
```

Then either restart on a fresh data dir, or apply manually:

```bash
docker exec -i clickhouse clickhouse-client --multiquery < init/03_raw_views.sql
```

The dbt source declaration (in `2_pipelines/staging/models/sources.yml`) is the contract that names this view as a usable `source()`.
