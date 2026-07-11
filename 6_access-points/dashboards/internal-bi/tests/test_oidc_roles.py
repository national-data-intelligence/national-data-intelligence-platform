#!/usr/bin/env python3
"""Regression test: real Keycloak OIDC login + role-differentiated rendering.

Pins down the auth chain that broke silently three ways (2026-07-03, changelog
P18) because dev/mock auth masked the real-JWT path:
  · scope request must be only assigned scopes ('openid profile email' — the
    minimal realm has no builtin 'roles' scope; requesting it = invalid_scope);
  · the gateway must accept the nhdw-flat-roles top-level `roles` claim (real
    tokens carry no realm_access.roles);
  · the SPA spec fetch must survive the PKCE boot race (401-without-token =
    retry, not denied).
And the authorization behavior the design requires:
  · R-DEC     → full dashboard (5 nav pages, live widget data);
  · R-STEW    → dashboard shell with (almost) no widgets on data pages;
  · R-CONS-SCI→ the honest "No access" page — NEVER synthetic dashboards.

Requires: running system + playwright. Run: python3 test_oidc_roles.py
"""
from playwright.sync_api import sync_playwright

BI = "https://internal-bi.127.0.0.1.nip.io/"
PW = "NhdwDemo2026.OK"
FAILURES: list[str] = []


def check(cond: bool, label: str) -> None:
    print(("  ✓ " if cond else "  ✗ ") + label)
    if not cond:
        FAILURES.append(label)


def login_and_read(pw, user):
    b = pw.chromium.launch()
    ctx = b.new_context(ignore_https_errors=True, viewport={"width": 1500, "height": 1000})
    pg = ctx.new_page()
    pg.goto(BI, wait_until="domcontentloaded", timeout=45000)
    pg.wait_for_selector("#username", timeout=30000)
    pg.fill("#username", user)
    pg.fill("#password", PW)
    pg.click("#kc-login")
    pg.wait_for_load_state("networkidle", timeout=45000)
    pg.wait_for_timeout(7000)  # spec retry window (PKCE race) + first renders
    return b, pg


def main() -> int:
    with sync_playwright() as p:
        # R-DEC — full access, live data
        b, pg = login_and_read(p, "tadesse.h")
        body = pg.inner_text("body")
        check("No access to Internal BI" not in body, "R-DEC reaches the dashboard")
        check(all(x in body for x in ("Disease Surveillance", "Service Performance")),
              "R-DEC sees the full nav")
        pg.click("text=Disease Surveillance"); pg.wait_for_timeout(5000)
        body = pg.inner_text("body")
        check("contained" in body or "active" in body,
              "R-DEC disease page renders LIVE outbreak episodes")
        check("Loading…" not in body, "no widget stuck on Loading…")
        b.close()

        # R-CONS-SCI — zero internal-bi grants → honest denial, never synthetic
        b, pg = login_and_read(p, "tigist.bekele")
        body = pg.inner_text("body")
        check("No access to Internal BI" in body,
              "R-CONS-SCI gets the no-access page (not synthetic dashboards)")
        b.close()

        # R-STEW — page shell granted, data widgets absent
        b, pg = login_and_read(p, "demo.steward")
        body = pg.inner_text("body")
        check("No access to Internal BI" not in body, "R-STEW reaches the dashboard")
        pg.click("text=Service Performance"); pg.wait_for_timeout(4000)
        check("ANC1" not in pg.inner_text("body"),
              "R-STEW does NOT see the cascade widget data R-DEC sees")
        b.close()

    if FAILURES:
        print(f"\nFAILED: {len(FAILURES)} check(s)")
        return 1
    print("\nALL GREEN")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
