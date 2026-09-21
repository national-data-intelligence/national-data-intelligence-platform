#!/usr/bin/env python3
"""Contract tests for the widget-binding parser (gen-exposures.py).

The parser feeds BOTH lineage catalogs — dbt exposures and the OpenMetadata
dashboard connector (sync-om-dashboards.py) — so a widget it cannot see has no
lineage anywhere. Pure-python, repo files only:

  registry    every FETCHERS entry, in all three forms (dict literal,
              FETCHERS["x"] = Fetcher(...), alias FETCHERS["a"] = FETCHERS["b"]),
              yields a binding
  aliases     an alias resolves to its target's binding
  routes      every mart a route-served widget declares in WIDGET_MARTS is
              actually queried by that route module (declaration cannot drift)
  catalog     every Internal BI catalog widget is bound, or listed in
              READS_NO_MART with the reason — a new widget without a binding
              fails here instead of silently missing from lineage

Run:  python3 bundle/scripts/test_gen_exposures.py
"""
from __future__ import annotations

import importlib.util
import pathlib
import re

import yaml

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[1]
CATALOG = REPO / "6_access-points/dashboards/internal-bi/catalog"

# Widgets that legitimately read no mart (tools and per-user preferences).
READS_NO_MART = {
    "ex-templates", "ex-sql-editor", "ex-saved-queries", "ex-audit-trail",   # export tools: ad-hoc SQL / ops state
    "st-profile", "st-display", "st-alert-subs", "st-security",              # settings: per-user ops state
}

spec = importlib.util.spec_from_file_location("gen_exposures", HERE / "gen-exposures.py")
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)


def test_registry() -> None:
    src = gen.FETCHERS.read_text()
    declared = set(re.findall(r'^\s*"([a-z0-9-]+)":\s*Fetcher\(', src, re.M))
    declared |= set(re.findall(r'^FETCHERS\["([^"]+)"\]\s*=', src, re.M))
    bound = gen.widget_bindings()
    missing = sorted(declared - set(bound))
    assert not missing, f"registry entries the parser cannot bind: {missing}"
    print(f"  ✓ registry: {len(declared)} entries, all bound")


def test_aliases() -> None:
    src = gen.FETCHERS.read_text()
    bound = gen.widget_bindings()
    pairs = re.findall(r'^FETCHERS\["([^"]+)"\]\s*=\s*FETCHERS\["([^"]+)"\]', src, re.M)
    for alias, target in pairs:
        assert bound.get(alias) == bound.get(target), f"alias {alias} != {target}"
    print(f"  ✓ aliases: {len(pairs)} resolve to their targets")


def test_routes() -> None:
    for route in gen.ROUTE_MODULES:
        src = route.read_text()
        for widget, marts in gen.route_widget_bindings().items():
            for _, table in marts:
                assert re.search(rf"\.{table}\b", src), \
                    f"{route.name}: {widget} declares {table} but the route never queries it"
    print(f"  ✓ routes: {len(gen.route_widget_bindings())} route-served widgets, declarations match queries")


def test_catalog() -> None:
    bound = gen.widget_mart_bindings()
    widgets = {w["id"] for f in (CATALOG / "sections").glob("*.yaml")
               for w in (yaml.safe_load(f.read_text()).get("widgets") or [])}
    unbound = sorted(widgets - set(bound) - READS_NO_MART)
    assert not unbound, f"catalog widgets with no mart binding (no lineage): {unbound}"
    stale = sorted(READS_NO_MART - widgets)
    assert not stale, f"READS_NO_MART lists widgets no longer in the catalog: {stale}"
    print(f"  ✓ catalog: {len(widgets)} widgets — {len(widgets) - len(READS_NO_MART)} bound, "
          f"{len(READS_NO_MART)} read no mart by design")


if __name__ == "__main__":
    for t in (test_registry, test_aliases, test_routes, test_catalog):
        t()
    print("gen-exposures contract: OK")
