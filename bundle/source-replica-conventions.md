# Source Replica Conventions

This document defines the conventions every source replica under `0_external/sources/` must follow. The goal: **the rest of the system can develop against the replicas as if they were the real source systems.** Swapping to production should be a matter of changing connection credentials and (rarely) one or two minor code paths.

## Per-source folder structure

```
0_external/sources/{SourceName}/
├── README.md               # What the source is, real-world interface, how to start the replica
├── docker-compose.yml      # Self-contained stack — starts independently
├── .env.example            # All required environment variables (committed)
├── .env                    # Actual values (gitignored)
├── .gitignore
├── schema/                 # Authoritative DDL / OpenAPI / FHIR profile
│   └── *.sql | *.yaml | *.json
├── sample-data/            # Symlinks to large fixtures + small fixtures committed directly
│   └── README.md           # What each fixture is, provenance, refresh policy
├── init/                   # Container init scripts (executed at first start)
│   ├── 01-schema.sh
│   ├── 02-restore.sh       # Restores dump when applicable
│   └── 03-seed.sh          # Synthesizes row data when applicable
├── api/                    # ONLY when the source exposes a mock API (e.g., mBrana)
│   ├── Dockerfile
│   ├── pyproject.toml | requirements.txt
│   └── src/
└── scripts/                # Operator scripts — restore, snapshot, reset
    ├── restore.sh
    ├── reset.sh
    └── verify.sh
```

**Large binary fixtures (>10 MB)** stay in `_resources/sample-data/` and are symlinked into `0_external/sources/{Source}/sample-data/`. This keeps each source folder light, prevents accidental git commits of large files, and gives a single canonical copy.

**Container data volumes** live under `/mnt/projects/nhdw/0_external/sources/{Source}/data/` (sibling of the source folder, gitignored). Keeps the source folder readable; lets us wipe data without nuking config.

## Port allocation (host side — bound to `127.0.0.1` only)

Localhost-only by default to keep replicas off the network. Real production access happens via VPN / SSH tunnel; the ingestor speaks to either via the same connection string with different host/port.

| Source | Service | Host port | Container port | Protocol |
|---|---|---|---|---|
| **EthioEMR** | MySQL (OpenMRS backend) | `127.0.0.1:33306` | 3306 | MySQL wire |
| **EthioEMR** | OpenMRS web (REST + FHIR R4) | `127.0.0.1:8081` | 8080 | HTTP |
| **HCMIS WDM** | SQL Server | `127.0.0.1:1433` | 1433 | TDS |
| **DHIS2** | DHIS2 web (REST API) | `127.0.0.1:8080` | 8080 | HTTP |
| **DHIS2** | PostgreSQL backend | `127.0.0.1:5433` | 5432 | Postgres wire |
| **mBrana** | SQL Server (HCMISWCloud DB) | `127.0.0.1:1434` | 1433 | TDS |

Backend DB ports are exposed for debugging and direct CDC scenarios. Production-equivalent access is via the source's primary protocol (HTTP for DHIS2 and EthioEMR; TDS for HCMIS WDM and mBrana — both are EPSS-style SQL Server backends).

## Docker networks

Every source compose file:

1. Creates its own internal network (`{source}_net`) for service-to-service communication inside the source.
2. Attaches to the **external** network `nhdw_net` for ingestor/orchestrator access.

The `nhdw_net` network already exists on this host (created previously). To create it elsewhere:

```bash
docker network create nhdw_net
```

Within `nhdw_net`, each source is reachable from other containers by its service name:
- `ethioemr-openmrs:8080`, `ethioemr-mysql:3306`
- `hcmiswdm-sqlserver:1433`
- `dhis2-web:8080`, `dhis2-db:5432`
- `mbrana-sqlserver:1433`

## Environment variable conventions

Every `.env.example` follows this shape:

```bash
# Source: {SourceName}
# Purpose: Replica of {real-world description}
# Real-world equivalent connection: {host:port, protocol}

# ── Admin / privileged creds (only used by init + restore) ──
{SOURCE}_ADMIN_PASSWORD=changeme-strong-password

# ── Read-only service users (used by ingestor / OpenFn) ──
{SOURCE}_READER_USER=ingestor
{SOURCE}_READER_PASSWORD=changeme-reader-password

# ── Volume / data location ──
{SOURCE}_DATA_DIR=/mnt/projects/nhdw/0_external/sources/{SourceName}/data

# ── Public endpoint (advertised to ingestor) ──
{SOURCE}_HOST=127.0.0.1
{SOURCE}_PORT={port}
```

