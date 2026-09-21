# Palladium Demo Console

One place to find every project Palladium demos, know whether it is up, set what
it is showing, run a scripted demo action, and see who did what.

**This is its own product, not part of any project it controls.** It currently
sits inside the NHDW working tree for convenience while it is being built, is
gitignored there, and carries its own history — the intent is a standalone
repository once it settles.

## How it reaches a project

It is a conductor. It knows nothing project-specific and speaks one contract
that each project implements however it likes:

    GET   /api/demo/health       up? degraded? which components
    GET   /api/demo/profile      active profile + what else is installed
    POST  /api/demo/profile      switch → job
    GET   /api/demo/actions      what a presenter can press
    POST  /api/demo/action/{id}  run one → job + deep link
    GET   /api/demo/job/{id}     stage-by-stage progress

A project that never implements these still works here as a resource folder with
a health tile. That is deliberate: it is the difference between a console that
launches now and one that waits on every team.

## What a project page shows

Four tabs, each answering one question and nothing else:

| | |
|---|---|
| **Overview** | What is this, and is it up? |
| **Resources** | What material do I show? |
| **Controls** | What can I change, and what can I press? |
| **Notes** | What should the next person know? |

Overview **is** the write-up and nothing else — five fixed sections set as a
document: what it is, who it is for, what to show, how it is built, what to be
careful about. They are fixed so every project reads alike and the gaps are
visible: the page says how many of the five are written and names the ones that
are not.

It carried a component checklist and an event log once. Neither belonged on a
page whose job is to explain a project: the component detail now hangs off the
status in the header, and the estate's history is read in Admin.

Those five sections are defined **once**, as `DOC_SECTIONS` in `app/main.py`,
and served at `/api/doc-sections`. The creation form builds a field per section
from that list and the Overview builds a section per entry from the same one.
Keep it that way: a heading the form cannot fill, or a field the page never
shows, is how a page starts lying about what is known.

## Running it

    export CONSOLE_DB_DSN=postgresql://user:pass@host:5432/demo_console
    uvicorn app.main:app --port 8080

People sign in with a console password. The **first account to register becomes
a console admin**; after that, an admin grants access. There is no developer
sign-in — if nobody can get in (an OIDC deployment that has since dropped OIDC,
or accounts made by a sign-in that no longer exists), run this on the host:

    docker compose exec app python -m app.adminctl list
    docker compose exec app python -m app.adminctl invite

which prints a single-use link rather than setting a password. It needs shell
access on the host, which is a higher bar than any password.

With Keycloak as well:

    export KEYCLOAK_PUBLIC_BASE=https://keycloak.example
    export KEYCLOAK_REALM=moh-staff
    export KEYCLOAK_CLIENT_ID=demo-console
    export KEYCLOAK_CLIENT_SECRET=...
    export CONSOLE_PUBLIC_URL=https://console.example
    export CONSOLE_ENV=prod

The schema applies itself on boot and is idempotent.

Iterating on the UI is a save, not a rebuild, if you start it with the dev
overlay — it serves `web/` from disk instead of the copy baked into the image:

    docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db app

## Accounts and access

Two ways in, and the console picks whichever is configured:

- **Single sign-on** through Keycloak, when `KEYCLOAK_*` is set.
- **A password account** otherwise. Anyone may register; registration hands out
  nothing, because an account with no grant sees no project at all. Set
  `CONSOLE_OPEN_SIGNUP=false` to make it invite-only, where an admin creates the
  account and hands over a reset link.

There is deliberately **no third way** — no developer sign-in, no seed account
with a known password, nothing that skips the password. A console holding the
keys to a client demo estate should not have a back door, however it is labelled
or however carefully it is gated. Tooling signs in the same way people do.

Passwords are PBKDF2-HMAC-SHA256 from the standard library (600,000 iterations
by default, written into every stored hash so the count can be raised later
without invalidating anything). No dependency, which matters for an image that
has to build on an air-gapped host.

**Password reset** mints a single-use token, stores only its SHA-256, and
expires it in an hour. If a mail relay is configured it emails the link;
otherwise it says plainly that an admin has to hand the link over, and an admin
can issue one from Admin → People & access. `/auth/forgot` answers identically
for an account that exists and one that does not, so it is not a way to find out
who has an account here. A dev console with no relay returns the link in the
response, which is scoped to `CONSOLE_ENV=dev` and never happens elsewhere.

**Two levels of access, and they are separate.** A *console role* — member or
admin — decides who may administer the console itself: Admin (the roster, the
grants, the estate-wide log) is admin-only, in the interface and at the API.
Everything else is a *per-project grant*: viewer reads resources · presenter
also opens the demo, runs actions and holds the project · maintainer also edits
resources and switches the profile · admin also grants access. The first person
ever to sign in becomes a console admin, because otherwise nobody can grant
anything. The console refuses to remove the last one.

