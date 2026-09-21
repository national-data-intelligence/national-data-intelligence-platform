#!/usr/bin/env python3
"""Put a believable estate into a console, through its own API.

WHY THROUGH THE API. Writing rows straight into the database would seed a state
the application can never produce, and would skip the very code this is meant to
give something to exercise. Everything here goes through /auth/register,
/api/projects and /api/projects/{id}/grants exactly as a person would, so if a
rule is wrong the seed fails rather than quietly papering over it.

It is IDEMPOTENT: a project that already exists is left alone, a person who
already exists keeps their password, and grants are upserted. Run it as often as
you like.

    python3 tools/seed-demo.py --url http://127.0.0.1:8099 \
        --admin saba --password 'demo-console-2026'

It signs in with a real password account, like everything else does — there is
no back door to use instead. On a console with no accounts at all it registers
that admin first, because the first account is always a console admin.
"""
from __future__ import annotations

import argparse
import http.cookiejar
import json
import mimetypes
import pathlib
import sys
import uuid
import urllib.error
import urllib.request

# ── the estate ──────────────────────────────────────────────────────────────
# Four projects. NHDW is the one with a live agent — the others are resource
# folders until their teams implement the demo contract, which is a legitimate
# state and the reason the console supports it at all.
# The write-up fields are part of the project, not an afterthought: a seeded
# project with no documentation would demonstrate the empty state rather than
# the feature. NHDW's is accurate. The other three are short and deliberately
# hedged — nobody has told us the detail yet, and a confident invention on a
# page whose whole job is to be trusted is worse than an honest gap.
PROJECTS = [
    {
        "slug": "nhdw", "name": "National Health Data Warehouse",
        "client": "Ministry of Health · Ethiopia",
        "summary": "Data Vault 2.0 warehouse, five dashboards, governed access",
        "chip": "NH", "colour": "#2f6df6",
        "demo_url": "https://internal-bi.20.84.70.78.nip.io",
        "agent_url": "https://gateway.20.84.70.78.nip.io",
        "what_it_is":
            "Ethiopia's national health data warehouse: one place where the country's "
            "health data is brought together, reconciled, and made safe to read.\n\n"
            "Data arrives from the source systems — DHIS2, the HCMIS logistics warehouse, "
            "mBrana, the EMR, and the facility registry — and moves through a real "
            "pipeline: ingestors land it in the lake, ClickHouse stages it, a Data "
            "Vault 2.0 model holds the history, and the marts on top are what the "
            "dashboards read. Nothing on a dashboard is typed in by hand; every number "
            "can be traced back to the record it came from.",
        "who_for":
            "The Ministry of Health, primarily — programme managers who need to know "
            "what is happening in facilities, and the people who answer to donors for "
            "it.\n\nIn the room, usually: a ministry director, a programme lead, and "
            "whoever is technical enough to ask where a number came from. That last "
            "question is the one the demo is built to answer well.",
        "what_to_show":
            "Sign in as a real person, not an admin — the access model is the point. "
            "Open the internal BI dashboards and move through a programme's numbers.\n\n"
            "Then show what a different role sees: the same page, fewer rows, some "
            "columns masked. It is the same query — policy decides what comes back, "
            "not the page.\n\n"
            "Finish on lineage: pick a figure and walk it back through the mart, the "
            "vault, and the staging table to the source record.",
        "how_built":
            "Kubernetes throughout. dlt ingestors, SeaweedFS as the lake, ClickHouse "
            "staging, Postgres for the vault and marts, dbt for the transformations, "
            "a FastAPI gateway in front, and five single-page dashboards.\n\n"
            "Identity is Keycloak. Authorisation is two engines: the gateway decides "
            "what a person may see at all, and OPA filters rows and masks columns on "
            "the way out. OpenMetadata carries the catalogue and lineage.",
        "caveats":
            "The data is a realistic sample, not live national data — the shapes and "
            "volumes are true to the sources, the values are not somebody's real "
            "record.\n\n"
            "The assistant needs the GPU host to be useful; on a laptop it is slow "
            "enough to be worth skipping. Do not promise integrations that are not in "
            "the pipeline — the source list above is the list.",
    },
    {
        "slug": "pct", "name": "Procurement and Commodity Tracking",
        "client": "Zambia · eLMIS",
        "summary": "Global Fund S8 availability, stockouts, months of stock, order fill",
        "chip": "PC", "colour": "#0f9d76",
        "demo_url": "https://internal-bi.20.84.70.78.nip.io/#/resource",
        "what_it_is":
            "Supply-chain visibility over Zambia's eLMIS history: what was available "
            "where, what ran out, how much stock is on hand in months of cover, and "
            "how much of each calculated order was actually approved.\n\n"
            "The KPIs follow the Global Fund handbook where a handbook definition "
            "exists (S8 availability), and say plainly when they do not.",
        "who_for":
            "Programme and supply people who have to decide what to order and where to "
            "move it — and the donor-facing reporting that sits on the same numbers.",
        "what_to_show":
            "Availability and stockouts by province, then the months-of-stock bands "
            "against the facility's own stock policy. Then the projected position: "
            "what to replenish, and what could be redistributed within a district "
            "instead of ordered.",
        "how_built":
            "The same warehouse as NHDW. eLMIS history lands through the pipeline into "
            "bi_supply marts; a demand forecast rides an ML read seam with its model "
            "version and MLflow run on every row.",
        "caveats":
            "This is a 2018 archive, not live eLMIS — say so. Twelve months of history "
            "means no seasonality can be separated from trend. Approval is not "
            "delivery: there is no OTIF here, because there is no delivery data. "
            "Lead time is an assumption and is labelled as one on the page.",
    },
    {
        "slug": "qat", "name": "Quantification Analytics Tool",
        "client": "Supply planning",
        "summary": "Forecasting and supply plans for national programmes",
        "chip": "QA", "colour": "#c9761c",
        "what_it_is":
            "Quantification and supply planning: turning programme targets and "
            "consumption history into a forecast of what will be needed, and a supply "
            "plan for how to get it there.",
        "caveats":
            "The detail of this one has not been written down yet — check with the "
            "project's owner before promising specifics. Everything below the summary "
            "is still to be filled in.",
    },
    {
        "slug": "emr", "name": "Electronic Medical Records",
        "client": "Ministry of Health · Ethiopia",
        "summary": "Facility-level clinical records feeding the warehouse",
        "chip": "EM", "colour": "#8a4fd0",
        "what_it_is":
            "The facility-level clinical record system: what happens at the point of "
            "care, and the upstream source the warehouse's clinical marts are built "
            "from.",
        "caveats":
            "The detail of this one has not been written down yet — check with the "
            "project's owner before promising specifics.",
    },
]

