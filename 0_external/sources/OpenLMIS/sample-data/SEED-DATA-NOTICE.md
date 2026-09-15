# eLMIS seed data — not included in the public repository

The large demo dump for this source (`elmis_historical_data_simulated.sql.gz`,
236 MB gzipped / 1.5 GB uncompressed) is **intentionally excluded** from the
published repo (size). Without it this source starts as an empty Postgres, so the
pipeline has nothing to ingest and the supply dashboards show no data for it.

To populate it locally, place the dump in this folder and run
`bash ../scripts/restore.sh` (or `bundle/scripts/sources-up.sh up elmis`, which
restores it only if the source DB is empty).

Unlike the other sources there is **no synthesizer** for eLMIS — the dump is the
only way to populate it. It is a *historical extract* (a `reference` + `history`
star, not a live OpenLMIS operational schema), so there is no source application
that could regenerate it here.
