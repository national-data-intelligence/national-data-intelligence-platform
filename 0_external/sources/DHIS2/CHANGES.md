# DHIS2 source replica — Ethiopia metadata overlay

The DHIS2 replica is bootstrapped in two steps. First, `scripts/restore.sh`
pg_restores the Sierra-Leone v40 demo dump into the `dhis2` database — this
gives us a working DHIS2 instance with a valid liquibase schema, admin user,
default categoryCombo, and the entire SL org-unit tree / dataElements.

`scripts/seed_ethiopia.py` then **overlays** the NHDW Ethiopia entity model on
top of that working instance through the REST API only. We never touch SQL;
all writes go through `/api/metadata` and `/api/dataValueSets`, so DHIS2's own
referential-integrity logic stays in charge.

## What gets rewritten (via REST)

| Object                  | Source              | Rows |
| ----------------------- | ------------------- | ---- |
| `organisationunit`      | regions + zones + woredas + facilities | ~1,616 (1 country + 14 regions + 134 zones + 574 woredas + 893 facilities) |
| `dataelement`           | `indicators.json`   | 40 |
| `dataelementgroup`      | `programmes.json`   | 8 |
| `dataset` (+ `dataset_organisationunits`, `dataset_dataelements`) | shared model | 1 (`HMIS Monthly`) assigned to all 893 facilities |
| `datavalue`             | synthesised, 36 months × 40 indicators × top-N facilities | capped at ~50,000 |

UIDs are derived deterministically with SHA-256 from the shared IDs (e.g.
`make_uid("ou","facility","FAC-OR-HP-84a0dc")`), so re-running the script is a
no-op for existing metadata — the bulk `/api/metadata` endpoint upserts by UID,
and `dataValueSets` upserts by (dataElement, period, orgUnit). The shared IDs
are persisted as DHIS2 `code` values so the ingestor can pivot back to the
canonical model.

## What stays untouched

- `users`, `userrole`, `usergroup`, `useraccess` — the SL admin / district user
  is preserved so existing API clients keep working.
- `systemsettings`, `keyjsonvalue`, `oauth2_clients` — system identity is left
  alone.
- `liquibasechangelog` / `liquibasechangeloglock` — schema is whatever the dump
  shipped; we never DDL.
- The legacy SL `organisationunit` rows are NOT deleted (they're left
  orphaned but harmless). Cleanup is intentionally out of scope — drop them
  later if disk pressure demands it.
- All non-`HMIS_MONTHLY` SL datasets and their dataValues remain in place.
- The 50k cap covers 36 months × 40 indicators × ~35 best-fit facilities.
  Distribution is biased by region (Oromia 1.7×), tier (SH 6× vs HP 0.4×),
  and programme seasonality (malaria peaks in Jul-Aug).

## Apply

After `docker compose up -d db dhis2` and a healthy `/api/ping`:

```bash
bash scripts/restore.sh                                  # SL demo dump
docker compose up -d dhis2                               # migrations
python3 scripts/seed_ethiopia.py                         # Ethiopia overlay
bash scripts/verify.sh                                   # API surface check
curl -u admin:district -X POST http://127.0.0.1:8080/api/resourceTables/analytics
```

The script is stdlib-only (`urllib`, `json`, `hashlib`, `random`) — no extra
Python deps. Seed is read from `../_shared/entity-model.yaml::random_seed`, so
every regenerated source agrees on the same RNG stream.
