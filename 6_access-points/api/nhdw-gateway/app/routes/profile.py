"""profile.py — the country profile, served to the browser.

WHY THIS EXISTS. Everything that makes this deployment be about Ethiopia used to
be a literal in a .tsx file: the masthead, the hero headline, the region list,
the globe's centroid. Swapping country meant editing four SPAs. This route makes
that content DATA, read from a profile directory on the host, so a swap is a
different directory rather than a different build.

WHAT A PROFILE IS. Three layers with three very different swap costs:

    presentation   copy decks + geography + branding   seconds, no restart
    appsec         people, roles, scopes, policy       ~a minute (seed step 7)
    data           source replica payloads             a full pipeline run

Only the PRESENTATION layer is served here — it is the one the browser reads at
runtime. The other two are applied by the seed steps and are named in the
manifest only so one profile key resolves all three.

WHERE IT LIVES. `NHDW_PROFILE_DIR` (default /opt/nhdw-profiles) holds one
directory per profile plus a `_shared/` for country-agnostic assets. The active
profile is `NHDW_PROFILE`, or the contents of `<dir>/ACTIVE` when that file
exists — the file wins, because that is what a profile swap writes and it must
not need a pod restart to take effect.

FAIL SOFT, ON PURPOSE. Every endpoint degrades to a usable default rather than
erroring. A dashboard with no masthead is a broken demo; a dashboard whose
masthead says "National Health Data Warehouse" because the profile could not be
read is a working one. The SPAs keep their bundled English as a second net.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, HTTPException, Query, Response

log = logging.getLogger("gateway.profile")
router = APIRouter(prefix="/api/profile", tags=["profile"])

PROFILE_DIR = Path(os.environ.get("NHDW_PROFILE_DIR", "/opt/nhdw-profiles"))
# Which profile is live is STATE, not content, so it lives in its own writable
# directory. Profile content stays mounted read-only — the gateway serves
# profiles and must never be able to edit one, but it does have to be able to
# switch between them.
STATE_DIR = Path(os.environ.get("NHDW_PROFILE_STATE_DIR", "/opt/nhdw-state"))
_DEFAULT_PROFILE = os.environ.get("NHDW_PROFILE", "et-v3")

# Cache with a short TTL rather than forever: a profile swap writes files on the
# host and must show up without bouncing the gateway, but every widget on a page
# asks for the same deck so re-reading per request is waste.
_TTL = float(os.environ.get("NHDW_PROFILE_TTL", "20"))
_cache: dict[str, tuple[float, Any]] = {}
_lock = threading.Lock()


def _cached(key: str, produce):
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < _TTL:
            return hit[1]
    value = produce()
    with _lock:
        _cache[key] = (now, value)
    return value


def invalidate() -> None:
    """Drop the cache. Called by the swap path so a new profile is visible at once."""
    with _lock:
        _cache.clear()


def active_key() -> str:
    """Which profile is live.

    Precedence: the writable state dir, then a pointer shipped alongside the
    profiles, then the env var. A swap writes the first, so it takes effect
    without redeploying the gateway."""
    for pointer in (STATE_DIR / "ACTIVE", PROFILE_DIR / "ACTIVE"):
        try:
            if pointer.is_file():
                name = pointer.read_text(encoding="utf-8").strip()
                if name:
                    return name
        except OSError as exc:                                  # noqa: BLE001
            log.warning("profile: %s unreadable (%s)", pointer, exc)
    return _DEFAULT_PROFILE


def list_profiles() -> list[dict[str, Any]]:
    """Every profile installed on the host, for the console's profile picker."""
    out: list[dict[str, Any]] = []
    try:
        entries = sorted(p for p in PROFILE_DIR.iterdir()
                         if p.is_dir() and not p.name.startswith("_"))
    except OSError:
        return out
    for entry in entries:
        manifest = _read_manifest(entry.name)
        if manifest.get("_fallback"):
            continue                        # a directory with no manifest is not a profile
        out.append({
            "key": entry.name,
            "label": manifest.get("label") or entry.name,
            "country": (manifest.get("country") or {}).get("name"),
            "revision": manifest.get("revision"),
            "has_geo": (entry / "geo").is_dir(),
            "has_copy": (entry / "copy").is_dir(),
            "has_reference": (entry / "reference.json").is_file(),
        })
    return out


def set_active(key: str) -> None:
    """Point the deployment at another profile. Writes the pointer and drops the
    cache so the next request serves the new country."""
    if key not in {p["key"] for p in list_profiles()}:
        raise HTTPException(404, f"no profile '{key}' installed")
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    (STATE_DIR / "ACTIVE").write_text(key + "\n", encoding="utf-8")
    invalidate()
    log.info("profile: active profile is now %s", key)


