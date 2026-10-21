# First-frame identity test

This test answers one question: is any legacy identity visible in any rendered frame, before or instead of the target
identity?
- **Legacy identity:** "NHDW", "National Health Data Warehouse", "Federal Ministry of Health"/"FMoH" as brand, or the
  `logo-fmoh.png` emblem as product icon.
- **Target identity:** "Data Intelligence Platform" with "Powered by Palladium".

It supports findings DAP-B10, DAP-B11 and DAP-F18 in
[`../../dashboard-access-point-review.md`](../../dashboard-access-point-review.md).

## Baseline (2026-10-21, live system, develop 92ede8e)

116 scenarios were executed.

| Status | Count | Meaning |
|---|---|---|
| LEGACY | 70 | Legacy identity still visible when the scenario settles |
| FLASH | 9 | Legacy identity visible, then gone (tool gates: the Keycloak page during sign-in) |
| CLEAN | 36 | No legacy identity in any frame (stock tools after sign-in, and raw 404s, which show no identity at all) |
| BLOCKED | 1 | Could not be measured (dbt-docs 404 hangs when signed in) |

The harness exits with code **1** today, the expected baseline failure.

| Access point | Scenarios | Result |
|---|---|---|
| Public | 12 | LEGACY 11, CLEAN 1 (404) |
| Internal BI | 16 | LEGACY 15, CLEAN 1 (404) |
| Admin | 16 | LEGACY 15, CLEAN 1 (404) |
| Workshop | 16 | LEGACY 15, CLEAN 1 (404) |
| Keycloak, moh-staff and privileged-ops | 10 | LEGACY 8, CLEAN 2 (404) |
| dbt-docs | 7 | LEGACY 6, BLOCKED 1 |
| mlflow, prometheus, alertmanager, seaweedfs, headlamp | 39 | FLASH 9, CLEAN 30 |

**Scenarios**

| Scenario | What it does |
|---|---|
| `cold` | New context, empty cache, including the sign-in redirect chain |
| `sso` | Returning user with only sign-in cookies |
| `reload` | Normal reload |
| `hard` | Reload with the cache disabled |
| `deep` | A direct link to a page or anchor |
| `nav` | Sidebar or header navigation through every page |
| `slow` | Profile requests delayed 5 s |
| `fail-abort`, `fail-500` | Profile request aborted, or returns 500 |
| `warm` | Second load in the same tab |
| `newasset` | `index.html` re-served with a new script name, simulating a deploy to a cached client |
| `jsfail` | Main bundle fails to load |
| `expired`, `expired-sso` | An expired token in session storage |
| `signin-error` | The sign-in failure page |
| `forbidden` | A user without the role opens a tool gate |
| `kc-error` | Keycloak error page |
| `e404` | Unknown path |

**What was seen**
- **Public:** the bundled legacy masthead from the first paint (frame
  [`public-cold-first-frames-bundled-legacy.jpg`](frames/public-cold-first-frames-bundled-legacy.jpg)). It switches to
  the profile copy about 250 ms later ([`public-cold-after-profile.jpg`](frames/public-cold-after-profile.jpg)). It
  stays legacy for good when the profile request fails
  ([`public-profile-500-legacy-stays.jpg`](frames/public-profile-500-legacy-stays.jpg)). The tab title, favicon and
  header emblem never change.
- **Internal BI, admin, workshop:** a legacy title and emblem favicon, then the "NHDW" sign-in splash, then the Keycloak
  page, then a legacy shell ([`internal-bi-cold-final-shell.jpg`](frames/internal-bi-cold-final-shell.jpg),
  [`admin-cold-final-shell.jpg`](frames/admin-cold-final-shell.jpg),
  [`workshop-cold-final-shell.jpg`](frames/workshop-cold-final-shell.jpg)). An expired session shows the same path
  ([`internal-bi-expired-session.jpg`](frames/internal-bi-expired-session.jpg)).
- **Keycloak:** "Palladium" beside "National Health Data Warehouse", "Federal Ministry of Health · Ethiopia" and the
  emblem ([`keycloak-moh-staff-login.jpg`](frames/keycloak-moh-staff-login.jpg)).
- **dbt-docs:** "NHDW · Data lineage" ([`dbt-docs-cold.jpg`](frames/dbt-docs-cold.jpg)).

## The acceptance test (re-runnable)

The harness is in [`harness/`](harness/): `run.sh`, `flash.py` and `probe.js`. It needs Docker and network access to
the hosts.

```
DEMO_PW=<demo password from the secret store> \
FLASH_HOSTBASE=<host base, e.g. 20.84.70.78.nip.io> \
FLASH_OUT=/path/for/results \
docs/dashboard-review-evidence/identity-flash/harness/run.sh --host all --scenario all
```

- `--host` and `--scenario` take comma-separated lists, and `--list` shows which scenarios apply to which host.
- The password is read only from the environment and is never written anywhere.

**Exit codes**

| Code | Meaning |
|---|---|
| 0 | Every scenario CLEAN. **This is the pass condition.** |
| 1 | Any FLASH or LEGACY |
| 2 | Only BLOCKED (inconclusive; re-run) |

**What counts as a legacy hit.** `probe.js` runs at document creation in every page, including every redirect hop, and
samples on every animation frame, every 50 ms and every DOM change. A screencast and a video run alongside. A sample
counts if any of these is true:
- the tab title matches the legacy patterns;
- the favicon is the emblem;
- a viewer-visible text node (in the viewport, not hidden, not covered) matches the legacy patterns. A ministry named
  inside article content is reported but not counted, because it can be a legitimate data source;
- a visible image is the emblem.

**Additional check after the fix.** On public, internal BI, admin, workshop and Keycloak, the final identity
(`final_identity.target` in the timeline) contains "Data Intelligence Platform" and "Powered by Palladium". Run once
per country profile.

**Limits**
- Text drawn on a canvas is not scanned.
- Favicons are judged by link only.
- Timings are indicative (±50 ms; host groups ran in parallel).
- dbt-docs and mlflow "forbidden" could not be tested (no lower-privilege account).

Full timelines, raw samples, 111 videos and 2,531 frames are retained by the review owner.
