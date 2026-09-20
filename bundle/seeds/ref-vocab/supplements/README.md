# Vocabulary supplements

CSVs here merge into `source_to_concept_map` when `build_vocab.py` runs — for mappings
the entity model cannot know:

* **live-derived source codes** — e.g. mBrana's native commodity codes (`EPI-009` …)
  and any DHIS2 dataElement codes beyond the indicator list (the parity harness
  reports uncovered codes; add them here).
* **curated standard-vocabulary subsets** — the ICD-10 and ATC slices NHDW references.
  Curate from the official WHO sources; never bulk-import a full distribution and
  never guess codes from memory.

Column shape (targets are symbolic — numeric ids are resolved by the generator):

    source_code,source_vocabulary_id,source_code_description,target_vocabulary_id,target_concept_code

The source_vocabulary_id must exist in build_vocab.py's vocabulary list; the target
(vocabulary, code) must be a known concept or the build fails loudly.