def requested_key(profile: str | None) -> str:
    """The profile a request names, else the active one. A page whose data belongs
    to one country (the Zambia PCT page) asks for that country's geometry and
    reference by key, whatever profile the deployment is showing; only installed
    profiles are served."""
    if profile is None:
        return active_key()
    if not re.fullmatch(r"[a-z0-9-]{1,32}", profile) or profile not in {
            p["key"] for p in list_profiles()}:
        raise HTTPException(404, f"no profile '{profile}' installed")
    return profile


def _safe_join(base: Path, *parts: str) -> Path:
    """Resolve under `base` and refuse to escape it. These paths come from URLs
    and from a manifest on disk, so '../../etc/passwd' has to be impossible
    rather than merely unlikely."""
    target = (base / Path(*parts)).resolve()
    root = base.resolve()
    if root != target and root not in target.parents:
        raise HTTPException(400, "path escapes the profile directory")
    return target


# ── manifest ────────────────────────────────────────────────────────────────

def _read_manifest(key: str) -> dict[str, Any]:
    path = _safe_join(PROFILE_DIR, key, "profile.yaml")
    if not path.is_file():
        log.warning("profile: no manifest at %s — serving the built-in default", path)
        return _fallback_manifest(key)
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception as exc:                                    # noqa: BLE001
        log.error("profile: manifest %s is unreadable (%s)", path, exc)
        return _fallback_manifest(key)
    data.setdefault("key", key)
    return data


def _fallback_manifest(key: str) -> dict[str, Any]:
    """Enough structure that every placeholder resolves to SOMETHING. A missing
    profile must degrade to a plain, un-branded warehouse — never to {braces} on
    screen."""
    return {
        "key": key, "label": "Default", "_fallback": True,
        "country": {"name": "", "official_name": "", "adjective": "", "iso2": "", "iso3": ""},
        "ministry": {"abbr": "", "name": "Ministry of Health", "native_name": ""},
        "platform": {"name": "National Health Data Warehouse", "abbr": "NHDW",
                     "native_name": ""},
        "geography": {"levels": [
            {"code": "admin1", "singular": "Region", "plural": "Regions"},
            {"code": "admin2", "singular": "District", "plural": "Districts"},
        ]},
        "brand": {"accent": "#0374b8"},
        "locale": {"default": "en", "fiscal_calendar": "gregorian"},
    }


# ── geometry facts, DERIVED ─────────────────────────────────────────────────

def _geo_facts(key: str, manifest: dict[str, Any]) -> dict[str, Any]:
    """Bounding box, centroid and the globe's opening rotation, computed from the
    admin-1 geometry the profile already ships.

    Deriving instead of configuring removes three numbers a profile author would
    otherwise have to look up and could get wrong — and, more importantly, three
    numbers that could silently disagree with the polygons they claim to
    describe."""
    rel = (manifest.get("geography") or {}).get("admin1")
    if not rel:
        return {}
    path = _safe_join(PROFILE_DIR, key, *Path(rel).parts)
    if not path.is_file():
        log.warning("profile: admin1 geometry missing at %s", path)
        return {}
    try:
        geo = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:                                    # noqa: BLE001
        log.error("profile: admin1 geometry unreadable (%s)", exc)
        return {}

    min_x = min_y = float("inf")
    max_x = max_y = float("-inf")
    names: list[str] = []
    for feature in geo.get("features") or []:
        props = feature.get("properties") or {}
        name = props.get("name") or props.get("NAME") or props.get("shapeName")
        if name:
            names.append(str(name))
        geom = feature.get("geometry") or {}
        rings: list = []
        if geom.get("type") == "Polygon":
            rings = geom.get("coordinates") or []
        elif geom.get("type") == "MultiPolygon":
            for poly in geom.get("coordinates") or []:
                rings.extend(poly)
        for ring in rings:
            for point in ring:
                if not isinstance(point, (list, tuple)) or len(point) < 2:
                    continue
                x, y = float(point[0]), float(point[1])
                min_x = min(min_x, x); max_x = max(max_x, x)
                min_y = min(min_y, y); max_y = max(max_y, y)

    if min_x == float("inf"):
        return {}
    return {
        "bbox": [min_x, min_y, max_x, max_y],
        # bbox centre, not a population-weighted centroid: this positions a map
        # marker and an opening rotation, where "roughly the middle" is right.
        "centroid": [(min_x + max_x) / 2, (min_y + max_y) / 2],
        # The globe starts with the country facing the viewer; its rotation is
        # simply the centre longitude.
        "globe_rotation_deg": (min_x + max_x) / 2,
        "admin1_names": sorted(names),
        "admin1_count": len(names),
    }