# ── the people, and what they can reach ─────────────────────────────────────
# Chosen to make every rule visible at once: a second console admin, somebody
# who can change one project and only watch another, a presenter who can press
# things but change nothing, a viewer who can only read, and somebody with no
# grant at all — who should see an empty console and be told why.
PASSWORD = "demo-console-2026"
PEOPLE = [
    {"username": "saba",   "full_name": "Saba Alemu",      "email": "saba@palladium.example",
     "console_admin": True,
     "note": "console admin — sees every project and the Admin area",
     "grants": {}},
    {"username": "daniel", "full_name": "Daniel Mekonnen", "email": "daniel@palladium.example",
     "note": "maintainer on NHDW, viewer on PCT — can switch one profile, only read the other",
     "grants": {"nhdw": "maintainer", "pct": "viewer"}},
    {"username": "mesay",  "full_name": "Mesay Girma",     "email": "mesay@palladium.example",
     "note": "presenter on PCT and QAT — runs demos, changes nothing",
     "grants": {"pct": "presenter", "qat": "presenter"}},
    {"username": "hanna",  "full_name": "Hanna Bekele",    "email": "hanna@palladium.example",
     "note": "project admin on EMR — can grant access to it, and reaches nothing else",
     "grants": {"emr": "admin"}},
    {"username": "yonas",  "full_name": "Yonas Tadesse",   "email": "yonas@palladium.example",
     "note": "viewer on NHDW — opens the material, cannot open the demo",
     "grants": {"nhdw": "viewer"}},
    {"username": "liya",   "full_name": "Liya Haile",      "email": "liya@palladium.example",
     "note": "no grant at all — must see an empty console and be told why",
     "grants": {}},
]


# ── material for the NHDW shelf ─────────────────────────────────────────────
# Real files wherever real ones exist: the requirements document and the
# architecture write-ups are the project's own, not stand-ins. The deck and the
# walkthrough are generated by tools/make-sample-media.py from the same facts.
NHDW_FILES = [
    ("nhdw-overview-deck.pptx", "NHDW overview deck", "deck",
     "45 minutes, client-facing — sources, vault, marts, governed access"),
    ("nhdw-walkthrough.mp4", "Walkthrough — the system in ten minutes", "video",
     "Screen tour of the five dashboards"),
    ("Ethiopia_NHDW_High_Level_Requirements_Version_FINAL_28_Nov_2024.pdf",
     "High-Level Requirements (FINAL, Nov 2024)", "doc",
     "182 pages — the yardstick every KPI is measured against"),
    ("NIDP DW Architecture Overview - Partners.pdf",
     "Architecture overview — for partners", "doc",
     "How the tiers fit together, without the implementation detail"),
    ("NHDW Project Write Up - Early Draft.pdf",
     "Project write-up (early draft)", "doc",
     "Background and intent"),
]
NHDW_LINKS = [
    {"title": "Source code on GitHub", "kind": "code",
     "url": "https://github.com/national-data-intelligence/national-data-intelligence-platform",
     "note": "The platform repository — pipelines, dashboards, policy and deploy"},
]


