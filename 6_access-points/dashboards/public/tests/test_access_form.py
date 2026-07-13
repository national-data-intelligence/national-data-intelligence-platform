#!/usr/bin/env python3
"""Regression test: public access-request FORM guards + identity state model (§6.3).

Pins the client-side behaviour that keeps a public requester from ever seeing a
raw 422 or a link to the admin console:
  · field-level validation BEFORE submit (full name >= 2, valid email,
    purpose >= 10) — inline messages, no round-trip;
  · identity-verification state model — an invalid Fayda FAN is refused inline;
    a Fayda ok:false result renders "could not verify" (NEVER a fake success);
    a National ID number is recorded as "pending manual verification";
  · the form RESETS after a successful submit;
  · the success view exposes user-authorized actions only ("Return to datasets"
    / "Close") and NO link to the admin dashboard.

The verification-failure and verified states are driven by posting the same
`nhdw:fayda-verify` message the real popup would send, so no live Fayda replica
is needed for those assertions.

Requires: a running system (bundle/scripts/verify-system.sh green) and
playwright. Run:  python3 test_access_form.py   -> exits non-zero on any failure.
"""
import time
from playwright.sync_api import sync_playwright

PUBLIC = "https://public.127.0.0.1.nip.io/"
FAILURES: list[str] = []


def check(cond: bool, label: str) -> None:
    print(("  ✓ " if cond else "  ✗ ") + label)
    if not cond:
        FAILURES.append(label)


def open_modal(pg):
    pg.goto(PUBLIC, wait_until="networkidle", timeout=30000)
    pg.click("text=Request access")
    pg.wait_for_selector("text=Verify your identity", timeout=10000)
    pg.wait_for_timeout(700)  # modal entry animation


def body(pg) -> str:
    return pg.inner_text("body")


def post_fayda(pg, payload_js: str) -> None:
    """Dispatch the exact message the Fayda popup would postMessage back."""
    pg.evaluate(
        "window.postMessage({type:'nhdw:fayda-verify', payload:" + payload_js + "}, '*')")
    pg.wait_for_timeout(400)


def main() -> int:
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(ignore_https_errors=True,
                            viewport={"width": 1400, "height": 2200})

        # ---- 1. invalid identity identifier (Fayda FAN client validation) ----
        pg = ctx.new_page()
        open_modal(pg)
        pg.fill("input[placeholder='e.g. 123456789012']", "abc123")   # not numeric / too short
        pg.get_by_role("button", name="Verify", exact=True).click()
        pg.wait_for_timeout(300)
        check("valid Fayda number" in body(pg),
              "invalid FAN is refused inline (no popup, no fake verify)")

        # ---- 2. missing required fields (submit guard, inline messages) ----
        pg.get_by_role("button", name="Submit request", exact=True).click()
        pg.wait_for_timeout(300)
        txt = body(pg)
        check("at least 2 characters" in txt, "empty name blocked inline")
        check("valid email address" in txt, "empty/invalid email blocked inline")
        check("at least 10 characters" in txt, "short purpose blocked inline")
        check("Request submitted" not in txt, "a guarded submit does not reach the success view")

        # ---- 3. backend verification failure -> could-not-verify (no fake OK) ----
        pg2 = ctx.new_page()
        open_modal(pg2)
        pg2.fill("input[placeholder='e.g. 123456789012']", "123456789012")
        post_fayda(pg2, "{ok:false, error:'regtest forced failure'}")
        check("could not verify" in body(pg2).lower(),
              "Fayda ok:false renders 'could not verify' (not a success)")
        check("Identity verified with Fayda" not in body(pg2),
              "a failed verify NEVER shows the verified badge")

        # verified state (positive control) via the same message channel
        post_fayda(pg2, "{ok:true, fayda_id:'FIN-REG-TEST', name:'Reg Test'}")
        check("Identity verified with Fayda" in body(pg2),
              "Fayda ok:true reaches the verified state")

        # ---- 4. National ID -> provided, pending manual verification ----
        pg3 = ctx.new_page()
        open_modal(pg3)
        pg3.select_option(".modal select", "national-id")
        pg3.fill("input[placeholder='ID card number']", "NID-90210")
        pg3.get_by_role("button", name="Use this ID", exact=True).click()
        pg3.wait_for_timeout(300)
        check("verify it manually" in body(pg3),
              "National ID is recorded as pending manual verification (not verified)")

        # ---- 5. successful submit + form reset + no admin link ----
        pg4 = ctx.new_page()
        open_modal(pg4)
        email = f"regtest.form.{int(time.time())}@ar-regtest.example"
        pg4.fill("input[placeholder='Dr Tigist Bekele']", "Reg Form Tester")
        pg4.fill("input[placeholder='tigist.bekele@moh.gov.et']", email)
        pg4.fill(".modal textarea", "Regression test of the public access-request form reset behaviour.")
        pg4.get_by_role("button", name="Submit request", exact=True).click()
        pg4.wait_for_selector("text=Request submitted", timeout=15000)
        done = body(pg4)
        check("Request submitted" in done, "valid submit reaches the success view")
        import re
        check(bool(re.search(r"AR-\d{4}-\d{4}", done)), "success view shows an AR- tracking id")
        # success view is user-authorized only — never links to the admin console
        admin_links = pg4.eval_on_selector_all(
            "a[href]", "els => els.filter(e => /admin/i.test(e.getAttribute('href')||'')).length")
        check(admin_links == 0, "success view has NO link to the admin console")
        check("Demo mockup" not in done and "admin queue" not in done,
              "the demo-mockup callout + admin-queue button are gone")

        # Return to datasets, reopen, assert the form is RESET (fields empty).
        pg4.get_by_role("button", name="Return to datasets", exact=True).click()
        pg4.wait_for_timeout(500)
        pg4.click("text=Request access")
        pg4.wait_for_selector("text=Verify your identity", timeout=10000)
        pg4.wait_for_timeout(500)
        vals = pg4.eval_on_selector_all(
            ".modal input, .modal textarea",
            "els => els.filter(e => e.type!=='checkbox' && e.type!=='file' && (e.value||'').trim()!=='').length")
        check(vals == 0, "form is reset after a successful submit (all fields empty)")

        b.close()

    # Best-effort DB cleanup of the row this test created (leaves the queue clean).
    try:
        import subprocess
        subprocess.run(
            ["bash", "-lc",
             "kubectl -n nhdw exec -i postgres-vault-0 -- env "
             "PGPASSWORD=$(kubectl -n nhdw get secret postgres-vault-secrets "
             "-o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d) psql -U vault_admin "
             "-d nhdw_ops -c \"DELETE FROM ops_governance.access_request "
             "WHERE lower(email) LIKE '%@ar-regtest.example';\""],
            check=False, capture_output=True, timeout=60)
    except Exception:
        pass

    if FAILURES:
        print(f"\nFAILED: {len(FAILURES)} check(s)")
        return 1
    print("\nALL GREEN")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