# ── placeholder resolution ──────────────────────────────────────────────────

_PLACEHOLDER = re.compile(r"\{([a-z0-9_]+(?:\.[a-z0-9_]+)*)\}", re.I)


def _lookup(ctx: dict[str, Any], dotted: str) -> str | None:
    """Resolve `country.name` against the manifest, plus a few computed keys the
    copy decks need (`geography.admin1.count`, `..._lower`) so a deck can write
    a whole sentence without the SPA assembling it."""
    parts = dotted.split(".")

    if parts[0] == "geography" and len(parts) == 3:
        level_code, field = parts[1], parts[2]
        levels = (ctx.get("geography") or {}).get("levels") or []
        level = next((l for l in levels if l.get("code") == level_code), None)
        if level is None:
            return None
        if field == "count":
            # Reference data first, geometry only as a fallback. A boundary file
            # may carry polygons that are not administrative units — Ethiopia's
            # admin-1 set has a "Contested" feature — so counting features would
            # put "15 regions" into copy that should say 14.
            counts = (ctx.get("reference") or {}).get("counts") or {}
            authoritative = counts.get(level_code)
            if authoritative:
                return str(authoritative)
            return str((ctx.get("geo_facts") or {}).get("admin1_count") or "")
        base_field = field[:-6] if field.endswith("_lower") else field
        value = level.get(base_field)
        if value is None:
            return None
        return str(value).lower() if field.endswith("_lower") else str(value)

    node: Any = ctx
    for part in parts:
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return None if isinstance(node, (dict, list)) else str(node)


def _resolve(value: Any, ctx: dict[str, Any]) -> Any:
    """Walk a copy deck and fill every {placeholder}. An unresolved one is left
    as-is rather than blanked: a visible `{country.name}` in a review build is a
    bug report; a silent empty string is a mystery."""
    if isinstance(value, str):
        def sub(match: re.Match) -> str:
            found = _lookup(ctx, match.group(1))
            if found is None:
                log.debug("profile: unresolved placeholder %s", match.group(0))
                return match.group(0)
            return found
        return _PLACEHOLDER.sub(sub, value)
    if isinstance(value, list):
        return [_resolve(v, ctx) for v in value]
    if isinstance(value, dict):
        return {k: _resolve(v, ctx) for k, v in value.items() if k != "_note"}
    return value


def _read_reference(key: str) -> dict[str, Any]:
    """The compiled reference set, built by bundle/scripts/build-profile.py from
    the entity model. Absent in a hand-made profile, which is fine — copy then
    falls back to the geometry count."""
    path = _safe_join(PROFILE_DIR, key, "reference.json")
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:                                    # noqa: BLE001
        log.error("profile: reference.json unreadable (%s)", exc)
        return {}


def _manifest_with_facts(key: str) -> dict[str, Any]:
    manifest = _read_manifest(key)
    manifest["geo_facts"] = _geo_facts(key, manifest)
    # Available to the placeholder resolver so copy can state real counts.
    manifest["reference"] = _read_reference(key)
    return manifest


# ── routes ──────────────────────────────────────────────────────────────────

@router.get("")
async def get_profile() -> dict[str, Any]:
    """The active profile: identity, geography vocabulary, brand, and the derived
    geometry facts. Public by design — it is the masthead, not a secret."""
    key = active_key()
    manifest = _cached(f"manifest:{key}", lambda: _manifest_with_facts(key))
    # `layers` names the appsec/data payloads, which the browser has no use for;
    # `reference` has its own route and would double this response.
    out = {k: v for k, v in manifest.items() if k not in ("layers", "reference")}
    out["active"] = key
    return out


@router.get("/installed")
async def get_installed() -> dict[str, Any]:
    """What this host could switch to. Read-only; switching is a demo-control
    action, not something an unauthenticated caller can do."""
    return {"active": active_key(), "profiles": list_profiles()}


@router.get("/copy/{surface}")
async def get_copy(surface: str) -> dict[str, Any]:
    """A resolved copy deck. `surface` is a dashboard name (public, internal-bi,
    admin, workshop) or `common`."""
    if not re.fullmatch(r"[a-z0-9-]{1,32}", surface):
        raise HTTPException(400, "bad surface name")
    key = active_key()

    def produce() -> dict[str, Any]:
        manifest = _manifest_with_facts(key)
        path = _safe_join(PROFILE_DIR, key, "copy", f"{surface}.json")
        if not path.is_file():
            return {}
        try:
            deck = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:                                # noqa: BLE001
            log.error("profile: copy deck %s unreadable (%s)", path, exc)
            return {}
        return _resolve(deck, manifest)

    return _cached(f"copy:{key}:{surface}", produce)


