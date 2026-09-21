"""permissions.py — DB-side resolver for the 4-axis control model.

Computes the DASHBOARD / PAGE / WIDGET / FILTER decisions for the caller
by joining the ops_perm.* grant tables against their assigned roles. OPA
handles the orthogonal mart-level data decisions; see mart_attrs.py +
routes/marts.py.

Single-call shape:
    spec = await resolve_dashboard(dashboard_id, user, pool)

Returns a `ResolvedDashboard` tree the SPA renders verbatim. Widgets and
filters the user can't see are NEVER in the returned tree → defense in
depth at the rendering layer.

For multi-role users (user has >1 active row in ops_perm.user_role):
    - dashboard/widget access: UNION (if any role grants it, allowed)
    - filter allowed_values:    UNION (if any role allows a value, allowed)
    - role_capability:          UNION
This is the default `combine_strategy='union'` on ops_perm.role.

`allowed_values` semantic:
    NULL        → wildcard (all canonical values from the filter catalog)
    []          → denied (filter not rendered even if listed)
    ["A","B"]   → explicit subset
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field, asdict
from typing import Any, Optional

import asyncpg

from .auth import UserCtx
from .fetchers import widget_supports
from .dimensions import FILTER_DIMENSION


def _decode_jsonb(v):
    """asyncpg returns jsonb as raw string — decode to Python.
    Returns the value as-is if already decoded."""
    if v is None or isinstance(v, (dict, list)):
        return v
    if isinstance(v, (bytes, bytearray)):
        v = v.decode("utf-8")
    if isinstance(v, str):
        try:
            return json.loads(v)
        except (json.JSONDecodeError, ValueError):
            return None
    return v

log = logging.getLogger("gateway.permissions")


# ── data classes returned to the SPA ──────────────────────────────────
@dataclass
class ResolvedFilter:
    id: str
    title: str
    source: str                              # static | mart_query | ops_db_query
    allowed_values: list[str] | None         # None = wildcard, [] should never appear (we drop them)
    values_url: str                          # GET this to resolve the actual values
                                             # (intersects allowed_values with the live catalog)


@dataclass
class ResolvedWidget:
    id: str
    title: str
    kind: str
    placement: str                           # 'page.section' | 'chrome.fab' | 'chrome.sidebar' | 'chrome.topbar'
    requires: dict[str, Any] | None          # mart-level OPA payload (or null for synthetic widgets)
    local_filters: list[ResolvedFilter] = field(default_factory=list)
    data_url: str = ""                       # GET this with filter params to fetch the widget's data
    section_id: str | None = None            # which band on the page (null = page default band)
    col_span: int = 6                        # grid tracks the widget spans (of the section's `columns`)
    row_span: int = 1
    # reacts_to = named filter/bus dims the widget re-renders on (master-detail
    # selections etc.). (The runtime-plugin fields — source='plugin',
    # component_type, bundle_url — were retired 2026-07-06 with the plugin
    # system; every widget is now a foldered build-time module.)
    reacts_to: list[str] | None = None
    # supports = which global-filter dims the widget's BOUND mart can honestly
    # apply ({"geography": bool, "programme": bool, "period": bool}, derived
    # from its Fetcher's geo/prog/period column bindings). None for UNBOUND
    # widgets — the spec route OMITS the key entirely (host: missing supports
    # = never-hide).
    supports: dict[str, bool] | None = None


@dataclass
class ResolvedSection:
    id: str
    title: str
    eyebrow: str | None = None
    description: str | None = None
    ordering: int = 0
    columns: int = 12                        # grid track count for the widget layout
    dense: bool = True                       # grid-auto-flow: dense (survivors fill removed-widget gaps)
    widgets: list[ResolvedWidget] = field(default_factory=list)


@dataclass
class ResolvedPage:
    id: str
    title: str
    ordering: int
    global_filters: list[ResolvedFilter] = field(default_factory=list)
    widgets: list[ResolvedWidget] = field(default_factory=list)   # page-scoped widgets (flat; back-compat)
    sections: list[ResolvedSection] = field(default_factory=list) # the same widgets, grouped into layout bands


@dataclass
class ResolvedDashboard:
    id: str
    title: str
    description: str
    pages: list[ResolvedPage] = field(default_factory=list)
    widgets: list[ResolvedWidget] = field(default_factory=list)   # dashboard-scoped; SPA picks per-page placement
    capabilities: list[str] = field(default_factory=list)
    role_codes: list[str] = field(default_factory=list)
    user_realm: str = ""


# ── core resolver ─────────────────────────────────────────────────────
async def _active_role_ids(conn: asyncpg.Connection, kc_sub: str) -> list[int]:
    """All currently-active role ids assigned to the user. Empty list means
    the user only has the implicit `primary_role` claim from Keycloak; we
    fall back to looking that up by code."""
    rows = await conn.fetch("""
        SELECT role_id FROM ops_perm.user_role
        WHERE kc_sub = $1::uuid
          AND is_active = true
          AND (expires_at IS NULL OR expires_at > now())
    """, kc_sub)
    return [r["role_id"] for r in rows]


async def _resolve_role_ids(conn: asyncpg.Connection, user: UserCtx) -> list[int]:
    """Determine the effective role-id set for `user`.

    Single source of role assignment (#51): ops_perm.user_role. The JWT realm-role
    claim is IDENTITY only, NEVER a grant — so a brand-new Keycloak/JIT user gets
    NOTHING until explicitly granted a role (secure-by-default), rather than
    silently inheriting one from a token claim.

    ONE exception — a LOUD, audited R-SUPER break-glass: if a super-admin has no
    user_role row (e.g. a mis-seeded boot), honour the JWT R-SUPER claim so the
    operator can log in and repair the grant, instead of a total lockout. Seed a
    user_role row for the super-admin to silence it. (Normal boots seed one, so
    this never fires; remove it for strict single-source if the break-glass is
    handled another way.)
    """
    if user.kc_sub:
        rids = await _active_role_ids(conn, user.kc_sub)
        if rids:
            return rids
    # Sanctioned tier exception — the ANONYMOUS public visitor (auth.py builds
    # it with kc_sub="" and roles=["R-PUB-ANON"] when no credential is
    # presented). A pseudo-identity CANNOT have a user_role row by
    # construction, so "user_role is authoritative" (#51) does not apply to
    # it: resolve R-PUB-ANON from the role catalogue directly. Everything the
    # tier can reach is still bounded by R-PUB-ANON's own grants (public
    # widgets, aggregate/k>=5 marts only).
    if not user.kc_sub and user.primary_role == "R-PUB-ANON":
        rec = await conn.fetchrow("SELECT id FROM ops_perm.role WHERE code = 'R-PUB-ANON'")
        if rec:
            return [rec["id"]]
    if user.primary_role == "R-SUPER":
        rec = await conn.fetchrow("SELECT id FROM ops_perm.role WHERE code = 'R-SUPER'")
        if rec:
            log.warning("BREAK-GLASS: R-SUPER user=%s has no ops_perm.user_role row — "
                        "granting from the JWT claim. Seed a user_role row to remove this.",
                        user.username)
            return [rec["id"]]
    log.info("resolver: user=%s (primary=%s) has no ops_perm.user_role assignment — "
             "no access (secure-by-default; grant a role via admin / access-request)",
             user.username, user.primary_role)
    return []


async def _dashboard_accessible(conn: asyncpg.Connection,
                                 dashboard_id: str, role_ids: list[int]) -> bool:
    if not role_ids:
        return False
    rec = await conn.fetchrow("""
        SELECT 1 FROM ops_perm.role_dashboard
        WHERE dashboard_id = $1 AND role_id = ANY($2::int[])
        LIMIT 1
    """, dashboard_id, role_ids)
    return rec is not None


async def _resolve_page_filters(conn, page_id: str, role_ids: list[int],
                                 user_scope: dict | None = None,
                                 role_scope: dict | None = None) -> list[ResolvedFilter]:
    """The page's global-filter bar: WHICH filters it offers comes from the
    STRUCTURAL ops_perm.page_filter (role-independent); the value cap for each is
    role_scope ∩ user_scope (#50b). A filter whose cap intersects to [] is dropped.
    Replaces the retired role_global_filter (which conflated structure + caps)."""
    if not role_ids:
        return []
    rows = await conn.fetch("""
        SELECT pf.filter_id AS id, f.title, f.source
        FROM ops_perm.page_filter pf
        JOIN ops_perm.filter f ON f.id = pf.filter_id
        WHERE pf.page_id = $1
        ORDER BY pf.ordering, pf.filter_id
    """, page_id)
    out: list[ResolvedFilter] = []
    for r in rows:
        allowed = _cap_for_filter(r["id"], role_scope, user_scope)
        if allowed == []:                                    # empty intersection → drop
            continue
        out.append(ResolvedFilter(
            id=r["id"], title=r["title"], source=r["source"],
            allowed_values=allowed,
            values_url=f"/api/permissions/filter/{r['id']}/values?page_id={page_id}",
        ))
    return out


async def _resolve_widget_filters(conn, dashboard_id: str, widget_id: str,
                                   role_ids: list[int],
                                   page_id: str | None = None,
                                   role_scope: dict | None = None,
                                   user_scope: dict | None = None) -> list[ResolvedFilter]:
    """The widget's LOCAL filters: WHICH from the structural ops_perm.widget_filter
    (role-independent), value cap = role_scope ∩ user_scope (#50b). Replaces the
    retired role_widget_filter."""
    if not role_ids:
        return []
    if page_id is not None:
        rows = await conn.fetch("""
            SELECT wf.filter_id AS id, f.title, f.source
            FROM ops_perm.widget_filter wf
            JOIN ops_perm.filter f ON f.id = wf.filter_id
            WHERE wf.dashboard_id = $1 AND wf.page_id = $2 AND wf.widget_id = $3
            ORDER BY wf.ordering, wf.filter_id
        """, dashboard_id, page_id, widget_id)
    else:
        rows = await conn.fetch("""
            SELECT DISTINCT wf.filter_id AS id, f.title, f.source
            FROM ops_perm.widget_filter wf
            JOIN ops_perm.filter f ON f.id = wf.filter_id
            WHERE wf.dashboard_id = $1 AND wf.widget_id = $2
            ORDER BY wf.filter_id
        """, dashboard_id, widget_id)
    out: list[ResolvedFilter] = []
    for r in rows:
        allowed = _cap_for_filter(r["id"], role_scope, user_scope)
        if allowed == []:
            continue
        out.append(ResolvedFilter(
            id=r["id"], title=r["title"], source=r["source"],
            allowed_values=allowed,
            values_url=f"/api/permissions/filter/{r['id']}/values"
                       f"?dashboard_id={dashboard_id}&widget_id={widget_id}"
                       + (f"&page_id={page_id}" if page_id else ""),
        ))
    return out


# (_union_allowed removed #50b — the role_global_filter/role_widget_filter multi-role
#  value-union it served is gone; role caps now come from role_scope via _cap_for_filter.)


# ── user_scope (granted_scope) enforcement ────────────────────────────
# ops_identity.user_scope tightens the role-derived filter scope for a specific
# user (e.g. an access-request approved with region=Oromia). It NEVER widens the
# role scope — it intersects. The filter_id → dimension map lives in the single
# dimension registry (app/dimensions.py::FILTER_DIMENSION), imported above.


async def _load_user_scope(conn, kc_sub: str | None) -> dict[str, set[str]]:
    """The user's granted data scope, {kind: {values}}. A kind absent here means
    'no user-level restriction on that dimension' (the role scope stands)."""
    if not kc_sub:
        return {}
    rows = await conn.fetch("""
        SELECT kind, value FROM ops_identity.user_scope
        WHERE kc_sub = $1::uuid AND (expires_at IS NULL OR expires_at > now())
    """, kc_sub)
    out: dict[str, set[str]] = {}
    for r in rows:
        out.setdefault(r["kind"], set()).add(r["value"])
    return out


async def _load_role_scope(conn, role_ids: list[int]) -> dict[str, set[str]]:
    """Role-level DEFAULT data scope (ops_perm.role_scope), combined across the
    caller's roles. Returns {dimension: {values}}.

    A dimension is RESTRICTED only if EVERY one of the caller's roles restricts it
    (access is additive across roles → if any role grants a dimension unrestricted,
    the union is unrestricted). A dimension ABSENT from the result = wildcard.
    This replaces role_global_filter / role_widget_filter as the source of the
    role-side value cap (#50b); user_scope still tightens it per-user."""
    if not role_ids:
        return {}
    rows = await conn.fetch("""
        SELECT role_id, dimension, value FROM ops_perm.role_scope
        WHERE role_id = ANY($1::int[])
    """, role_ids)
    by_role: dict[int, dict[str, set[str]]] = {}
    for r in rows:
        by_role.setdefault(r["role_id"], {}).setdefault(r["dimension"], set()).add(r["value"])
    result: dict[str, set[str]] = {}
    all_dims = {d for rd in by_role.values() for d in rd}
    for dim in all_dims:
        # restricted only if ALL roles restrict it; any unrestricted role → wildcard.
        if any(dim not in by_role.get(rid, {}) for rid in role_ids):
            continue
        vals: set[str] = set()
        for rid in role_ids:
            vals |= by_role[rid][dim]
        result[dim] = vals
    return result


async def _load_catalog_overrides(conn) -> dict[tuple[str, str], dict]:
    """Runtime catalog overrides keyed by (kind, scope_id). Applied ON TOP of
    grants at resolve time — an override can only SUBTRACT visibility
    (enabled=false) or re-layout (placement overrides); it never grants.

    TWO layers, composed here:

      1. the COUNTRY PROFILE's catalog layer — widgets that do not fit this
         country's shape. Ethiopia reports at woreda grain and Zambia does not,
         so a woreda table is a husk under a Zambian profile rather than an
         empty-looking bug. Read from the profile directory, never persisted.

      2. the OPERATOR's overrides (#47, ops_perm.catalog_override) — what a human
         turned off in Dashboard-Control.

    The operator WINS on conflict. Their toggles are a deliberate decision about
    this deployment and must survive a profile swap; the profile is a default
    about the country. Keeping the profile layer out of the table is what makes
    that possible — writing it there would stomp the human's choice, and the
    table's own contract says it is never written by the seed path.

    Because both layers can only subtract, composing them cannot widen access,
    which is why this needed no schema change and no new grant path."""
    out: dict[tuple[str, str], dict] = {}

    # layer 1 — the profile's shape
    for kind, scope_id in _profile_disabled():
        out[(kind, scope_id)] = {"enabled": False, "overrides": {},
                                 "source": "profile"}

    # layer 2 — the operator, last so it overwrites
    rows = await conn.fetch(
        "SELECT kind, scope_id, enabled, overrides FROM ops_perm.catalog_override")
    for r in rows:
        ov = _decode_jsonb(r["overrides"])
        out[(r["kind"], r["scope_id"])] = {
            "enabled": r["enabled"],
            "overrides": ov if isinstance(ov, dict) else {},
            "source": "operator",
        }
    return out


def _profile_disabled() -> list[tuple[str, str]]:
    """(kind, scope_id) pairs the active country profile turns off.

    Never raises: a profile with no catalog layer, or an unreadable one, simply
    disables nothing. Losing a country's widget tailoring shows a husk; failing
    the resolve shows an empty dashboard, and the first is far better."""
    try:
        from .routes import profile as profile_route
        return profile_route.catalog_disabled()
    except Exception:                                           # noqa: BLE001
        log.debug("catalog: profile layer unavailable", exc_info=True)
        return []


def _ov_disabled(ov: dict[tuple[str, str], dict] | None, kind: str, scope_id: str) -> bool:
    if not ov:
        return False
    rec = ov.get((kind, scope_id))
    return bool(rec) and not rec["enabled"]


def _cap_for_filter(filter_id: str,
                    role_scope: dict[str, set[str]] | None,
                    user_scope: dict[str, set[str]] | None) -> list[str] | None:
    """Allowed values for a filter = role_scope[dim] ∩ user_scope[dim], where
    dim = FILTER_DIMENSION[filter_id]. Both are ceilings; the result NEVER widens.
      None  = wildcard (dim unrestricted by BOTH, or the filter has no scope
              dimension — e.g. 'period' — so it is always pickable-in-full).
      []    = denied (empty intersection → filter dropped by the caller).
      [...] = the intersected subset."""
    dim = FILTER_DIMENSION.get(filter_id)
    if not dim:
        return None                                   # non-scope filter → wildcard
    rs = (role_scope or {}).get(dim)                  # None/absent = role wildcard
    us = (user_scope or {}).get(dim)                  # None/absent = user wildcard
    if not rs and not us:
        return None
    if not rs:
        return sorted(us)
    if not us:
        return sorted(rs)
    return sorted(set(rs) & set(us))


# (_apply_user_scope removed #50b — superseded by _cap_for_filter, which folds the
#  role cap (role_scope) and the user tighten (user_scope) in one intersection.)


async def effective_user_scope(conn, user: UserCtx) -> dict[str, set[str]]:
    """The caller's DB `user_scope`, further NARROWED by a PAT's declared scope
    (`user.token_scope`) when present. A PAT can only ADD restrictions — the
    result is always ⊆ the owner's scope (never widens). Interactive principals
    (token_scope is None) get their DB scope unchanged."""
    scope = await _load_user_scope(conn, user.kc_sub)
    ts = getattr(user, "token_scope", None)
    if ts:
        for kind, vals in ts.items():
            vset = {str(v) for v in vals}
            if not vset:
                continue
            scope[kind] = (scope[kind] & vset) if kind in scope else vset
    return scope


async def user_is_row_scoped(pool, user: UserCtx) -> bool:
    """True if the caller's EFFECTIVE scope (DB scope ∩ any PAT narrowing) carries
    a geography/programme/facility restriction.

    The DIRECT-DATA endpoints — the raw-SQL editor (/api/sql/execute) and
    /api/marts/{schema}/{table} — cannot generically row-filter arbitrary SQL,
    so per plan §B6 they are restricted to callers WITHOUT a row-scope limit
    (national analysts, stewards, operators, admins). A scoped user gets 403 and
    must use the governed widgets / reports / exports, which apply their
    row_filter. Binds PATs: a key whose owner is scoped — OR a key narrowed to a
    scope itself — is row-scoped and denied here too."""
    if not user.kc_sub:
        return False
    async with pool.acquire() as c:
        scope = await effective_user_scope(c, user)
    return any(scope.get(k) for k in ("geography", "programme", "facility"))


async def _resolve_dashboard_widgets(conn, dashboard_id: str,
                                      role_ids: list[int],
                                      role_scope: dict | None = None,
                                      user_scope: dict | None = None,
                                      ov: dict | None = None) -> list[ResolvedWidget]:
    """All widgets the role(s) can access on this dashboard, regardless of
    which page renders them. The SPA decides per-page placement; the
    resolver only decides access."""
    if not role_ids:
        return []
    rows = await conn.fetch("""
        SELECT DISTINCT w.id, w.title, w.kind, w.placement, w.requires
        FROM ops_perm.role_widget rw
        JOIN ops_perm.widget w ON w.id = rw.widget_id
        WHERE rw.dashboard_id = $1 AND rw.role_id = ANY($2::int[])
          AND w.orphaned_at IS NULL              -- soft-orphaned (#47) hidden
        ORDER BY w.id
    """, dashboard_id, role_ids)
    out: list[ResolvedWidget] = []
    for r in rows:
        if _ov_disabled(ov, "widget", r["id"]):          # operator-disabled (#47)
            continue
        local_filters = await _resolve_widget_filters(conn, dashboard_id, r["id"], role_ids,
                                                       role_scope=role_scope, user_scope=user_scope)
        requires = _decode_jsonb(r["requires"])
        out.append(ResolvedWidget(
            id=r["id"], title=r["title"], kind=r["kind"],
            placement=r.get("placement", "page.section") if hasattr(r, "get") else r["placement"],
            requires=requires if isinstance(requires, dict) else None,
            local_filters=local_filters,
            data_url=f"/api/permissions/widget/{r['id']}/data?dashboard_id={dashboard_id}",
            supports=widget_supports(r["id"]),
        ))
    return out


async def _resolve_page_widgets(conn, dashboard_id: str, page_id: str,
                                 role_ids: list[int],
                                 role_scope: dict | None = None,
                                 user_scope: dict | None = None,
                                 ov: dict | None = None) -> list[ResolvedWidget]:
    """Widgets the role(s) can access ON THIS PAGE (page-scoped grant)."""
    if not role_ids:
        return []
    rows = await conn.fetch("""
        SELECT DISTINCT w.id, w.title, w.kind, w.placement, w.requires,
               w.source, w.component_type, w.reacts_to,
               pw.section_id, pw.col_span, pw.row_span, pw.ordering AS pw_ordering
        FROM ops_perm.role_widget rw
        JOIN ops_perm.widget w ON w.id = rw.widget_id
        LEFT JOIN ops_perm.page_widget pw
               ON pw.page_id = rw.page_id AND pw.widget_id = rw.widget_id
        WHERE rw.dashboard_id = $1 AND rw.page_id = $2 AND rw.role_id = ANY($3::int[])
          AND w.orphaned_at IS NULL              -- soft-orphaned (#47) hidden
        ORDER BY pw.ordering NULLS LAST, w.id
    """, dashboard_id, page_id, role_ids)
    out: list[tuple[int, int, ResolvedWidget]] = []       # (eff_ordering, tiebreak, w)
    for i, r in enumerate(rows):
        # Operator overrides (#47): widget-wide or per-placement disable, and
        # placement re-layout ({col_span,row_span,ordering,section_id}).
        if _ov_disabled(ov, "widget", r["id"]) or \
           _ov_disabled(ov, "placement", f"{page_id}::{r['id']}"):
            continue
        pov = (ov or {}).get(("placement", f"{page_id}::{r['id']}"), {}).get("overrides", {})
        local_filters = await _resolve_widget_filters(conn, dashboard_id, r["id"],
                                                       role_ids, page_id=page_id,
                                                       role_scope=role_scope, user_scope=user_scope)
        requires = _decode_jsonb(r["requires"])
        eff_ord = pov.get("ordering")
        if eff_ord is None:
            eff_ord = r["pw_ordering"] if r["pw_ordering"] is not None else 10**9
        out.append((int(eff_ord), i, ResolvedWidget(
            id=r["id"], title=r["title"], kind=r["kind"], placement=r["placement"],
            requires=requires if isinstance(requires, dict) else None,
            local_filters=local_filters,
            data_url=(f"/api/permissions/widget/{r['id']}/data"
                      f"?dashboard_id={dashboard_id}&page_id={page_id}"),
            section_id=pov.get("section_id", r["section_id"]),
            col_span=int(pov["col_span"]) if pov.get("col_span") is not None
                     else (r["col_span"] if r["col_span"] is not None else 6),
            row_span=int(pov["row_span"]) if pov.get("row_span") is not None
                     else (r["row_span"] if r["row_span"] is not None else 1),
            reacts_to=(_decode_jsonb(r["reacts_to"]) if r["reacts_to"] else None),
            supports=widget_supports(r["id"]),
        )))
    out.sort(key=lambda t: (t[0], t[1]))                  # honor ordering overrides
    return [w for _, _, w in out]


async def _resolve_page_sections(conn, page_id: str,
                                 page_widgets: list[ResolvedWidget],
                                 ov: dict | None = None) -> list[ResolvedSection]:
    """Group the page's granted widgets into their cataloged layout bands.
    Non-chrome widgets with no section_id fall into an implicit default band so
    a page always renders even before its sections are cataloged. A section with
    no granted widgets is dropped (collapse)."""
    secs = await conn.fetch("""
        SELECT id, title, eyebrow, description, ordering, columns, dense
        FROM ops_perm.section WHERE page_id = $1 ORDER BY ordering, id
    """, page_id)
    by_section: dict[str | None, list[ResolvedWidget]] = {}
    for w in page_widgets:
        if str(w.placement or "").startswith("chrome."):
            continue                              # chrome widgets render outside the grid
        by_section.setdefault(w.section_id, []).append(w)

    out: list[ResolvedSection] = []
    for s in secs:
        if _ov_disabled(ov, "section", s["id"]):
            by_section.pop(s["id"], None)         # operator-disabled band: HIDE its
            continue                              # widgets (no fall-through) (#47)
        ws = by_section.pop(s["id"], [])
        if not ws:
            continue                              # collapse an all-denied band
        out.append(ResolvedSection(
            id=s["id"], title=s["title"], eyebrow=s["eyebrow"],
            description=s["description"], ordering=s["ordering"],
            columns=s["columns"], dense=s["dense"], widgets=ws))
    # Any remaining widgets (no/unknown section) → one implicit default band last.
    leftovers = [w for ws in by_section.values() for w in ws]
    if leftovers:
        out.append(ResolvedSection(
            id=f"{page_id}/_default", title="", ordering=9999, widgets=leftovers))
    return out


async def _role_capabilities(conn, role_ids: list[int]) -> list[str]:
    if not role_ids:
        return []
    rows = await conn.fetch("""
        SELECT DISTINCT capability_code FROM ops_perm.role_capability
        WHERE role_id = ANY($1::int[]) ORDER BY capability_code
    """, role_ids)
    return [r["capability_code"] for r in rows]


async def _role_codes(conn, role_ids: list[int]) -> list[str]:
    if not role_ids:
        return []
    rows = await conn.fetch(
        "SELECT code FROM ops_perm.role WHERE id = ANY($1::int[]) ORDER BY code",
        role_ids)
    return [r["code"] for r in rows]


# ── public entry point ────────────────────────────────────────────────
async def resolve_dashboard(dashboard_id: str, user: UserCtx,
                             pool: asyncpg.Pool) -> ResolvedDashboard | None:
    """Returns the fully-resolved dashboard spec for the user.
    Returns None if the user has no role granting access to the dashboard."""
    async with pool.acquire() as conn:
        role_ids = await _resolve_role_ids(conn, user)
        if not await _dashboard_accessible(conn, dashboard_id, role_ids):
            log.info("resolve_dashboard: deny user=%s dashboard=%s — no role grants",
                     user.username, dashboard_id)
            return None

        dash = await conn.fetchrow("""
            SELECT id, title, description FROM ops_perm.dashboard WHERE id = $1
        """, dashboard_id)
        if not dash:
            return None

        pages = await conn.fetch("""
            SELECT id, title, ordering FROM ops_perm.page
            WHERE dashboard_id = $1 ORDER BY ordering, id
        """, dashboard_id)

        # Scope inputs for the filter caps (#50b): role_scope = role-level default
        # (was role_global_filter/role_widget_filter), user_scope tightens per-user.
        role_scope = await _load_role_scope(conn, role_ids)
        user_scope = await _load_user_scope(conn, user.kc_sub)

        # Runtime operator overrides (#47) — applied AFTER grants (subtract-only).
        ov = await _load_catalog_overrides(conn)
        if _ov_disabled(ov, "dashboard", dashboard_id):
            log.info("resolve_dashboard: %s disabled by catalog_override", dashboard_id)
            return None

        widgets = await _resolve_dashboard_widgets(conn, dashboard_id, role_ids,
                                                   role_scope=role_scope, user_scope=user_scope,
                                                   ov=ov)

        out_pages: list[ResolvedPage] = []
        for p in pages:
            if _ov_disabled(ov, "page", p["id"]):
                continue                          # operator-disabled page (#47)
            page_widgets   = await _resolve_page_widgets(conn, dashboard_id, p["id"], role_ids,
                                                         role_scope=role_scope, user_scope=user_scope,
                                                         ov=ov)
            sections       = await _resolve_page_sections(conn, p["id"], page_widgets, ov=ov)
            # Page-tab elision (#52): drop a page with no visible content sections
            # so an empty/unusable tab never renders for a role that can't see any
            # of its widgets. Mirrors the empty-section collapse in
            # _resolve_page_sections and the widget/section "never in the tree"
            # defense-in-depth (resolve_dashboard docstring). A page whose only
            # widgets are chrome (e.g. just the global-filter) yields no sections
            # → also elided.
            if not sections:
                continue
            global_filters = await _resolve_page_filters(conn, p["id"], role_ids,
                                                         user_scope, role_scope)
            out_pages.append(ResolvedPage(
                id=p["id"], title=p["title"], ordering=p["ordering"],
                global_filters=global_filters, widgets=page_widgets,
                sections=sections,
            ))

        return ResolvedDashboard(
            id=dash["id"], title=dash["title"], description=dash["description"] or "",
            pages=out_pages,
            widgets=widgets,
            capabilities=await _role_capabilities(conn, role_ids),
            role_codes=await _role_codes(conn, role_ids),
            user_realm=user.realm,
        )


# ── filter-value resolution ────────────────────────────────────────────
async def filter_values(filter_id: str, user: UserCtx, pool: asyncpg.Pool,
                         *, page_id: str | None = None,
                         dashboard_id: str | None = None,
                         widget_id: str | None = None) -> dict[str, Any]:
    """Returns the set of values the user is allowed to PICK for this filter.

    The cap = role_scope ∩ user_scope (#50b), keyed by the filter's scope dimension
    (FILTER_DIMENSION), then intersected with the filter catalog's canonical values.
    A filter with no scope dimension (e.g. 'period') is wildcard. page_id/dashboard_id/
    widget_id are retained for the values_url contract but no longer change the cap
    (it is uniform per dimension, not per page/widget).

    Returns: {filter_id, title, source, values: [...], wildcard: bool}.
    """
    async with pool.acquire() as conn:
        role_ids = await _resolve_role_ids(conn, user)
        if not role_ids:
            return {"filter_id": filter_id, "values": [], "wildcard": False,
                    "denied": True, "reason": "no active roles"}

        filt = await conn.fetchrow("""
            SELECT id, title, source, source_ref, static_values
            FROM ops_perm.filter WHERE id = $1
        """, filter_id)
        if not filt:
            return {"filter_id": filter_id, "values": [], "wildcard": False,
                    "denied": True, "reason": "unknown filter"}

        # The allowed value cap is now role_scope ∩ user_scope (#50b), keyed by the
        # filter's scope dimension — uniform per dimension, so page_id/widget_id no
        # longer change it (they remain in the signature for the values_url contract).
        role_scope = await _load_role_scope(conn, role_ids)
        user_scope = await _load_user_scope(conn, user.kc_sub)
        allowed_values = _cap_for_filter(filter_id, role_scope, user_scope)
        canonical = await _canonical_values(conn, filt)

        # Intersect.
        if allowed_values is None:
            values = canonical
            wildcard = True
        elif not allowed_values:
            values = []
            wildcard = False
        else:
            values = [v for v in canonical if v in allowed_values] if canonical else allowed_values
            wildcard = False

        return {
            "filter_id": filter_id,
            "title": filt["title"],
            "source": filt["source"],
            "values": values,
            "wildcard": wildcard,
            "denied": False,
        }


async def _canonical_values(conn, filt: asyncpg.Record) -> list[str]:
    """Return the full canonical value set for a filter catalog row.

    static       → just the static_values list
    mart_query   → SELECT DISTINCT from the source mart (deferred; returns [])
    ops_db_query → SELECT from the ops-db table referenced (deferred; returns [])

    Dynamic sources (mart_query / ops_db_query) need a per-source plugin
    similar to the fetch_source pattern; they currently return [] so the
    UI falls back to its hardcoded values. Static filters cover the demo
    set (period, programme, severity, etc.) entirely.
    """
    if filt["source"] == "static":
        sv = filt["static_values"]
        if isinstance(sv, list):
            return [str(v) for v in sv]
        return []
    log.debug("canonical values for filter %s (%s): dynamic source not yet bound",
              filt["id"], filt["source"])
    return []


# ── widget access verification (for the data-fetch endpoint) ──────────
@dataclass
class WidgetAccess:
    permitted: bool
    widget: dict[str, Any] | None
    dashboard_id: str | None
    requires: dict[str, Any] | None
    allowed_filter_values: dict[str, list[str] | None]    # filter_id → allowed (None = wildcard)
    reason: str = ""


async def check_widget_access(widget_id: str, dashboard_id: str, user: UserCtx,
                               pool: asyncpg.Pool,
                               page_id: str | None = None) -> WidgetAccess:
    """Verify the user has access to `widget_id` on `dashboard_id` and
    return the filter-value constraints. `page_id` is an optional hint
    used to fold in page-global filter scopes (e.g., region locked at
    page level for a regional director)."""
    async with pool.acquire() as conn:
        role_ids = await _resolve_role_ids(conn, user)
        if not role_ids:
            return WidgetAccess(False, None, dashboard_id, None, {}, "no active roles")

        # Widget-grant check. When page_id is supplied it is ENFORCED page-scoped
        # (widget granted on THIS page); without it, falls back to dashboard-level
        # (granted on any page) for back-compat.
        if page_id:
            widget = await conn.fetchrow("""
                SELECT w.id, w.title, w.kind, w.placement, w.requires
                FROM ops_perm.role_widget rw JOIN ops_perm.widget w ON w.id = rw.widget_id
                WHERE rw.dashboard_id = $1 AND rw.page_id = $2 AND rw.widget_id = $3
                  AND rw.role_id = ANY($4::int[])
                  AND w.orphaned_at IS NULL LIMIT 1
            """, dashboard_id, page_id, widget_id, role_ids)
        else:
            widget = await conn.fetchrow("""
                SELECT w.id, w.title, w.kind, w.placement, w.requires
                FROM ops_perm.role_widget rw JOIN ops_perm.widget w ON w.id = rw.widget_id
                WHERE rw.dashboard_id = $1 AND rw.widget_id = $2 AND rw.role_id = ANY($3::int[])
                  AND w.orphaned_at IS NULL
                LIMIT 1
            """, dashboard_id, widget_id, role_ids)
        if not widget:
            return WidgetAccess(False, None, dashboard_id, None, {},
                                f"role does not grant widget {widget_id} on dashboard {dashboard_id}")

        # Operator overrides (#47): a disabled widget/placement is denied at the
        # DATA endpoint too, not just hidden from the spec (defense in depth).
        ov = await _load_catalog_overrides(conn)
        if _ov_disabled(ov, "widget", widget_id) or \
           (page_id and _ov_disabled(ov, "placement", f"{page_id}::{widget_id}")):
            return WidgetAccess(False, None, dashboard_id, None, {},
                                f"widget {widget_id} disabled by operator (catalog_override)")

        # Filters this widget is subject to (#50b): the page's global filters
        # (structural ops_perm.page_filter, when page_id given) + the widget's local
        # filters (ops_perm.widget_filter), each capped by role_scope ∩ user_scope.
        role_scope = await _load_role_scope(conn, role_ids)
        user_scope = await _load_user_scope(conn, user.kc_sub)
        fids: list[str] = []
        if page_id:
            pf = await conn.fetch(
                "SELECT filter_id FROM ops_perm.page_filter WHERE page_id = $1 "
                "ORDER BY ordering, filter_id", page_id)
            fids += [r["filter_id"] for r in pf]
            wf = await conn.fetch(
                "SELECT filter_id FROM ops_perm.widget_filter "
                "WHERE dashboard_id = $1 AND page_id = $2 AND widget_id = $3 "
                "ORDER BY ordering, filter_id", dashboard_id, page_id, widget_id)
        else:
            wf = await conn.fetch(
                "SELECT DISTINCT filter_id FROM ops_perm.widget_filter "
                "WHERE dashboard_id = $1 AND widget_id = $2 ORDER BY filter_id",
                dashboard_id, widget_id)
        fids += [r["filter_id"] for r in wf]
        allowed: dict[str, list[str] | None] = {
            fid: _cap_for_filter(fid, role_scope, user_scope)
            for fid in dict.fromkeys(fids)            # dedupe, preserve order
        }

        requires = _decode_jsonb(widget["requires"])
        return WidgetAccess(
            permitted=True,
            widget={"id": widget["id"], "title": widget["title"],
                    "kind": widget["kind"], "placement": widget["placement"]},
            dashboard_id=dashboard_id,
            requires=requires if isinstance(requires, dict) else None,
            allowed_filter_values=allowed,
        )