Future-state: these values come from OpenBao via Vault Agent injection, not from a `.env` file. For Phase 1 they live in gitignored `.env` files; the example is what's committed.

## README requirements

Every source's `README.md` must contain these sections, in this order:

1. **What this source is** — one paragraph, including real-world owner and operational role.
2. **Real-world interface** — exact endpoints, protocols, authentication mechanisms, standards used (FHIR R4? Web API? TDS? SOAP?).
3. **What this replica contains** — restored real data? synthesized data? fixture-only? Quantify (row counts, date ranges).
4. **Deviations from real** — anything we faked, simplified, or assumed where real spec was unknown.
5. **How to start the replica** — `cp .env.example .env && docker compose up -d` plus any init script invocations.
6. **How to verify it's working** — exact curl / sqlcmd / mysql commands that should return a meaningful response.
7. **How to connect from the ingestor** — connection string template, what to substitute when pointing at real production.
8. **How to reset / wipe / re-seed** — operator runbook.

## Source isolation contract

Each source replica is a **standalone application**:

- It must start with `docker compose up -d` from its own folder, **without depending on any other source being up**.
- It must clean up cleanly with `docker compose down -v`.
- Its data lives at `{SOURCE}_DATA_DIR` and is wipeable independently.
- It exposes its real-world protocol — not a uniform "warehouse API". The point is interface fidelity.
- It does NOT know about the data warehouse, dbt, MinIO, the ingestor, or any downstream consumer.

## Top-level compose aggregator (Docker Compose `include:`)

While each source owns its own `docker-compose.yml`, the top-level `/mnt/projects/nhdw/docker-compose.yml` uses Compose v2.20+ `include:` to bring everything up with one command for operator convenience.

```yaml
# /mnt/projects/nhdw/docker-compose.yml (abbreviated)
include:
  - path: 0_external/sources/EthioEMR/docker-compose.yml
    project_directory: 0_external/sources/EthioEMR
    env_file: 0_external/sources/EthioEMR/.env
  - path: 0_external/sources/HCMISWDM/docker-compose.yml
    project_directory: 0_external/sources/HCMISWDM
    env_file: 0_external/sources/HCMISWDM/.env
  # … etc.
```

Operator commands:
- `cd /mnt/projects/nhdw && docker compose up -d` — bring up every source
- `docker compose ps` — status across all
- `docker compose logs -f hcmiswdm-sqlserver` — tail any specific service
- `cd 0_external/sources/<X> && docker compose up -d` — still works; per-source compose is canonical

Use the per-source path for source-specific dev (faster, less coupling). Use the top-level path for one-shot bring-up or tear-down of the entire fleet.

## Credential transition path

Phase 1 (now): per-source `.env` files committed-as-example, real values gitignored.
Phase 2 (when OpenBao lands): credentials stored as Vault KV; containers receive them via Vault Agent injection. The `.env.example` becomes a Vault policy reference.

Either way, **the ingestor reads credentials from a single config source** and never embeds them. To switch from replica → production: change the credential values (and optionally the host/port). No code change required.

## Naming conventions

- Container name: `{source}-{service}` (kebab-case, lowercase). e.g. `ethioemr-mysql`, `hcmiswdm-sqlserver`, `dhis2-web`.
- Volume mount on disk: `/mnt/projects/nhdw/0_external/sources/{Source}/data/{service}`.
- Internal network: `{source}_net`.
- Service name in compose: short single-word (`db`, `web`, `api`).
- Env var prefix: `{SOURCE}_` in screaming-snake-case.

## Operator scripts contract

Every source provides three idempotent scripts under `scripts/`:

| Script | Behaviour |
|---|---|
| `restore.sh` | Load schema + sample data into a fresh container. Safe to re-run; truncates first. |
| `reset.sh` | Stop containers, remove data volumes, restart cleanly. Destructive — confirms. |
| `verify.sh` | Run a connectivity + sanity-check query. Exits 0 if green, non-zero otherwise. |
