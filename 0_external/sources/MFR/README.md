# MFR · Master Facility Registry (FHIR R4 replica)

Authoritative Organization registry for Ethiopian health facilities. The real
MFR is run by FMoH and serves ~63,805 facilities at
`https://mfr.moh.gov.et/fhir`. This replica stands up an offline-friendly
HAPI FHIR R4 JPA server seeded from the shared sample
(`0_external/sources/_shared/_build/`) so every other layer of the warehouse can join
on the same facility/woreda/zone/region identifiers.

## What's inside

```
0_external/sources/MFR/
├── docker-compose.yml      HAPI FHIR R4 (hapiproject/hapi:v8.0.0)
├── .env / .env.example     MFR_DATA_DIR · MFR_FHIR_BASE · MFR_DB_PASSWORD
├── data/                   H2 + Lucene index volumes (gitignored)
└── scripts/
    ├── wait-for-ready.sh   blocks on /metadata until HAPI is up
    ├── seed.py             POSTs every Organization resource (idempotent)
    └── verify.sh           per-type counts + sample dump
```

## Start

```bash
cp .env.example .env
docker compose up -d
bash scripts/wait-for-ready.sh
python3 scripts/seed.py          # ~30 s for ~1,616 Organization resources
bash scripts/verify.sh
```

The HAPI server is exposed at `127.0.0.1:8093` on the host and as
`nhdw-mfr-fhir:8080` inside the `nhdw_net` Docker network (so dlt-MFR
reaches it by container name).

## Identifier model

Five Organization levels, each with its own MFR identifier system URI so
the ingestor can cross-walk to other sources unambiguously:

| Level    | System URI                              | Example identifier value     |
| -------- | --------------------------------------- | ---------------------------- |
| Country  | `https://mfr.moh.gov.et/country-id`    | `ET`                         |
| Region   | `https://mfr.moh.gov.et/region-id`     | `ET-OR` (Oromia)             |
| Zone     | `https://mfr.moh.gov.et/zone-id`       | `ZON-OR-a1b2c3`              |
| Woreda   | `https://mfr.moh.gov.et/woreda-id`     | `WOR-OR-9f8e7d`              |
| Facility | `https://mfr.moh.gov.et/facility-id`   | `FAC-OR-HC-1a2b3c`           |

Every facility additionally carries:
- `https://mfr.moh.gov.et/upstream-id` — the real MFR ID when the synthetic
  sample picked a real facility (~95% of rows); absent when the row is a
  topped-up synthetic to round out a region/tier strata.
- An `extension` with `valueCode: public | private | ngo | military`
  encoding ownership.

`partOf` references cascade `facility → woreda → zone → region → country`
so a single FHIR `_revinclude` returns the full path.

## Why HAPI

- Real MFR is FHIR R4 → ingestor wiring matches production exactly.
- HAPI is the reference open-source implementation · 0 config beyond env vars.
- H2 backing store is fine for ~1,600 resources; demo loads in seconds.
- For a real demo at higher scale, swap H2 → Postgres in `docker-compose.yml`
  via the `spring.datasource.url` env var and the same image.

## Verify

```
─── total Organizations ───
  total: 1616

─── by type ───
  country  1
  region   14
  zone     134
  woreda   574
  hp       320
  hc       240
  ...
```

If counts disagree with `_shared/_build/{regions,zones,woredas,facilities}`,
re-run `seed.py` — it uses conditional creates (`ifNoneExist`) and is safe to
re-run anytime.
