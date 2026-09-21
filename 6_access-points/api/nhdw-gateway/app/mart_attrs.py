"""mart_attrs cache — the catalog that enriches OPA input on every
mart read.

OPA's per-role policies branch on `subject` codes (PT, HP, FAC, PRD, PRG)
plus `data_class`, `granularity`, and `sensitivity`. The on-the-wire
table name (e.g. `marts.bi_hiv_cascade_total`) carries none of those, so
the gateway joins on this catalog before calling OPA. If a mart is not
cataloged, the request is denied under OPA_ENFORCE=true.

Cache is loaded on first lookup and invalidated explicitly by the admin
UI after a mart_attrs CRUD operation. Process restart picks up edits
otherwise.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

from . import ops_db

log = logging.getLogger("gateway.mart_attrs")


@dataclass(frozen=True)
class MartAttrs:
    schema: str
    table: str
    subject: str               # PT | HP | FAC | PRD | PRG  → OPA resource.subject
    data_class: str            # DC.ENC | DC.PRO | …
    granularity: str           # raw | aggregate | deidentified
    sensitivity: str           # default | restricted | privileged

    @property
    def opa_attributes(self) -> dict[str, str]:
        """Spread-ready dict for opa.decide(attributes=...)."""
        return {
            "data_class":  self.data_class,
            "granularity": self.granularity,
            "sensitivity": self.sensitivity,
        }


@dataclass(frozen=True)
class ColumnClass:
    """One classified column (ops_perm.column_classification). The store is a
    DENYLIST: a column with no row is 'default' (visible); rows exist only for
    columns needing protection, keyed on the REAL dbt relation names."""
    column: str
    sensitivity: str           # default | restricted | privileged
    mask_class: str            # none | drop | hash | partial | generalize | tokenize
    pii: bool


class MartAttrsMissing(Exception):
    """Raised when a mart isn't cataloged. Means we cannot enforce OPA on it."""
    def __init__(self, schema: str, table: str):
        super().__init__(f"mart_attrs catalog has no entry for {schema}.{table} — "
                         f"add a row to bundle/seed-pack/app/security/mart_attrs.yaml")
        self.schema = schema
        self.table  = table


_cache: dict[tuple[str, str], MartAttrs] | None = None


async def _load_cache() -> dict[tuple[str, str], MartAttrs]:
    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT schema_name, table_name, subject, data_class,
                   granularity, default_sensitivity
            FROM ops_perm.mart_attrs
        """)
    return {
        (r["schema_name"], r["table_name"]): MartAttrs(
            schema=r["schema_name"], table=r["table_name"],
            subject=r["subject"], data_class=r["data_class"],
            granularity=r["granularity"], sensitivity=r["default_sensitivity"],
        ) for r in rows
    }


async def lookup(schema: str, table: str) -> MartAttrs:
    """Cache-first lookup. Raises MartAttrsMissing if absent."""
    global _cache
    if _cache is None:
        _cache = await _load_cache()
        log.info("mart_attrs cache loaded · %d entries", len(_cache))
    hit = _cache.get((schema, table))
    if not hit:
        raise MartAttrsMissing(schema, table)
    return hit


async def catalog_keys() -> set[tuple[str, str]]:
    """Every (schema, table) the catalog knows — i.e. the set of marts that are
    actually QUERYABLE (a mart absent here is 403'd by the ad-hoc SQL executor
    and get_mart under OPA_ENFORCE). This is the single source of truth the mart
    browser should list, so it never offers an uncataloged intermediate table."""
    global _cache
    if _cache is None:
        _cache = await _load_cache()
        log.info("mart_attrs cache loaded · %d entries", len(_cache))
    return set(_cache.keys())


_col_cache: dict[tuple[str, str], dict[str, ColumnClass]] | None = None


async def _load_col_cache() -> dict[tuple[str, str], dict[str, ColumnClass]]:
    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT schema_name, table_name, column_name, sensitivity, mask_class, pii
            FROM ops_perm.column_classification
        """)
    out: dict[tuple[str, str], dict[str, ColumnClass]] = {}
    for r in rows:
        out.setdefault((r["schema_name"], r["table_name"]), {})[r["column_name"]] = \
            ColumnClass(column=r["column_name"], sensitivity=r["sensitivity"],
                        mask_class=r["mask_class"], pii=r["pii"])
    return out