Disabling an account, changing its console role, or resetting its password ends
its sessions immediately rather than at the next sign-in. Changing your own
password keeps the browser you are typing in and ends the rest.

The mail relay is **deliberately unset by default**: a console that starts
sending real email the moment it boots is a bad surprise. `CONSOLE_SMTP_HOST`,
`_PORT`, `_USER`, `_PASSWORD` and `_FROM` turn it on.

## Giving it something to show

An empty console demonstrates nothing, and hand-typing an estate every time is
how fixtures rot. `tools/seed-demo.py` puts four projects and six people into a
console **through its own API** — registering, creating and granting exactly as
a person would, so a broken rule fails the seed instead of being papered over.
It is idempotent.

    python3 tools/seed-demo.py --url http://127.0.0.1:8099 \
        --admin saba --password 'demo-console-2026'

The people it creates exist to make every access rule visible at once: a second
console admin, a maintainer on one project who is only a viewer on another, a
presenter who can press things but change nothing, a project admin who can grant
access to their one project, a viewer, and somebody with **no grant at all** —
who should find an empty console that says nothing has been *shared* with them,
which is not the same sentence as "there is nothing here".

It signs in with a real password account like everything else. On a console
with no accounts at all it registers that admin first, since the first account
is always a console admin.

**It refuses a console that is not running in dev.** The accounts it creates
share a password that is committed to this repository, so seeding them onto a
real console would publish six working logins. `--force` overrides that, and
means you have undertaken to change every one of them afterwards.

## Testing it

`tests-e2e.js` drives the whole app in a real browser: every route, tab,
control and CRUD flow, in both themes and three viewports, failing on any
console message, any failed or error-status request, and on the layout faults
that do not throw — sideways scroll, stuck skeletons, invisible contrast.

    docker run --rm --network host -v "$PWD:/app" -w /app \
      mcr.microsoft.com/playwright:v1.49.0-jammy \
      sh -c "npm i --silent playwright@1.49.0 && CONSOLE_URL=http://127.0.0.1:8099 node tests-e2e.js"

It needs a running console with at least one project that has a live agent, and
a console admin to drive it as — `CONSOLE_ADMIN` / `CONSOLE_ADMIN_PW`, defaulting
to the account `tools/seed-demo.py` creates.

## Deploying it

The console is deliberately outside every cluster it controls, so it deploys as
plain containers on its host and is *not* carried by any project's CI:

    tar czf console.tgz --exclude=.git --exclude=.env palladium-console
    scp console.tgz <host>:/tmp/
    ssh <host> 'sudo tar xzf /tmp/console.tgz -C /tmp \
      && sudo cp -r /tmp/palladium-console/. /opt/palladium-console/ \
      && cd /opt/palladium-console && sudo docker compose up -d --build'

`/opt/palladium-console/.env` is generated on the first deploy and is never
overwritten, so the database password and the host settings survive an update.

## Artwork

Everything the interface paints is derived from a source file in `brand/` by a
script, so a new asset is a drop-in plus a re-run rather than a hunt through the
CSS:

| source | served | used for |
|---|---|---|
| `palladium-logo-source.jpg` | `palladium-logo.png`, `palladium-mark.png`, `favicon.*` | the lockup and the tab icon — alpha MASKS, painted in the theme's ink |
| `login-art-source.avif` | `login-art.jpg` | the sign-in panel — cube burst, on black |
| `login-art-alt-source.jpg` | `login-art-alt.jpg` | the sign-in panel — painted arcs (current) |

    python3 tools/make-brand-assets.py       # regenerates the logo set

`ART` in `web/assets/app.js` chooses the sign-in piece; `null` there brings back
the rotating globe, which is kept in full. `ARTWORK` beside it says how each
piece should be blended — a piece on black wants `screen` so its ground vanishes
into the panel, a piece painted edge to edge wants `normal`.

The **ground** both boards float on is not an image at all: it is drawn in CSS
from the same tokens as the rest of the interface, so it harmonises by
construction and stays crisp at any size. `.ground` in `web/assets/app.css`.

## Shape

    app/main.py     FastAPI: auth, projects, resources, access, activity,
                    and the server-side proxy to each project's demo agent
    app/schema.sql  the console's own tables
    web/            hand-written SPA — no build step, so it stays editable
                    in place during a demo week

Roles are per project: **viewer** reads resources · **presenter** also opens the
demo and runs actions · **maintainer** also edits resources and switches
profiles · **admin** also grants access. The first person to sign in becomes a
console admin, because otherwise nobody can grant anything.