def upload_file(console: "Console", project_id: str, path: pathlib.Path,
                title: str, kind: str, note: str) -> tuple[int, dict]:
    """Multipart by hand, because this script deliberately carries no
    dependencies — it has to run anywhere the console does."""
    boundary = "----seed" + uuid.uuid4().hex
    body = bytearray()

    def part(name: str, value: str) -> None:
        body.extend(f"--{boundary}\r\nContent-Disposition: form-data; "
                    f'name="{name}"\r\n\r\n{value}\r\n'.encode())

    part("title", title); part("kind", kind); part("note", note)
    body.extend(f"--{boundary}\r\nContent-Disposition: form-data; "
                f'name="file"; filename="{path.name}"\r\n'
                f"Content-Type: {mimetypes.guess_type(path.name)[0] or 'application/octet-stream'}"
                "\r\n\r\n".encode())
    body.extend(path.read_bytes())
    body.extend(f"\r\n--{boundary}--\r\n".encode())

    req = urllib.request.Request(
        f"{console.base}/api/projects/{project_id}/resources/upload",
        data=bytes(body), method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    try:
        with console.opener.open(req, timeout=300) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:                                       # noqa: BLE001
            return e.code, {"detail": raw.decode(errors="replace")[:160]}


class Console:
    def __init__(self, base: str):
        self.base = base.rstrip("/")
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar))

    def call(self, method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
        req = urllib.request.Request(
            f"{self.base}{path}", method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Content-Type": "application/json"})
        try:
            with self.opener.open(req, timeout=20) as r:
                raw = r.read()
                # Some routes answer a browser with a redirect to the app, so
                # what comes back is the app shell rather than JSON.
                try:
                    return r.status, (json.loads(raw) if raw else {})
                except json.JSONDecodeError:
                    return r.status, {}
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw)
            except Exception:                                   # noqa: BLE001
                return e.code, {"detail": raw.decode(errors="replace")[:200]}

    def logout(self) -> None:
        self.call("POST", "/auth/logout")
        self.jar.clear()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8099")
    ap.add_argument("--admin", default="saba",
                    help="console admin to seed as (registered if the console is empty)")
    ap.add_argument("--password", default=PASSWORD)
    ap.add_argument("--docs", default="",
                    help="directory holding the NHDW reference PDFs to put on the shelf")
    ap.add_argument("--force", action="store_true",
                    help="seed a console that is not running in dev. Read the "
                         "warning below before you do.")
    args = ap.parse_args()

    c = Console(args.url)
    status, cfg = c.call("GET", "/auth/config")
    if status != 200:
        sys.exit(f"cannot reach the console at {args.url}")

    # The accounts this creates share a password that is COMMITTED TO THIS REPO.
    # That is fine on a development console and is exactly wrong anywhere else,
    # so seeding a non-dev console has to be asked for explicitly.
    if cfg.get("env") != "dev" and not args.force:
        sys.exit(f"{args.url} is not running with CONSOLE_ENV=dev.\n\n"
                 f"The accounts this creates share the password '{PASSWORD}', which is\n"
                 f"in this repository. Seeding them onto a real console publishes six\n"
                 f"working logins. If you know that is what you want, pass --force and\n"
                 f"change every password afterwards.")

    status, _ = c.call("POST", "/auth/password-login",
                       {"identifier": args.admin, "password": args.password})
    if status != 200:
        # An empty console has no admin to sign in as, and the first account
        # registered always becomes one — so create it rather than fail.
        status, out = c.call("POST", "/auth/register", {
            "username": args.admin, "password": args.password,
            "full_name": args.admin.title(), "email": f"{args.admin}@palladium.example"})
        if status != 200:
            sys.exit(f"cannot sign in as '{args.admin}', and cannot register it: "
                     f"{out.get('detail')}")
    status, me = c.call("GET", "/api/me")
    if status != 200 or me.get("org_role") != "admin":
        sys.exit(f"'{args.admin}' signed in but is not a console admin — promote it "
                 f"from Admin, or point --admin at one that is")
    print(f"seeding as {me['username']} (console admin)\n")

    # ── projects ────────────────────────────────────────────────────────
    _, existing = c.call("GET", "/api/projects")
    by_slug = {p["slug"]: p for p in existing.get("projects", [])}
    DOC_KEYS = ("what_it_is", "who_for", "what_to_show", "how_built", "caveats")
    for spec in PROJECTS:
        if spec["slug"] in by_slug:
            # Already here — but a project seeded before these sections existed
            # has an Overview with nothing in it. Fill ONLY what is empty: a
            # section somebody has written is theirs, and a seed that overwrites
            # it is a seed nobody dares re-run.
            have = by_slug[spec["slug"]]
            gaps = {k: spec[k] for k in DOC_KEYS
                    if spec.get(k) and not (have.get(k) or "").strip()}
            if gaps:
                st, _ = c.call("PATCH", f"/api/projects/{have['id']}", gaps)
                print(f"  ~ {spec['slug']:<6} {spec['name']} "
                      f"({'wrote ' + ', '.join(sorted(gaps)) if st == 200 else 'patch failed'})")
            else:
                print(f"  = {spec['slug']:<6} {spec['name']} (already here)")
            continue
        status, out = c.call("POST", "/api/projects", spec)
        if status == 200:
            by_slug[spec["slug"]] = out
            print(f"  + {spec['slug']:<6} {spec['name']}")
        else:
            print(f"  ! {spec['slug']:<6} {out.get('detail')}")

    # ── people ──────────────────────────────────────────────────────────
    print()
    for person in PEOPLE:
        guest = Console(args.url)
        status, out = guest.call("POST", "/auth/register", {
            "username": person["username"], "password": PASSWORD,
            "full_name": person["full_name"], "email": person["email"]})
        if status == 200:
            print(f"  + {person['username']:<7} {person['note']}")
        elif status == 409:
            print(f"  = {person['username']:<7} {person['note']}")
        else:
            print(f"  ! {person['username']:<7} {out.get('detail')}")
            continue
        guest.logout()

    # ── grants ──────────────────────────────────────────────────────────
    print()
    status, roster = c.call("GET", "/api/people")
    if status != 200:
        sys.exit(f"cannot read the roster: {roster.get('detail')}")
    subs = {p["username"]: p["kc_sub"] for p in roster["people"]}
    for person in PEOPLE:
        sub = subs.get(person["username"])
        if not sub:
            print(f"  ! {person['username']}: not on the roster")
            continue
        if person.get("console_admin"):
            s, o = c.call("POST", f"/api/people/{sub}/org-role", {"org_role": "admin"})
            print(f"  · {person['username']:<7} console admin"
                  + ("" if s == 200 else f"  ! {o.get('detail')}"))
        for slug, role in person["grants"].items():
            proj = by_slug.get(slug)
            if not proj:
                print(f"  ! {person['username']}: no project '{slug}'")
                continue
            s, o = c.call("POST", f"/api/projects/{proj['id']}/grants",
                          {"person_sub": sub, "role": role})
            print(f"  · {person['username']:<7} {role} on {slug}"
                  + ("" if s == 200 else f"  ! {o.get('detail')}"))

    # ── the NHDW shelf ──────────────────────────────────────────────────
    nhdw = by_slug.get("nhdw")
    if nhdw:
        print()
        _, detail = c.call("GET", f"/api/projects/{nhdw['id']}")
        have = {r["title"] for r in detail.get("resources", [])}
        media = pathlib.Path(__file__).resolve().parent.parent / "samples"
        docs = pathlib.Path(args.docs).expanduser() if args.docs else None
        for fname, title, kind, note in NHDW_FILES:
            if title in have:
                print(f"  = {title}")
                continue
            path = media / fname
            if not path.is_file() and docs:
                path = docs / fname
            if not path.is_file():
                print(f"  ? {title}  (no file at {fname})")
                continue
            status, out = upload_file(c, nhdw["id"], path, title, kind, note)
            mark = "+" if status == 200 else "!"
            extra = (f"{out.get('size_bytes', 0) // 1024}KB"
                     + (", previewable" if out.get("previewable") else ", download only")
                     if status == 200 else out.get("detail", ""))
            print(f"  {mark} {title}  ({extra})")
        for link in NHDW_LINKS:
            if link["title"] in have:
                print(f"  = {link['title']}")
                continue
            status, out = c.call("POST", f"/api/projects/{nhdw['id']}/resources", link)
            print(f"  {'+' if status == 200 else '!'} {link['title']}"
                  + ("" if status == 200 else f"  {out.get('detail')}"))

    print(f"\nEvery seeded account signs in with:  {PASSWORD}")
    print("Sign in as 'liya' to see what somebody with no grant sees.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