@router.get("/geo/{name}")
async def get_geo(name: str, profile: str | None = Query(None)) -> Response:
    """A boundary file. Served from the profile, falling back to `_shared/` so
    country-agnostic geometry (the world land mask) is stored once."""
    if not re.fullmatch(r"[a-z0-9._-]{1,64}\.geojson", name, re.I):
        raise HTTPException(400, "bad geometry name")
    key = requested_key(profile)
    for candidate in (_safe_join(PROFILE_DIR, key, "geo", name),
                      _safe_join(PROFILE_DIR, "_shared", name)):
        if candidate.is_file():
            return Response(
                content=candidate.read_bytes(),
                media_type="application/geo+json",
                # Geometry is large and changes only with the profile; the key is
                # in the ETag so a swap busts it.
                headers={"Cache-Control": "public, max-age=300",
                         "ETag": f'W/"{key}-{name}-{candidate.stat().st_mtime_ns}"'},
            )
    raise HTTPException(404, f"no geometry {name} in profile {key}")


def catalog_disabled() -> list[tuple[str, str]]:
    """What the active profile turns off, as (kind, scope_id) pairs.

    A country profile carries `catalog.yaml`:

        disable:
          widget:
            - id: ov-act-first-woredas
              why: Zambia reports at district grain; there is no woreda level
          page:
            - id: internal-bi/some-page

    `why` is required by convention and rendered nowhere — it exists so the next
    person reading the file learns why a widget is missing instead of assuming
    it broke.

    Only DISABLE is expressible, deliberately. The override seam the gateway
    applies this through can only subtract visibility, and an `enable` here
    would be a second, weaker grant path competing with the role model. A widget
    that should appear for one country and not another is listed in the catalog
    for everyone and disabled by the profiles it does not suit."""
    key = active_key()

    def produce() -> list[tuple[str, str]]:
        path = _safe_join(PROFILE_DIR, key, "catalog.yaml")
        if not path.is_file():
            return []
        try:
            doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except Exception as exc:                                # noqa: BLE001
            log.error("profile: catalog.yaml unreadable (%s)", exc)
            return []
        pairs: list[tuple[str, str]] = []
        valid = {"dashboard", "page", "section", "widget", "placement"}
        for kind, entries in (doc.get("disable") or {}).items():
            if kind not in valid:
                log.warning("profile: catalog.yaml has unknown kind %r — ignored", kind)
                continue
            for e in entries or []:
                scope_id = e.get("id") if isinstance(e, dict) else e
                if scope_id:
                    pairs.append((kind, str(scope_id)))
        return pairs

    return _cached(f"catalog:{key}", produce)


@router.get("/catalog")
async def get_catalog_layer() -> dict[str, Any]:
    """What this profile turns off, so the admin surface can show WHY a widget
    is absent rather than leaving someone hunting a bug."""
    key = active_key()
    path = _safe_join(PROFILE_DIR, key, "catalog.yaml")
    doc: dict[str, Any] = {}
    if path.is_file():
        try:
            doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except Exception:                                       # noqa: BLE001
            doc = {}
    return {"active": key, "disable": doc.get("disable") or {},
            "count": len(catalog_disabled())}


@router.get("/reference")
async def get_reference(profile: str | None = Query(None)) -> dict[str, Any]:
    """Regions, programmes, diseases and commodities — the tables the SPAs used
    to declare THREE times each (reference.ts, biApp.ts, and again with
    coordinates in the Control Tower's plan.ts) while the warehouse already held
    the authoritative copy.

    Served from the profile's entity model, so there is one source and the SPA
    copies can be deleted."""
    key = requested_key(profile)

    def produce() -> dict[str, Any]:
        built = _read_reference(key)
        if built:
            return built
        # No prebuilt reference: derive what we can from the geometry so the
        # region filter still populates.
        facts = _manifest_with_facts(key).get("geo_facts") or {}
        names = facts.get("admin1_names") or []
        return {"regions": [{"code": n[:2].upper(), "name": n} for n in names],
                "programmes": [], "diseases": [], "commodities": [],
                "_derived_from": "admin1 geometry (no reference.json in profile)"}

    return _cached(f"reference:{key}", produce)
