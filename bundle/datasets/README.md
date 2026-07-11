# Dataset registry — canonical PAP for datasets

Each YAML in this folder describes one **dataset** — a stable, named
producer or consumer surface that some role group reads from or writes
to. The registry is the single source of truth for:

- **Submission Portal** — `/api/datasets` lists the producer datasets that
  the signed-in user's role may write to. `format` + `schema_hint` come
  from here, not from the portal's source.
- **Internal BI Dataset Catalog** — overlays sensitivity and `writable_by`
  badges on top of the `pg_description` text it reads from the live DB.
- **Marts dbt project** — model `description:` is mirrored here so reviews
  can compare "what dbt says" against "what the registry says".
- **OPA / role YAMLs** — Phase 3+ Rego policies join on `dataset.slug` →
  dataset-level visibility / sensitivity decisions.
- **Consent gate (Phase 3.5)** — `contains_phi`, `data_classes`, and
  `subjects` drive which marts have to JOIN the consent table.

The schema is documented in [`_schema.md`](_schema.md). Every dataset entry
MUST validate against it before the change merges.

## Naming

- One file per dataset: `<slug>.yaml` where slug is kebab-case.
- Slug is global — same slug in two files is a hard error.
- `family` orients the dataset:
    - `mart-internal`   — bi_facility, bi_supply, bi_epi
    - `mart-public`     — bi_public (k-anon)
    - `producer-inbox`  — nhdw_landing.submission_inbox (and similar)
    - `producer-payload`— what producers UPLOAD (HMIS monthly, etc.)
    - `source-replica`  — 0_external/sources/ replicas (Phase 4 reference)
    - `feature-store`   — Phase 6 ML feature surfaces

## Change procedure

1. Author or edit the YAML.
2. Bump `last_reviewed_at` + `last_reviewer` on every change.
3. If the dataset's *sensitivity* or `contains_phi` changes, the steward
   (R-STEW) MUST approve — record their username in a PR comment.
4. Update any downstream config that hard-codes the slug (Submission
   Portal datasets endpoint will read it automatically; OPA Rego policy
   may need a regenerate).

## Phase-3 status

Phase 3 (this folder's introduction) is **registry-only** — the entries
exist and are consumed by the Submission Portal + Internal BI. The full
OPA / consent / runtime joins land in Phase 3.5.

Initial entries cover:

| Slug                                  | Family             | Where it lives                                    |
|---------------------------------------|--------------------|---------------------------------------------------|
| `facility-distribution-internal`      | mart-internal      | `bi_facility.bi_facility_distribution`            |
| `facility-distribution-public`        | mart-public        | `bi_public.bi_facility_distribution_public`       |
| `facility-with-region-base`           | mart-internal      | `bi_facility.bi_dhis2_facility_with_region`       |
| `submission-inbox`                    | producer-inbox     | `nhdw_landing.submission_inbox`                   |
| `hmis-monthly`                        | producer-payload   | submitted via Submission Portal                   |
| `epi-vaccinations`                    | producer-payload   | submitted via Submission Portal                   |
| `stock-availability`                  | producer-payload   | submitted via Submission Portal                   |