async def columns_for_mart(schema: str, table: str) -> dict[str, ColumnClass]:
    """The CLASSIFIED columns of one relation ({} when none are classified —
    denylist semantics). The caller pushes {name: sensitivity} into OPA input
    so the policy decides which land in masked_columns, then applies each
    masked column's mask_class via app/masking.py.

    The schema is normalised to its bare name first. Callers hold it in two
    forms — the bare `bi_supply` that ops_perm.column_classification keys on,
    and the Trino-qualified `marts.bi_supply` used to build SQL — and because
    this is a denylist, a key that does not match returns {} and every
    classified column is then served in the clear. That is a fail-OPEN, and it
    is silent, so the normalisation happens here rather than being each
    caller's job to remember."""
    global _col_cache
    if _col_cache is None:
        _col_cache = await _load_col_cache()
        log.info("column_classification cache loaded · %d relations · %d columns",
                 len(_col_cache), sum(len(v) for v in _col_cache.values()))
    bare = schema.rsplit(".", 1)[-1] if "." in schema else schema
    if bare != schema:
        log.warning("columns_for_mart: catalog-qualified schema %r normalised "
                    "to %r — pass the bare schema name", schema, bare)
    return _col_cache.get((bare, table), {})


async def invalidate() -> None:
    """Force the next lookup to re-read the catalogs (mart attrs AND column
    classification). Called by the admin UI after a CRUD operation and by the
    seed reload path."""
    global _cache, _col_cache
    _cache = None
    _col_cache = None
    log.info("mart_attrs + column_classification caches invalidated")


# ── startup self-test ────────────────────────────────────────────────
@dataclass
class SelfTestCase:
    """A (role, mart) pair with an EXPECTED allow/deny verdict.
    The gateway runs these on startup and fails fast under OPA_ENFORCE=true
    if OPA disagrees with the catalog — protects against catalog ↔ rego
    policy drift."""
    role: str
    schema: str
    table: str
    expect_allow: bool
    note: str = ""


# Per-role positive/negative coverage. Every one of the 14 roles is
# present so a catalog ↔ rego drift on ANY role trips the startup gate
# before we serve traffic.
SELF_TESTS: list[SelfTestCase] = [
    SelfTestCase("R-DEC", "marts", "bi_programme_hiv_cascade_total", True,
                 "R-DEC reads PRG aggregate"),
    SelfTestCase("R-DEC", "vault_business", "enc_patient_visit", False,
                 "R-DEC must NOT read raw PT encounters"),

    SelfTestCase("R-PUB-ANON", "marts", "bi_service_flagship_attainment", True,
                 "R-PUB-ANON reads public programme indicators"),
    SelfTestCase("R-PUB-ANON", "marts", "bi_safety_aefi_lineage", False,
                 "R-PUB-ANON must NOT read AEFI restricted lineage"),

    SelfTestCase("R-CONS-ANA", "marts", "bi_programme_hiv_cascade_total", True,
                 "R-CONS-ANA reads PRG aggregate"),
    SelfTestCase("R-CONS-ANA", "vault_business", "enc_patient_visit", False,
                 "R-CONS-ANA must NOT read raw PT encounters (deid only)"),

    SelfTestCase("R-PROD-SUBMIT", "marts", "bi_programme_hiv_cascade_total", False,
                 "R-PROD-SUBMIT is write-only on submissions; mart read denied"),

    SelfTestCase("R-OPS-ENG", "marts", "bi_programme_hiv_cascade_total", False,
                 "R-OPS-ENG operates on infra; data-plane denied"),
    SelfTestCase("R-OPS-SEC", "marts", "bi_programme_hiv_cascade_total", False,
                 "R-OPS-SEC reads audit/observability; production marts denied"),

    # ── R-SUPER reads everything ─────────────────────────────────────
    SelfTestCase("R-SUPER", "marts", "bi_programme_hiv_cascade_total", True,
                 "R-SUPER wildcard access"),
    SelfTestCase("R-SUPER", "vault_business", "enc_patient_visit", True,
                 "R-SUPER reads even raw PT encounters"),

    # ── Intentional deny-all roles: confirm they default-deny ────────
    SelfTestCase("R-STEW",      "marts", "bi_programme_hiv_cascade_total", False,
                 "R-STEW intentional deny-all on data plane"),
    SelfTestCase("R-OPS-ADM",   "marts", "bi_programme_hiv_cascade_total", False,
                 "R-OPS-ADM intentional deny-all on data plane"),
    SelfTestCase("R-CONS-SCI",  "marts", "bi_programme_hiv_cascade_total", False,
                 "R-CONS-SCI uses workshop sandbox; prod marts denied"),
    SelfTestCase("R-CONS-RES",  "marts", "bi_programme_hiv_cascade_total", False,
                 "R-CONS-RES requires k-anon public marts (not in v1)"),
    SelfTestCase("R-CONS-PRT",  "marts", "bi_programme_hiv_cascade_total", True,
                 "R-CONS-PRT (partner/donor) reads PRG aggregate — DC.PRO+DC.CAT "
                 "aggregate grant, #69/I-8 (was deny-all husk); raw/deid stay denied"),
    SelfTestCase("R-CONS-PRT",  "vault_business", "enc_patient_visit", False,
                 "R-CONS-PRT aggregate grant is scoped — raw PT encounters denied"),
    SelfTestCase("R-PROD-CLIN", "marts", "bi_programme_hiv_cascade_total", False,
                 "R-PROD-CLIN uses SMART-on-FHIR per-patient; bulk denied"),
]


