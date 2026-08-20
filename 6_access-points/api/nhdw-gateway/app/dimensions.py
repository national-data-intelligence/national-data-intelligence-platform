"""dimensions.py — the SINGLE source of truth for scope / ABAC dimensions.

One registry replaces four previously-duplicated (and drifted) maps:
  - routes/reports.py::_DIM_COLS         dimension -> mart columns
  - routes/exports.py::_DIMCOLS          dimension -> mart columns (had DRIFTED
                                         from reports: missing woreda_name/
                                         program/facility candidates)
  - permissions.py::_FILTER_SCOPE_KIND   filter_id -> dimension
  - opa.py context keys                  dimension -> OPA input.context key

A scope dimension is a data-partitioning axis a user (or role) can be narrowed
on. `mart` was retired here (dead: loaded into user_scope but never enforced —
which mart you may query is an OPA subject/granularity decision, not a row
filter). Row enforcement maps a dimension to the FIRST matching mart column
present in the target table.

Kernel rule (constitution §1/§8): dimension knowledge lives HERE and nowhere
else. Anything that needs a dimension->column, filter->dimension, or
dimension->OPA-key mapping imports it from this module — never re-declares it.
"""
from __future__ import annotations

# Canonical row-filterable scope dimensions. Order is stable for iteration.
DIMENSIONS: tuple[str, ...] = ("geography", "programme", "facility")

# dimension -> ordered candidate mart columns (first present in the mart wins).
# SUPERSET of the former reports/_DIM_COLS and exports/_DIMCOLS, so every generic
# row_filter application resolves against the identical, most-complete list
# (the drift between the two copies is what this consolidation fixes). The dead
# plural keys (geographies/programmes/programs/facilities) are dropped: OPA only
# ever emits singular dimension keys in row_filter, so they never matched.
DIM_COLUMNS: dict[str, list[str]] = {
    "geography": ["region_id", "region", "woreda_uid", "woreda_name"],
    "programme": ["programme_id", "programme", "program", "program_id"],
    "facility":  ["facility_id", "facility_uid", "facility"],
    # 'commodity' is a PLAIN UI narrowing dimension (like 'period'): it is
    # deliberately ABSENT from FILTER_DIMENSION below (no role/user scope caps it —
    # users are never commodity-scoped), so it is always wildcard and narrows only
    # via the fetchers' commodity_col WHERE + the generic row_filter application.
    "commodity": ["commodity_name", "commodity", "commodity_code"],
}

# filter-catalog id -> the scope dimension it narrows (role_scope.dimension /
# user_scope.kind). Used to cap a filter's pickable values by role_scope ∩ user_scope.
# Includes the non-mart-row dimensions (artifact_tier, workshop_group) that scope
# workshop widgets — they cap filter values but are NOT in DIM_COLUMNS (they never
# become an OPA row_filter against a mart column). A filter absent here (e.g.
# 'period', 'project') has no scope dimension → always wildcard.
FILTER_DIMENSION: dict[str, str] = {
    "region":         "geography",
    "woreda":         "geography",
    "programme":      "programme",
    "facility":       "facility",
    "artifact_tier":  "artifact_tier",
    "workshop_group": "workshop_group",
}

# dimension -> the key OPA expects in input.context (historical plural spellings
# preserved for the policy contract in common.rego).
OPA_CONTEXT_KEY: dict[str, str] = {
    "geography": "geographies",
    "programme": "programs",
    "facility":  "facilities",
}


def columns_for(dimension: str) -> list[str]:
    """Candidate mart columns for a row_filter dimension (first present wins).
    Unknown key falls back to [dimension] — matches the prior `.get(dim, [dim])`
    behaviour so callers need no None-handling."""
    return DIM_COLUMNS.get(dimension, [dimension])
