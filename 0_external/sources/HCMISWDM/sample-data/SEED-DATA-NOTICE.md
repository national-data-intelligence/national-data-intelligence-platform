# HCMISWDM seed data — not included in the public repository

The large demo dump for this source (the `.sql` / `.bak` / `.pgdump` file) is
**intentionally excluded** from the published repo (size). Without it this source
starts empty, so the pipeline has nothing to ingest and the dashboards show no
data for it.

To populate it locally, place the source's restore artifact in this folder
(the restore script in `../restore*` / `bundle/scripts/sources-up.sh` picks it up
and loads it only if the source DB is empty), or regenerate it by running the
source system and `bundle/scripts/pack.sh`.