async def run_self_test(opa_module) -> list[tuple[SelfTestCase, bool, str]]:
    """Returns [(case, observed_allow, reason)]. Caller decides whether
    to fail-fast (production) or just log warnings (dev)."""
    from .auth import UserCtx
    results: list[tuple[SelfTestCase, bool, str]] = []
    for case in SELF_TESTS:
        try:
            attrs = await lookup(case.schema, case.table)
        except MartAttrsMissing as e:
            results.append((case, False, f"catalog miss: {e}"))
            continue
        u = UserCtx(
            kc_sub="00000000-0000-0000-0000-000000000000",
            username="self-test", realm="test",
            roles=[case.role], primary_role=case.role,
            geographies=[], programs=[], purpose_of_use="public-health",
            email="", full_name="",
        )
        d = await opa_module.decide(
            u, action="read", resource=attrs.subject,
            attributes=attrs.opa_attributes,
        )
        observed = bool(d.allow) and not d.degraded
        # Under OPA_ENFORCE=false the gateway flips deny → allow with a
        # trailing tag; treat that as the real deny when judging the test.
        if "[enforce-off]" in (d.reason or "") or "[advisory]" in (d.reason or ""):
            observed = False
        results.append((case, observed, d.reason or ""))
    return results


# ── startup MASKING self-test ────────────────────────────────────────
@dataclass
class MaskSelfTestCase:
    """A (role, classified-columns) pair with the EXPECTED masked set from the
    live OPA. Protects against reveal-set ↔ rego drift the same way the
    allow/deny matrix above protects the table-level policy."""
    role: str
    idp_trust: str
    columns: dict[str, str]            # {column: sensitivity} as the PEP sends it
    expect_masked: list[str]           # sorted
    note: str = ""


_MASK_FIXTURE = {"lat": "restricted", "lng": "restricted", "patient_id": "privileged"}

MASK_SELF_TESTS: list[MaskSelfTestCase] = [
    MaskSelfTestCase("R-CONS-ANA", "high", _MASK_FIXTURE, ["patient_id"],
                     "analyst reveals restricted (maps plot GPS); privileged masked"),
    MaskSelfTestCase("R-PD-HIV", "high", _MASK_FIXTURE, ["patient_id"],
                     "R-DEC alias inherits the r-dec reveal set"),
    MaskSelfTestCase("R-PUB-ANON", "high", _MASK_FIXTURE,
                     ["lat", "lng", "patient_id"],
                     "no reveal grant — every classified column masked"),
    MaskSelfTestCase("R-OPS-SEC", "high", _MASK_FIXTURE, [],
                     "security officer reveals restricted AND privileged"),
    MaskSelfTestCase("R-SUPER", "high", _MASK_FIXTURE, [],
                     "wildcard reveals everything"),
    MaskSelfTestCase("R-CONS-ANA", "low", _MASK_FIXTURE,
                     ["lat", "lng", "patient_id"],
                     "low-trust identity never sees a classified column clear"),
]


async def run_mask_self_test(opa_module) -> list[tuple[MaskSelfTestCase, list[str], str]]:
    """Returns [(case, observed_masked_sorted, reason)]. Uses a fixture mart the
    analyst role can read (the verdict is irrelevant — masked_columns is
    emitted on any non-trust-denied decision)."""
    from .auth import UserCtx
    results: list[tuple[MaskSelfTestCase, list[str], str]] = []
    for case in MASK_SELF_TESTS:
        u = UserCtx(
            kc_sub="00000000-0000-0000-0000-000000000000",
            username="mask-self-test", realm="test",
            roles=[case.role], primary_role=case.role,
            geographies=[], programs=[], purpose_of_use="public-health",
            email="", full_name="", idp_trust=case.idp_trust,
        )
        d = await opa_module.decide(
            u, action="read", resource="PRD",
            attributes={"data_class": "DC.STK", "granularity": "aggregate",
                        "sensitivity": "default"},
            columns=case.columns,
        )
        if d.degraded:
            results.append((case, ["<opa-degraded>"], d.reason or ""))
            continue
        results.append((case, sorted(d.masked_columns), d.reason or ""))
    return results
