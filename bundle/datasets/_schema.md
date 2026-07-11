# Dataset YAML schema

All schemas in this folder MUST validate against the structure below.
A future Phase-3.x task adds a `compile.py` (mirroring `bundle/roles/`)
that enforces this in CI.

```yaml
dataset:
  # Identification ────────────────────────────────────────────────
  slug: <kebab-case-identifier>      # required, globally unique
  title: <human title>               # required
  family: mart-internal | mart-public | producer-inbox | producer-payload | source-replica | feature-store
                                      # required

  # Where the data lives (skip for producer-payload — the payload is in
  # transit at upload time, not yet at a physical address) ─────────
  source_system: DHIS2 | HCMIS | EthioEMR | mBrana | submitted | derived
  schema:        <db schema or null>
  table:         <table or view name or null>

  # Information governance ────────────────────────────────────────
  data_classes: [DC.ENC, DC.CND, DC.OBS, DC.ORD, DC.STK, DC.DOC,
                 DC.SPC, DC.COV, DC.PRF, DC.PRO]  # any subset; see docs/user-roles.md §2.2
  sensitivity:   default | HIV | mental-health | GBV | reproductive
                 | genetic | substance-use | biometric              # peak label
  subjects:      [PT, HP, FAC, PRD]                                # see docs/user-roles.md §2.1
  contains_phi:  true | false
  pii_fields:    [list of explicit identifier columns; [] if none]

  # Access control ────────────────────────────────────────────────
  owner_role:    R-* role id                                       # accountable owner
  visible_to:    [R-* role ids that may read]
  writable_by:   [R-* role ids that may write]
  k_anon_min:    integer or null                                   # for mart-public
  retention_days: integer

  # Shape ─────────────────────────────────────────────────────────
  format:        csv | parquet | fhir-bundle | json | sql-view | sql-table
  description:   <paragraph>

  # Audit trail ───────────────────────────────────────────────────
  last_reviewed_at: YYYY-MM-DD
  last_reviewer:    <username or role id>
```

## Loader contract

The Submission Portal and Internal BI load these via a small Python helper:

```python
def load_datasets(dir: Path) -> list[Dataset]: ...
```

The helper:
- Iterates `*.yaml` in lexical order
- Validates each entry against the schema above (Phase-3.x: jsonschema)
- Surfaces a `Dataset` dataclass with all fields populated
- Errors out on duplicate slugs

Until the validator ships, callers MUST defensively check required fields.
