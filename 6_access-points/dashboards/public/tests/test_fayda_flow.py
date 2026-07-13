#!/usr/bin/env python3
"""Regression test: the Fayda identity-verification popup flow (public dashboard).

Nuanced/sensitive behavior this pins down (2026-07-02; identity-entry rework
2026-07-13, §6.3):
  · "Request access" modal now has an identity-entry step: choose an ID type
    (Fayda / National ID / Passport), enter the identifier, then Verify. For
    Fayda a valid FAN (12-16 digits) is entered, then "Verify" opens a POPUP
    against the fayda-replica at http://localhost:8096/authorize (0_external/
    fayda — the external-world mock; NOT in k8s).
  · redirect_uri must be the LIVE public origin
    (https://public.127.0.0.1.nip.io/auth/fayda-callback) — a stale image once
    shipped the compose-era 127.0.0.1:8088 default and silently broke the flow.
  · POSITIVE path: enter FAN, Verify, pick a citizen, Sign in, popup self-closes,
    the modal reaches the "verified" state showing "Identity verified with Fayda".
  · CANCEL path: closing the popup without signing in must revert the Verify
    button from "Opening Fayda" back to "Verify" (watcher polls w.closed).

Requires: a running system (bundle/scripts/verify-system.sh green) and
playwright (`pip install playwright`; chromium from the playwright cache).
Run:  python3 test_fayda_flow.py   → exits non-zero on any failure.
"""
from playwright.sync_api import sync_playwright

PUBLIC = "https://public.127.0.0.1.nip.io/"
FAN = "123456789012"   # valid FIN: 12 digits (rule is 12-16 numeric)
FAILURES: list[str] = []


def check(cond: bool, label: str) -> None:
    print(("  ✓ " if cond else "  ✗ ") + label)
    if not cond:
        FAILURES.append(label)


def open_modal(pg):
    pg.goto(PUBLIC, wait_until="networkidle", timeout=30000)
    pg.click("text=Request access")
    pg.wait_for_selector("text=Verify your identity", timeout=10000)
    pg.wait_for_timeout(800)  # modal entry animation


def open_modal_and_popup(pg):
    open_modal(pg)
    # Fayda is the default ID type; enter a valid FAN, then Verify opens the popup.
    pg.fill("input[placeholder='e.g. 123456789012']", FAN)
    with pg.expect_popup() as pop_info:
        pg.get_by_role("button", name="Verify", exact=True).click()
    pop = pop_info.value
    pop.wait_for_load_state("networkidle")
    return pop


def main() -> int:
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(ignore_https_errors=True,
                            viewport={"width": 1400, "height": 2200})

        # ---- positive path ----
        pg = ctx.new_page()
        pop = open_modal_and_popup(pg)
        check(pop.url.startswith("http://localhost:8096/authorize"),
              "popup opens on fayda-replica :8096/authorize")
        check("public.127.0.0.1.nip.io%2Fauth%2Ffayda-callback" in pop.url,
              "redirect_uri is the LIVE public origin (not a stale port)")
        pop.select_option("select", index=0)
        pop.click("button:has-text('Sign in')")
        closed = True
        try:
            pop.wait_for_event("close", timeout=15000)
        except Exception:
            closed = False
        check(closed, "popup self-closes after sign-in")
        pg.wait_for_timeout(1500)
        check("Identity verified with Fayda" in pg.inner_text("body"),
              "modal reaches the verified state")

        # ---- cancel path ----
        pg2 = ctx.new_page()
        pop2 = open_modal_and_popup(pg2)
        pop2.close()  # user cancels by closing the window
        pg2.wait_for_timeout(1500)  # cancel watcher polls every 500ms
        check(pg2.get_by_role("button", name="Verify", exact=True).count() > 0,
              "cancel: button reverts to 'Verify'")
        check(pg2.query_selector("button:has-text('Opening Fayda')") is None,
              "cancel: button is not stuck on 'Opening Fayda'")
        b.close()

    if FAILURES:
        print(f"\nFAILED: {len(FAILURES)} check(s)")
        return 1
    print("\nALL GREEN")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
