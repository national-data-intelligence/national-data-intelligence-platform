#!/usr/bin/env python3
"""build-profile.py — compile a profile's reference.json from its entity model.

WHY. Regions, programmes, diseases and commodities were declared in the SPAs
THREE times each — `widgets/_shared/reference.ts`, `biApp.ts`, and again with
coordinates in the Control Tower's `ct/data/plan.ts` — while
`entity-model.yaml` already held the authoritative version and the warehouse was
built from it. Three copies of a list that has a source is three chances to
drift, independent of any country swap.

This compiles the one true copy into `reference.json` inside the profile, which
the gateway serves at /api/profile/reference and the SPAs fetch. The hardcoded
tables then have nothing to do and can be deleted.

WHY NOT COUNT THE GEOMETRY. Tempting, and wrong. Ethiopia's admin-1 file has 15
features because one of them is "Contested" — a disputed territory, not a
region. Copy that says "in any of the 15 regions" would be both inaccurate and
tactless. Administrative facts come from the entity model; geometry is only for
drawing.

Usage:
    bundle/scripts/build-profile.py et-v3
    bundle/scripts/build-profile.py et-v3 --entity-model path/to/entity-model.yaml
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[2]
PROFILES = REPO / "bundle" / "profiles"
DEFAULT_ENTITY_MODEL = REPO / "bundle" / "seeds" / "entity-model" / "entity-model.yaml"

# Geometry features that are NOT administrative units. Matched case-insensitively
# against the feature name; keep this list short and justified.
NON_ADMIN_FEATURES = {"contested", "disputed", "no man's land"}


def read_diseases(idsr_seeder: Path) -> list[dict]:
    """Notifiable diseases, lifted from the IDSR source generator.

    They are NOT in the entity model: which diseases a country reports weekly is
    a property of its surveillance system, so the authoritative list lives with
    the source that produces the data. Parsed rather than imported because the
    module pulls in numpy and a seasonality model we do not want to execute just
    to read ten names.

    The generator's DISEASES rows are (code, name, programme, terrain, ...); the
    'climate' flag the dashboards use means "this one moves with weather", which
    is exactly the rows whose terrain driver is malaria/lowland/belt rather than
    flat population."""
    if not idsr_seeder.is_file():
        return []
    import re
    src = idsr_seeder.read_text(encoding="utf-8")
    match = re.search(r"^DISEASES\s*=\s*\[(.*?)^\]", src, re.S | re.M)
    if not match:
        return []
    CLIMATE_TERRAIN = {"malaria", "lowland", "belt"}
    out: list[dict] = []
    for row in re.finditer(r'\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"', match.group(1)):
        code, name, programme, terrain = row.groups()
        out.append({
            "key": code.lower(),
            "code": code,
            "name": name,
            "programme": programme,
            "climate": terrain in CLIMATE_TERRAIN,
        })
    return out


def build_reference(em: dict) -> dict:
    """Project the entity model onto the shape the dashboards want.

    The SPA wants {code, name}; the entity model carries weights, capitals,
    populations and supply-hub assignments it has no use for. Narrow here rather
    than shipping the whole model to the browser."""
    regions = [
        {"code": r["code"], "name": r["name"], "id": r.get("id"),
         "capital": r.get("capital"), "population_mn": r.get("population_mn")}
        for r in em.get("regions") or []
    ]

    # The entity model keys these on `id`; the dashboards speak `code`. Translate
    # once, here, rather than teaching every widget both spellings.
    programmes = [
        {"code": p.get("id"), "name": p.get("name") or p.get("id"),
         "icon": p.get("icon")}
        for p in (em.get("programmes") or []) if isinstance(p, dict)
    ]

    commodities = [
        {"code": c.get("id"), "name": c.get("name"),
         "programme": c.get("programme"), "ven": c.get("ven")}
        for c in (em.get("commodities") or []) if isinstance(c, dict)
    ]

    facility_tiers = [
        {"code": t.get("id"), "name": t.get("name")}
        for t in (em.get("facility_tiers") or []) if isinstance(t, dict)
    ]

    cadres = [
        {"code": c.get("id"), "name": c.get("name"),
         "who_target_per_10k": c.get("who_target_per_10k")}
        for c in (em.get("cadres") or []) if isinstance(c, dict)
    ]

    return {
        "regions": regions,
        "programmes": programmes,
        "commodities": commodities,
        "facility_tiers": facility_tiers,
        "cadres": cadres,
        # filled by main() from the source generator, not the entity model
        "diseases": [],
        "counts": {
            "admin1": len(regions),
            "programmes": len(programmes),
            "commodities": len(commodities),
        },
        "_source": "entity-model.yaml",
        "_note": "Authoritative. Geometry feature counts are NOT used — an admin-1 "
                 "file may carry non-administrative polygons (e.g. contested areas).",
    }


def norm(s: str) -> str:
    """Loose key for matching a region name against a polygon name.

    Two sources name the same place differently and always will: an entity model
    says "Oromia Region" and "Addis Ababa City Administration" where a boundary
    file says "Oromia" and "Addis Ababa". Strip the administrative suffix and the
    punctuation, and they meet."""
    t = "".join(ch if ch.isalnum() else " " for ch in s.lower())
    words = t.split()
    # drop trailing administrative designators, repeatedly: "city administration"
    # is two words, "region" is one.
    SUFFIX = {"region", "city", "administration", "province", "state",
              "county", "district", "governorate", "prefecture", "oblast"}
    while words and words[-1] in SUFFIX:
        words.pop()
    return "".join(words)


def loose(s: str) -> str:
    """Second pass: collapse doubled letters, which is how the same place
    survives two transliterations — Gambella/Gambela, Benishangul/Benshangul.
    Only used when the strict key finds nothing, so it cannot merge two places
    that genuinely differ."""
    out: list[str] = []
    for ch in s:
        if not out or out[-1] != ch:
            out.append(ch)
    return "".join(out)


def link_geometry(profile_dir: Path, reference: dict) -> list[str]:
    """Resolve each region to its polygon and RECORD the mapping on the region.

    The SPA used to do this at runtime with a hand-written normaliser that
    carried a literal `.replace('gambella','gambela')`. Resolving here and
    shipping `geo_name` means the browser matches on an exact string, the hack
    can be deleted, and a mismatch is a build-time warning rather than a blank
    patch on a choropleth during a demo."""
    warnings: list[str] = []
    geo_path = profile_dir / "geo" / "admin1.geojson"
    if not geo_path.is_file():
        return [f"no admin1 geometry at {geo_path}"]
    try:
        geo = json.loads(geo_path.read_text(encoding="utf-8"))
    except Exception as exc:                                    # noqa: BLE001
        return [f"admin1 geometry unreadable: {exc}"]

    non_admin = {norm(n) for n in NON_ADMIN_FEATURES}
    strict: dict[str, str] = {}
    skipped: list[str] = []
    for f in geo.get("features") or []:
        name = (f.get("properties") or {}).get("name")
        if not name:
            continue
        if norm(name) in non_admin:
            skipped.append(name)
            continue
        strict[norm(name)] = name
    fuzzy = {loose(k): v for k, v in strict.items()}

    matched: set[str] = set()
    for region in reference["regions"]:
        key = norm(region["name"])
        hit = strict.get(key) or fuzzy.get(loose(key))
        if hit:
            region["geo_name"] = hit
            matched.add(hit)
        else:
            region["geo_name"] = None
            warnings.append(f"region '{region['name']}' matched no polygon")

    for name in strict.values():
        if name not in matched:
            warnings.append(f"polygon '{name}' matched no region")
    if skipped:
        warnings.append(f"ignored {len(skipped)} non-administrative polygon(s): "
                        + ", ".join(sorted(skipped)))
    return warnings


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("profile", help="profile key, e.g. et-v3")
    ap.add_argument("--entity-model", type=Path, default=DEFAULT_ENTITY_MODEL)
    ap.add_argument("--profiles-dir", type=Path, default=PROFILES)
    ap.add_argument("--idsr-seeder", type=Path,
                    default=REPO / "0_external" / "sources" / "IDSR" / "seed_idsr_dhis2.py",
                    help="source generator that declares the notifiable-disease list")
    args = ap.parse_args()

    profile_dir = args.profiles_dir / args.profile
    if not profile_dir.is_dir():
        print(f"✗ no profile directory at {profile_dir}", file=sys.stderr)
        return 2
    if not args.entity_model.is_file():
        print(f"✗ no entity model at {args.entity_model}", file=sys.stderr)
        return 2

    em = yaml.safe_load(args.entity_model.read_text(encoding="utf-8")) or {}
    reference = build_reference(em)
    reference["diseases"] = read_diseases(args.idsr_seeder)
    reference["counts"]["diseases"] = len(reference["diseases"])

    # link geometry BEFORE writing: it annotates each region with its polygon name
    warnings = link_geometry(profile_dir, reference)

    out = profile_dir / "reference.json"
    out.write_text(json.dumps(reference, ensure_ascii=False, indent=2) + "\n",
                   encoding="utf-8")

    c = reference["counts"]
    print(f"▸ {args.profile}: {c['admin1']} regions · {c['programmes']} programmes · "
          f"{c['commodities']} commodities · {len(reference['diseases'])} diseases")
    print(f"  wrote {out.relative_to(REPO)}")

    if warnings:
        print("\n  geometry vs entity model:")
        for w in warnings:
            print(f"    ⚠ {w}")
        print("  (reported, not fatal — the mapping that DID resolve is written "
              "to each region's geo_name)")
    else:
        print("  every region resolved to a polygon ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
