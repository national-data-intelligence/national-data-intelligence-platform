# NHDW Data Vault — Postgres engine

The relational engine hosting all three vault layers. **Storage tool → `3_storage/`**; transformation code lives separately in `2_pipelines/vault/`.

| Schema | Purpose | Owned by |
|---|---|---|
| `nhdw_landing` | Persistent Staging Area — PG-side mirror of CH `nhdw_staging.stg_*`. TRUNCATE+COPY on each vault run. | `2_pipelines/vault/bridge/` |
| `nhdw_vault_raw` | Raw Vault — hubs / links / sats faithful to source business keys. AutomateDV-managed. | `2_pipelines/vault/` |
| `nhdw_vault_business` | Business Vault — conformed hubs, same-as links, derived sats (period decomposition, Ethiopian calendar, MFR matching). | `2_pipelines/vault/` |

## Why Postgres for the vault

Data Vault's hub/link/sat model relies on enforced PKs/FKs and transactional multi-row inserts — exactly what relational engines do well. ClickHouse's eventual-consistency mutations and lack of true uniqueness constraints would fight the methodology at every turn. Marts go back to ClickHouse where columnar scans pay off (see `3_storage/clickhouse/README.md`).

## Layout

```
3_storage/postgres/
├── docker-compose.yml                  port 127.0.0.1:54322 → container 5432
├── .env.example                        admin + per-user passwords
├── init/                               runs once on a fresh data dir
│   ├── 01_schemas.sql                  CREATE SCHEMA nhdw_landing/raw/business
│   ├── 02_users.sh                     envsubst wrapper for:
│   └── 02_users.sql.template           CREATE USER landing_writer / vault_writer / bi_reader
└── scripts/
    └── verify.sh                       smoke test of users + grants
```

## Service users

| User | Used by | Grants |
|---|---|---|
| `vault_admin` | bootstrap only — never used at runtime | superuser |
| `landing_writer` | `2_pipelines/vault/bridge/` (CH→PG sync) | DDL/DML on `nhdw_landing` |
| `vault_writer` | `2_pipelines/vault/` (dbt-postgres + AutomateDV) | DDL/DML on `nhdw_vault_raw` + `nhdw_vault_business`, SELECT on `nhdw_landing` |
| `bi_reader` | CloudBeaver, base dashboard, Superset | SELECT on `nhdw_vault_business` only |

Passwords live in `.env` (gitignored).

## First boot

```bash
cd 3_storage/postgres
cp .env.example .env                    # generate strong passwords
docker compose up -d
docker logs -f postgres-vault           # wait for "ready to accept connections"
bash scripts/verify.sh                  # confirms schemas + grants
```

## Re-init from scratch

```bash
docker compose down
sudo rm -rf /data/storage/postgres
docker compose up -d
```

## How data flows in

1. **Bridge** (`2_pipelines/vault/bridge/`) runs daily after staging completes:
   - Connects to ClickHouse, reads each `nhdw_staging.stg_*` view.
   - TRUNCATEs the matching `nhdw_landing.stg_*` table on Postgres.
   - COPYs the rows over in bulk.
2. **Raw Vault dbt models** read from `nhdw_landing.stg_*` via AutomateDV's `hub`/`link`/`sat` macros — each macro emits the standard "insert only on new business key" or "insert only on changed hash_diff" semantics.
3. **Business Vault dbt models** read from raw vault, build conformed hubs (e.g. `hub_facility_conformed`), same-as links, and derived sats (e.g. Ethiopian-calendar-resolved periods).
4. **Marts** (future) read from business vault, materialise in ClickHouse via the existing `postgresql()` table function from `nhdw_marts`.
