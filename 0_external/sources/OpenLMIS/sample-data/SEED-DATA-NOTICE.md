# eLMIS seed data — not included in the public repository

The large demo dump for this source (`elmis_historical_data_simulated.sql.gz`,
236 MB gzipped / 1.5 GB uncompressed) is **intentionally excluded** from the
published repo (size).

If the dump is present here it is restored verbatim. If it is **absent** (a fresh
public checkout, any host without the private dump), `up_elmis` falls back to
`scripts/synthesize.sh`, which builds an **equivalent Zambian supply history**
from the committed entity model (`bundle/seeds/entity-model/entity-model.zm.yaml`)
and the real anonymised facility registry (`facilities_zm_elmis.json`, 2807
facilities) — deterministically (seeded). So the supply / PCT dashboards are
populated with no external artefact; the pipeline, vault and marts run unchanged.

The dump, when available, is the higher-fidelity option (the true historical
extract). The synthesizer is the reproducible fallback — there is no live
OpenLMIS application here that could regenerate the real archive.
