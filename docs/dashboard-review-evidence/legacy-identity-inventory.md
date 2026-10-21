# Legacy product identity inventory (2026-10-21)

Every place the legacy identity ("NHDW", "National Health Data Warehouse", "Federal Ministry of Health"/"FMoH" as a
brand, the `logo-fmoh.png` emblem as product icon) appears, by access point, UI state and country profile. Captured
read-only against `develop` 92ede8e and the live system. Supports finding **DAP-B10** in
[`../dashboard-access-point-review.md`](../dashboard-access-point-review.md).

Paths: `dash/` = `6_access-points/dashboards/`, `gw/` = `6_access-points/api/nhdw-gateway/app/`,
`kc/` = `7_security/keycloak/`.

**Evidence tags**

| Tag | Meaning |
|---|---|
| L-curl | Seen in a live HTTP response |
| L-bundle | Present in the live built assets |
| L-md5 | Live file identical to the repository |
| code | Repository only |
| unverif. | Live check not permitted |

**Profile columns.** "et-v3" is the live host profile, rebranded to Palladium on the host and not in git. "zm-v1" is the
host Zambia profile. "same" means the value is hard-coded and appears on every profile.

**Replacement shorthand**

| Shorthand | Meaning |
|---|---|
| DIP | Data Intelligence Platform |
| PbP | Powered by Palladium |
| mark | A new product-mark asset under a new file name |

## 1. Master table

State codes:
- **HTML**: static HTML (`<title>`, favicon, meta).
- **PRE**: first paint before profile, from the bundled fallback.
- **FAIL**: the profile request failed, so the bundled values persist.
- **SPL**: loading or auth splash.
- **SHELL**: normal or authenticated page.
- **LOGIN**: login page.
- **AERR**: auth error or sign-in failure.
- **LOGOUT**: logout.
- **EXP**: session or page expired.
- **ERR**: 401/403/404/500.
- **EMPTY**: empty or degraded state.
- **EMAIL**: e-mail.
- **API**: API docs title.
- **CACHE**: PWA or cache.
- **DOM**: present in the DOM but not rendered.

Replacement shorthand: **DIP** = "Data Intelligence Platform", **PbP** = "Powered by Palladium", **mark** = a new product-mark asset under a **new file name** (for example `dip-mark.svg` + `dip-mark-32.png`); do not overwrite `logo-fmoh.png` (see §4).

### 1a. Public portal (`public.…`, anonymous)

| id | state | string / asset | file:line | live? | profile-driven? | et-v3 shows | zm-v1 shows | replacement |
|---|---|---|---|---|---|---|---|---|
| LB-001 | HTML (all states; tab, bookmarks, history) | `<title>NHDW · Federal Ministry of Health · Ethiopia</title>` | dash/public/ui/index.html:5 | L-curl | hard-coded (no `document.title` anywhere) | same | same (says Ethiopia on Zambia) | `DIP`; then set `document.title = "DIP · {country.name}"` after the profile loads |
| LB-002 | HTML favicon | `/static/assets/logo-fmoh.png` (FMoH emblem, md5 b62178…) | dash/public/ui/index.html:7 | L-curl | hard-coded | FMoH emblem | FMoH emblem | `mark` (new filename) |
| LB-003 | PRE, FAIL | govbar `mark_text: 'NHDW'` | dash/public/ui/src/hooks/useProfile.ts:72 | L-bundle | bundled fallback (until copy loads; permanent if it fails) | flash "NHDW", then "Palladium" | flash "NHDW", then "Palladium" | bundled `DIP`; served `brand.product` |
| LB-004 | PRE, FAIL | `mark_tag: 'Federal Ministry of Health · Ethiopia'` | useProfile.ts:73 | L-bundle | bundled fallback | flash, then "Palladium · Ethiopia" | flash (Ethiopia), then "Palladium · Zambia" | `PbP` |
| LB-005 | PRE, FAIL | `strip_owner: 'Federal Ministry of Health · የጤና ሚኒስቴር'` | useProfile.ts:79 | L-bundle | bundled fallback | flash, then literal "Palladium · {ministry.native_name}" | flash, then "Palladium · Zambia" | `{country.name}` |
| LB-006 | PRE, FAIL | `headline_native: 'የብሔራዊ የጤና መረጃ ማከማቻ'` (Amharic for "National Health Data Warehouse") | useProfile.ts:82 | L-bundle | bundled fallback | flash, then literal "{platform.native_name}" | flash (Amharic on Zambia), then hidden | remove the key (bundled `''`) |
| LB-007 | PRE, FAIL | `brand_line: 'National Health Data Warehouse · NHDW'` | useProfile.ts:92 | L-bundle | bundled fallback | flash, then "Data Intelligence Platform · Palladium" | flash, then the same | `DIP · PbP` |
| LB-008 | PRE, FAIL | `owner_line: 'Federal Ministry of Health · Federal Democratic Republic of Ethiopia'` | useProfile.ts:93 | L-bundle | bundled fallback | flash, then "Palladium · Federal Democratic Republic of Ethiopia" | flash (Ethiopia), then "Palladium · Republic of Zambia" | `{country.official_name}` |
| LB-009 | PRE, FAIL, **and SHELL** (merge back-fill) | `BUNDLED.ministry = {abbr:'FMoH', name:'Federal Ministry of Health', native_name:'የጤና ሚኒስቴር', logo:'logo-fmoh.png'}`, `BUNDLED.platform = {name:'National Health Data Warehouse', abbr:'NHDW', native_name:…}`, `BUNDLED.country` = Ethiopia | useProfile.ts:43-62 | L-bundle | fallback **plus deep-merge back-fill of every omitted key** (`:128`) | `ministry.logo` and `native_name` back-filled with Ethiopian values | `ministry.logo` = FMoH crest and `country.native` = Amharic back-filled on Zambia | neutral bundle: `brand:{product:DIP, attribution:PbP, logo:mark}`; no country |
| LB-010 | SHELL, PRE, FAIL | govbar crest `profile.ministry?.logo \|\| 'logo-fmoh.png'` (whitened, `home.css:52-56`) | dash/public/ui/src/widgets/pub-govbar/index.tsx:25 | L-bundle | fallback (profile has no logo → FMoH) | FMoH emblem | **FMoH emblem on Zambia** | `brand.logo ‖ mark` |
| LB-011 | SHELL, PRE, FAIL | footer crest, same fallback | dash/public/ui/src/widgets/pub-footer/index.tsx:15 | L-bundle | fallback | FMoH emblem | FMoH emblem | same as LB-010 |
| LB-012 | SHELL (Articles page) | "Weekly PHEM surveillance bulletins, official press releases from the **Federal Ministry of Health**, and public-health advisories from **Ethiopia's** health institutions…" | dash/public/ui/src/widgets/pub-articles/index.tsx:157-158 | L-bundle | hard-coded | same | same (Ethiopia on Zambia) | use deck `newsroom.sub` |
| LB-013 | SHELL (Dashboards modal) | audience "**FMoH staff** · RHB · programme directors" | dash/public/ui/src/widgets/pub-dashboards-modal/index.tsx:62 | L-bundle | hard-coded | same | same | "Ministry staff · regional teams · programme directors" (or deck key) |
| LB-014 | SHELL (Access modal) | `<h2>Request NHDW access</h2>` | dash/public/ui/src/widgets/pub-access-modal/index.tsx:303 | L-bundle | hard-coded | same | same | "Request access" (`DIP` in sub-line) |
| LB-015 | SHELL (Access modal) | email placeholder `tigist.bekele@moh.gov.et` | pub-access-modal/index.tsx:409 | L-bundle | hard-coded | same | same | `name@organisation.org` |
| LB-016 | SHELL (Access modal) | org placeholder "FMoH / RHB / EPHI / Partner" | pub-access-modal/index.tsx:418 | L-bundle | hard-coded | same | same | "Ministry / regional office / partner" |
| LB-017 | SHELL (Access modal) | "By submitting, you accept the **FMoH** data use agreement" | pub-access-modal/index.tsx:460 | L-bundle | hard-coded | same | same | "…the data use agreement" |
| LB-018 | SHELL (Access modal, submitted) | "Your request has been queued for **FMoH IT** review." | pub-access-modal/index.tsx:477 | L-bundle | hard-coded | same | same | "…queued for review." |
| LB-019 | SHELL (Access modal, submitted) | "…the **FMoH IT team** will respond within 2 business days." | pub-access-modal/index.tsx:493 | L-bundle | hard-coded | same | same | "the platform team" |
| LB-020 | EMPTY / FAIL (newsroom fallback) | bundled `ARTICLES`: authors "FMoH Communications", "FMoH Director-General", "FMoH State Minister", "The Federal Ministry of Health announced…" | dash/public/ui/src/data/articles.ts:28-107 | L-bundle | fallback; et-v3 only (zm-v1 deck sets `articles: []`) | shown only if `/api/proxy/articles` is empty or failing (live has DB articles) | empty newsroom | delete the bundled articles (content, not brand) |
| LB-021 | SHELL (newsroom, live data) | DB articles authored "FMoH Communications", "EPHI Surveillance" (`ops_governance.public_article`, seed `bundle/seed-pack/app/articles/articles.yaml:30,80,137`) | gw/routes/public_articles.py:52-74 | L-curl | **not profile-scoped** | OK as data-source attribution | **Ethiopian bulletins on Zambia** | scope articles by profile (§5) |
| LB-022 | DOM (orphan URL) | legacy pre-React script `/static/js/home.js` (FMoH articles, "Roles: FMoH staff…") | dash/public/static/js/home.js:23-67,163 | L-curl 200 | hard-coded | reachable, not referenced | same | delete from image |
| LB-023 | DOM (orphan URL) | `/static/assets/moh-logo.png`, `moh-logo-sm.png` | dash/public/static/assets/ | L-curl 200 | n/a | reachable, unused | same | delete |
| LB-024 | DOM | sprite comment "NHDW Icon Library · government-formal line-art set", injected into `#icon-sprite` | dash/public/static/assets/icons.html:2 (same in internal-bi, admin, workshop) | L-curl | hard-coded | DOM only | same | reword comment |
| LB-025 | API | FastAPI title "NHDW — Public Dashboard" (`/openapi.json` public, 200) | dash/public/app/main.py:54 | L-curl | hard-coded | same | same | "DIP — Public portal API" (or disable openapi) |
| LB-026 | API (JSON) | `/api/access-points` `use_when`: "…pushing your monthly returns into NHDW." | dash/public/app/main.py:198 | L-curl | hard-coded | not rendered by the SPA | same | "…into the platform." |
| LB-027 | metadata | catalog description "The anonymous-public face of NHDW…" | dash/public/catalog/dashboard.yaml:3 | code (not rendered; admin Dashboard Control does not render descriptions) | n/a | — | — | reword |

### 1b. Internal BI (`internal-bi.…`, realm moh-staff)

| id | state | string / asset | file:line | live? | profile-driven? | et-v3 | zm-v1 | replacement |
|---|---|---|---|---|---|---|---|---|
| LB-040 | HTML | `<title>NHDW Internal BI · Federal Ministry of Health · Ethiopia</title>` | dash/internal-bi/ui/index.html:5 | L-curl | hard-coded | same | same (Ethiopia) | "Internal BI · DIP" (+ page name via `document.title`) |
| LB-041 | HTML favicon | logo-fmoh.png | dash/internal-bi/ui/index.html:8 | L-curl | hard-coded | FMoH emblem | FMoH emblem | `mark` |
| LB-042 | SPL (unauthenticated redirect, session check, re-login after token expiry) | splash word-mark "NHDW" + "Signing you in…" | dash/internal-bi/ui/src/sections/AuthSplash.tsx:18 | L-bundle | hard-coded | same | same | `DIP` (+ `PbP` small) |
| LB-043 | AERR | `<title>Sign-in didn't complete: NHDW</title>` (page body has no brand) | dash/internal-bi/ui/src/api/useAuth.ts:163 | L-bundle | hard-coded | same | same | "Sign-in didn't complete · DIP" |
| LB-044 | SHELL, PRE, FAIL | sidehead title `useState('NHDW')`; replaced only if `/gw/profile` succeeds (live **401**) | dash/internal-bi/ui/src/sections/Sidebar.tsx:27,29-34,61 | L-bundle + L-curl 401 | intended profile-driven; **effectively hard-coded** | "NHDW" | "NHDW" (after a 401 fix: "Palladium") | bundled `DIP`; subtitle `PbP` / "Internal BI" |
| LB-045 | SHELL | sidehead icon: none (`logoSrc` only from profile `ministry.logo`) | Sidebar.tsx:26,55-58 | L-curl 401 | profile | no icon | no icon | bundled `mark` |
| LB-046 | SHELL | sidebar foot "**NHDW v1.0** · PROD / **National Health Data Warehouse**" | Sidebar.tsx:79-80 | L-bundle | hard-coded | same | same | delete (no version source; R1 §0.9) or "DIP · PbP" |
| LB-047 | SHELL (every page; also empty or denied page bodies) | breadcrumb "NHDW ›" | dash/internal-bi/ui/src/sections/Topbar.tsx:71 | L-bundle | hard-coded | same | same | delete the breadcrumb (R1 D1) |
| LB-048 | SHELL (AI panel) | "NHDW Assistant" | dash/internal-bi/ui/src/sections/ChatbotPanel.tsx:180 | L-bundle | hard-coded | same | same | "Assistant" |
| LB-049 | SHELL (latent: Predictions page not in `ops_perm.page`) | "Live output from NHDW's batch ML models…" | dash/internal-bi/ui/src/sections/Predictions.tsx:136 | L-bundle | hard-coded | not reachable | not reachable | "Live output from the platform's batch models…" |
| LB-050 | API | FastAPI "NHDW Internal BI" (`/openapi.json` 200) | dash/internal-bi/app/main.py:135 | L-curl | hard-coded | same | same | "DIP — Internal BI API" |
| LB-051 | SHELL (export / report artefacts) | citation "NHDW · {mart} · exported by … / generated by …" written into the export record and report files | gw/routes/exports.py:158; gw/routes/reports.py:237 | code (embedded in generated files) | hard-coded | same | same | "Data Intelligence Platform · {mart} · …" |

### 1c. Admin console (`admin.…`, realm privileged-ops)

| id | state | string / asset | file:line | live? | profile-driven? | et-v3 | zm-v1 | replacement |
|---|---|---|---|---|---|---|---|---|
| LB-060 | HTML | `<title>Infrastructure &amp; Access Management · NHDW</title>` | dash/admin/ui/index.html:5 | L-curl | hard-coded | same | same | "Admin · DIP" |
| LB-061 | HTML favicon | logo-fmoh.png | dash/admin/ui/index.html:7 | L-curl | hard-coded | FMoH | FMoH | `mark` |
| LB-062 | SPL | splash "NHDW" | dash/admin/ui/src/sections/AuthSplash.tsx:18 | L-bundle | hard-coded | same | same | `DIP` |
| LB-063 | AERR | `<title>Sign-in didn't complete \| NHDW</title>` | dash/admin/ui/src/api/useAuth.ts:163 | L-bundle | hard-coded | same | same | as LB-043 |
| LB-064 | PRE, FAIL (= SHELL today) | `BUNDLED.platform = {name:'National Health Data Warehouse', abbr:'NHDW'}`, `ministry.name = 'Ministry of Health'` | dash/admin/ui/src/hooks/useProfile.ts:53-54 | L-bundle + L-curl 401 | bundled fallback (profile 401) | NHDW | NHDW | `brand:{product:DIP, attribution:PbP}` |
| LB-065 | SHELL | sidehead `.title` `profile.platform?.abbr \|\| 'NHDW'` (no icon) | dash/admin/ui/src/sections/Sidebar.tsx:121-125 | L-bundle | profile (401) | "NHDW" | "NHDW" | `DIP` + `PbP` |
| LB-066 | EMAIL (preview in Access requests review) | subject "Your **NHDW** access request {id} has been approved / was not approved" | dash/admin/ui/src/adminApp.ts:217-218 | L-bundle | hard-coded | same | same | "Your Data Intelligence Platform access request…" |
| LB-067 | EMAIL (preview) | body "…access request to the **National Health Data Warehouse**…" (approved and declined), "…to the **NHDW** ({id})" (more info) | adminApp.ts:228,241,247 | L-bundle | hard-coded | same | same | "…to the Data Intelligence Platform…" |
| LB-068 | EMAIL (preview) | `https://nhdw.local/login/setup?token=XXXX` | adminApp.ts:234 | L-bundle | hard-coded | same | same | real sign-in URL (`_dash_url`) or remove |
| LB-069 | EMAIL (preview) | sign-off `[ministry.name, platform.abbr]` → "**Ministry of Health · NHDW**" | adminApp.ts:28-31 | L-bundle | profile (401 → bundled) | "Ministry of Health · NHDW" (after a 401 fix: "Palladium · Palladium") | same | "The Data Intelligence Platform team" |
| LB-070 | SHELL (Alerts routing) | placeholder `ops-oncall@moh.gov.et · @platform` | dash/admin/ui/src/widgets/adm-alerts-routing/index.tsx:171 | L-bundle | hard-coded | same | same | `oncall@example.org` |
| LB-071 | API (public `/docs` + `/openapi.json`) | "NHDW Admin" / "NHDW Admin - Swagger UI" | dash/admin/app/main.py:126 | L-curl | hard-coded | same | same | "DIP — Admin API" (and close `/docs`) |
| LB-072 | SHELL (identifier display) | topology nodes and docs page show `nhdw-gateway`, `nhdw-trino`, `nhdw-ollama`, `nhdw-docs` | dash/admin/ui/src/topology/renderTopology.ts:272-478; widgets/adm-documentation/index.tsx:226 | L-bundle | hard-coded | same | same | show labels ("Gateway", "Query engine"); **keep the ids** |
| LB-073 | SHELL (content) | Documentation page serves `docs/*.md` from bucket `nhdw-docs` (NHDW-branded prose) | dash/admin/ui/src/api/docs.ts:4 | code | n/a | — | — | content re-edit (out of string scope) |
| LB-074 | dev-auth only | mock users `ops-admin@nhdw.local` / `dev@nhdw.local` | dash/admin/app/main.py:98; dash/workshop/app/main.py:99 | code (DEV_AUTH only) | — | — | — | `@example.org` |

### 1d. Workshop (`workshop.…`, realm moh-staff)

| id | state | string / asset | file:line | live? | profile-driven? | et-v3 | zm-v1 | replacement |
|---|---|---|---|---|---|---|---|---|
| LB-080 | HTML | `<title>NHDW Workshop · Community portal · FMoH Ethiopia</title>` | dash/workshop/ui/index.html:5 | L-curl | hard-coded | same | same (FMoH Ethiopia) | "Workshop · DIP" |
| LB-081 | HTML favicon | logo-fmoh.png | dash/workshop/ui/index.html:7 | L-curl | hard-coded | FMoH | FMoH | `mark` |
| LB-082 | SPL | splash "NHDW" | dash/workshop/ui/src/sections/AuthSplash.tsx:18 | L-bundle | hard-coded | same | same | `DIP` |
| LB-083 | AERR | `<title>Sign-in didn't complete \| NHDW</title>` | dash/workshop/ui/src/api/useAuth.ts:163 | L-bundle | hard-coded | same | same | as LB-043 |
| LB-084 | PRE, FAIL (= SHELL today) | `BUNDLED.platform` NHDW / National Health Data Warehouse; `ministry.name` "Ministry of Health" | dash/workshop/ui/src/hooks/useProfile.ts:53-54 (identical to admin) | L-bundle + 401 | bundled fallback | NHDW | NHDW | as LB-064 |
| LB-085 | SHELL | sidehead `platform?.abbr \|\| 'NHDW'` (no icon) | dash/workshop/ui/src/App.tsx:85 | L-bundle | profile (401) | "NHDW" | "NHDW" | `DIP` + `PbP` |
| LB-086 | SHELL (incl. denied, empty and "catalog could not be loaded" states) | footer "Community Workshop Portal · **NHDW**" | dash/workshop/ui/src/sections/Footer.tsx:23 | L-bundle | profile (401) | "…· NHDW" | same | "Community Workshop · DIP" |
| LB-087 | SHELL | footer owner = `workshop.footer_owner` ‖ `ministry.name · country.official_name` → "**Ministry of Health**" | Footer.tsx:17-18 | L-bundle | profile (401 → bundled) | "Ministry of Health" (after a 401 fix: "Palladium · Federal Democratic Republic of Ethiopia") | same (after fix: "Palladium · Republic of Zambia") | `PbP` (owner line = country only) |
| LB-088 | API (public `/docs`) | "NHDW Workshop" / "NHDW Workshop - Swagger UI" | dash/workshop/app/main.py:127 | L-curl | hard-coded | same | same | "DIP — Workshop API" |
| LB-089 | SHELL (JupyterLab, launched from Workshop) | notebook H1 "MLflow quickstart — NHDW workshop" | 6_access-points/jupyterhub/singleuser/mlflow_quickstart.ipynb:7 | code (in the lab image) | hard-coded | same | same | "MLflow quickstart" |

### 1e. dbt-docs (`dbt-docs.…`, OIDC gated)

| id | state | string / asset | file:line | live? | profile-driven? | et-v3 | zm-v1 | replacement |
|---|---|---|---|---|---|---|---|---|
| LB-090 | HTML | `<title>NHDW — Data lineage · dbt docs</title>` | dash/dbt-docs/html/index.html:5 | L-md5 | hard-coded | same | same | "Data lineage · DIP" |
| LB-091 | SHELL | top bar `brand-mark` "NHDW" | dash/dbt-docs/html/index.html:14 | L-md5 | hard-coded | same | same | `DIP` |
| LB-092 | HTML | no favicon link | dash/dbt-docs/html/index.html | L-md5 | — | browser default | same | add `mark` |
| LB-093 | API | FastAPI "NHDW — dbt docs" (docs disabled; `/openapi.json` redirects 307 to login) | dash/dbt-docs/app/main.py:147 | code | hard-coded | not reachable | — | reword |

### 1f. Gateway, tool-gate, mail senders

| id | state | string | file:line | live? | profile-driven? | et-v3 | zm-v1 | replacement |
|---|---|---|---|---|---|---|---|---|
| LB-100 | API (public) | "NHDW Gateway" (`/openapi.json`) / "NHDW Gateway - Swagger UI" (`/docs`) | gw/main.py:101 | L-curl | hard-coded | same | same | "DIP Gateway API" |
| LB-101 | EMAIL (onboarding, sent on approval) | "Your request for access to the **Ethiopia National Health Data Warehouse** has been approved…" | gw/routes/access_requests.py:307 | code (mail path) | hard-coded | same | **Ethiopia on Zambia** | "…access to the Data Intelligence Platform…" |
| LB-102 | EMAIL | "You can sign in at the **NHDW** portal: …" | gw/routes/access_requests.py:304 | code | hard-coded | same | same | "…sign in at {url}" |
| LB-103 | EMAIL subject | "Your **NHDW** access is ready — sign in and set your password" | gw/routes/access_requests.py:319 | code | hard-coded | same | same | "Your Data Intelligence Platform access is ready…" |
| LB-104 | EMAIL (alert subscription) | subject "[NHDW alert] {disease} — {region}"; body "…alerts on the NHDW dashboard." | gw/routes/alerts.py:505,508 | code | hard-coded | same | same | "[DIP alert] …"; "…on the Data Intelligence Platform." |
| LB-105 | EMAIL From | default `SMTP_FROM = "alerts@nhdw.moh.gov.et"` (live value comes from `smtp-secrets`, not inspected) | gw/settings.py:105 | unverif. | env | ? | ? | neutral sender + display name "Data Intelligence Platform" |
| LB-106 | EMAIL From (Alertmanager) | `smtp_from: "${SMTP_FROM:-alerts@nhdw.moh.gov.et}"` | 1_infrastructure/k8s/base/observability/alertmanager.yaml:49 | unverif. | env | ? | ? | same as LB-105 |
| LB-107 | FAIL (profile directory missing or `_shared`) | gateway fallback manifest `platform {name:'National Health Data Warehouse', abbr:'NHDW'}`, `ministry.name 'Ministry of Health'` → resolved copy "NHDW", "National Health Data Warehouse · NHDW", "Ministry of Health · " | gw/routes/profile.py:180-181 | code (in live image) | fallback | — | — | `DIP` / `PbP`, ministry `''` |
| LB-108 | API (public, 4 hosts) | "NHDW tool-gate · {mlflow, prometheus, seaweedfs, alertmanager}" (`/openapi.json` 200; headlamp gate on the admin host) | 6_access-points/api/tool-gate/app/main.py:185 | L-curl | env TOOL_NAME | same | same | "{Tool} gate · DIP"; disable openapi |
| — | ERR 403 | tool-gate 403 page `Access denied — {TOOL_NAME}`: **no legacy brand** (no brand at all) | tool-gate/app/main.py:155-169 | code | — | — | — | add `DIP` header |

### 1g. Keycloak (`keycloak.…`; theme `nhdw` on realms moh-staff and privileged-ops)

Only `login.ftl` and `template.ftl` are overridden (`parent=base`). Every other login-type page imports **our** `template.ftl`, so rows LB-120 to LB-124 appear on **every** page in these states: login, AERR, LOGOUT, EXP, ERR, and also update-password, OTP setup and OTP entry, IdP-link and info pages. Live theme files are md5-identical to the repo. There is no custom email or account theme: account is stock `keycloak.v3` ("Account Management"); email is stock.

Live pages checked [L-curl]:

| Realm | Page | HTTP status |
|---|---|---|
| moh-staff, privileged-ops | login | 200 |
| both | "Client not found." | 400 |
| both | "Invalid parameter: redirect_uri" | 400 |
| both | logout "Do you want to log out?" | 200 |
| both | "Cookie not found…" | 400 |
| both | "Page has expired" | 200 |
| both | "Reset Credential not allowed" | 400 |
| master | login: stock "Sign in to Keycloak" | — |
| ehia-saml-mock | login: stock "Sign in to EHIA (mock SAML IdP)" | — |

Neither master nor ehia-saml-mock carries legacy branding.

| id | state | string / asset | file:line | live? | profile-driven? | et-v3 | zm-v1 | replacement |
|---|---|---|---|---|---|---|---|---|
| LB-120 | LOGIN, AERR, LOGOUT, EXP, ERR | `<title>${msg("loginTitle", realm.displayName!'NHDW')}` → live "Sign in to Palladium" (fallback 'NHDW'; logout and error pages also say "Sign in to…") | kc/themes/nhdw/login/template.ftl:8 | L-curl | realm displayName (not profile) | "Sign in to Palladium" | same | displayName `DIP`; neutral title on non-login pages |
| LB-121 | all KC pages | `img/logo-fmoh.png`, alt "**Federal Ministry of Health emblem**" | template.ftl:18; resources/img/logo-fmoh.png | L-curl, L-md5 | hard-coded | FMoH | FMoH | `mark` (new filename), alt "Data Intelligence Platform" |
| LB-122 | all KC pages | brand-name `realm.displayName!'Ethiopia NHDW'` (live "Palladium") | template.ftl:19 | L-curl | realm | "Palladium" | same | `DIP` |
| LB-123 | all KC pages | brand-sub "**National Health Data Warehouse**" | template.ftl:20 | L-curl | hard-coded | same | same | `PbP` |
| LB-124 | all KC pages | footer "**Federal Ministry of Health · Ethiopia**" | template.ftl:53 | L-curl | hard-coded | same | **Ethiopia on Zambia** | remove, or a `PbP` line |
| LB-125 | LOGIN | lead "Sign in with your **Ministry of Health** account." | kc/themes/nhdw/login/login.ftl:5 | L-curl | hard-coded | same | same | "Sign in with your organisation account." |
| LB-126 | LOGIN | username placeholder `you@moh.gov.et` | login.ftl:13 | L-curl | hard-coded | same | same | `you@organisation.org` |
| LB-127 | LOGIN (comment) | "(the header already says 'Ethiopia NHDW')" | kc/themes/nhdw/login/messages/messages_en.properties:1-2; theme.properties:1; css/brand.v2.css:2-4 | code | — | not visible | — | reword comments |
| LB-128 | all KC pages + EMAIL + OTP label (after any reseed) | seed `REALM_DISPLAY = {"moh-staff": "Ethiopia NHDW", "privileged-ops": "NHDW Operations"}`; the **live ConfigMap `keycloak-seed-script` still contains it** (lines 878-879) | kc/scripts/setup-keycloak.py:874-877 | L (ConfigMap) | — | reverts to "Ethiopia NHDW" on reseed | same | `DIP` for both |
| LB-129 | fresh install (`--import-realm`) | realm JSON `displayName` "NHDW — MoH Staff" / "NHDW — Privileged Operations" | kc/realm-configs/moh-staff.json:3; privileged-ops.json:3 | code | — | — | — | `DIP` |
| LB-130 | account console "Applications", consent | client names "NHDW Internal BI", "NHDW Community Workshop", "NHDW Submission Portal", "NHDW DS Workspace", "NHDW Ops Hub" (moh-staff); "NHDW Admin console", "NHDW Ops Hub" (privileged-ops) | kc/realm-configs/moh-staff.json:83,107,151,174,197; privileged-ops.json:53,112 | unverif. | — | ? | ? | "Internal BI", "Admin console"… (no product prefix needed) |
| LB-131 | passkey / security-key dialogs (privileged-ops) | `webAuthnPolicyRpEntityName "NHDW Privileged Ops"` | kc/realm-configs/privileged-ops.json:19 | unverif. | — | ? | ? | "Data Intelligence Platform (operations)" |
| LB-132 | EMAIL (Keycloak execute-actions / reset) | `fromDisplayName "Ethiopia NHDW"`, from `noreply@nhdw.moh.gov.et` (if no SMTP_USER); stock email bodies say "…your {realm displayName} account" | kc/scripts/setup-keycloak.py:914-915 | unverif. | — | ? (realm name part: "Palladium") | same | from-name `DIP` |
| LB-133 | OTP config (TOTP issuer label) | issuer = realm displayName (live "Palladium"; "Ethiopia NHDW" after a reseed) | Keycloak behaviour + LB-128 | L (displayName) | realm | "Palladium" | same | `DIP` |

### 1h. Profiles (bundle + host)

| id | state | string / asset | file:line | live? | effect |
|---|---|---|---|---|---|
| LB-140 | every profile-driven slot, if repo profiles are redeployed | repo et-v3: `ministry {abbr: FMoH, name: Federal Ministry of Health, native_name, logo: logo-fmoh.png}`, `platform {name: National Health Data Warehouse, abbr: NHDW, native_name}` | bundle/profiles/et-v3/profile.yaml:35-42 | code (host differs: hand-edited "Palladium" / "Data Intelligence Platform", not in git) | a deploy from git restores the legacy brand on public; the Palladium identity exists only on the host |
| LB-141 | same | repo zm-v1: `ministry {abbr: MoH, name: Ministry of Health}`, `platform {name: National Health Data Warehouse, abbr: NHDW}` | bundle/profiles/zm-v1/profile.yaml:33-40 | code | as above |
| LB-142 | profile asset | `et-v3/assets/logo-fmoh.png` (repo and host); zm-v1 assets = README only | bundle/profiles/et-v3/assets/; /opt/nhdw-profiles/et-v3/assets/ | host file | served at `/gw/profile/asset/…` if `ministry.logo` is set |
| LB-143 | deck structure | brand slots bound to `{ministry.*}`: `govbar.mark_tag`, `hero.strip_owner`, `footer.owner_line`, `newsroom.sub`, common `workshop.footer_owner` | bundle/profiles/{et-v3,zm-v1}/copy/public.json:6,18,31,156; common.json:10-12 (host = repo, byte-identical) | L-curl (resolved) | the ministry is overloaded as brand, which produces "Palladium · Ethiopia", "press releases from Palladium", "from the Palladium" (zm) and "Palladium · Palladium" (admin sign-off after a 401 fix) |
| LB-144 | SHELL (public, live) | et-v3 deck tokens `{ministry.native_name}`, `{platform.native_name}`, unresolved because the host profile dropped those keys | bundle/profiles/et-v3/copy/public.json:18,22 | L-curl | literal braces on the live public hero (R1) |

### 1i. Third-party tools and infrastructure

| id | access point | string | file:line | live? | note |
|---|---|---|---|---|---|
| LB-150 | Superset (SQL Lab database picker) | database name "NHDW Marts (Trino)" | dash/superset/config/create_trino_db.py:13 | unverif. (Superset title is stock "Superset") | **renaming changes the lookup key** (`filter_by(database_name=NAME)`, :21), so a rename creates a duplicate DB; rename it in place via the UI or a migration |
| LB-151 | Helm (`helm list`/`show`) | Chart description "NHDW — umbrella chart for the National Health Data Warehouse…" | 1_infrastructure/helm/nhdw/Chart.yaml:3 | code | operator-visible only |
| LB-152 | Grafana (not deployed) | folder "NHDW" | 4_monitoring/grafana/provisioning/dashboards/dashboards.yml:6 | not deployed | latent |
| — | Airflow, OpenMetadata, MLflow, JupyterHub, Prometheus, Alertmanager, SeaweedFS | stock titles ("Sign In - Airflow", "OpenMetadata", "Superset"); provider "keycloak" | — | L-curl | **no legacy brand**; leave as is |
| — | Traefik unknown host | stock "404 page not found" | — | L-curl | no brand |
| — | SPA unknown route / `/index.html` | `{"detail":"Not Found"}` JSON 404 | — | L-curl | no brand (and no SPA 404 page) |
| — | Palladium console (`console.…`) | "Projects Console", Palladium | /opt/palladium-console (not in repo) | L-curl | already on-brand |
| — | `s3.…/` anonymous ListBuckets | bucket name `nhdw-static` | — | L-curl | technical identifier; keep |

---

## 2. Matrix: access point × state (count of LB rows visible in that state)

A row that appears in several states is counted in each of them.

| Access point | HTML | PRE | FAIL | SPL | SHELL | LOGIN | AERR | LOGOUT | EXP | ERR | EMPTY | EMAIL | API | DOM/orphan | total distinct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Public | 2 | 9 | 9 | – | 10 | – | – | – | – | 0 | 1 | – | 2 | 3 (+1 metadata) | 27 |
| Internal BI | 2 | 1 | 1 | 1 | 6 | – | 1 | – | 1 (via SPL) | 1 (breadcrumb on denied) | 1 | – | 1 | – | 12 |
| Admin | 2 | 1 | 1 | 1 | 4 | – | 1 | – | 1 (via SPL) | 0 | 0 | 4 | 1 | – | 15 |
| Workshop | 2 | 1 | 1 | 1 | 5 | – | 1 | – | 1 (via SPL) | 2 (footer on denied) | 2 | – | 1 | – | 10 |
| dbt-docs | 2 | – | – | – | 1 | – | – | – | – | 0 (raw JSON 403) | – | – | 1 (unreachable) | – | 4 |
| Gateway / tool-gate | – | – | 1 | – | – | – | – | – | – | 0 | – | 6 | 2 | – | 9 |
| Keycloak | – | – | – | – | – | 7 | 5 | 5 | 5 | 5 | – | 2 | – | – | 14 |
| Profiles (repo/host) | – | – | – | – | 2 | – | – | – | – | – | – | – | – | – | 5 |
| Third-party / infra | – | – | – | – | 1 | – | – | – | – | – | – | – | – | – | 3 |
| **Total** | **10** | **12** | **13** | **3** | **29** | **7** | **8** | **5** | **8** | **8** | **4** | **12** | **8** | **3** | **≈99** |

How to read the EXP column:
- For the staff SPAs, an expired token on reload leads to `/auth/me` failing, then the AuthSplash ("NHDW"), then the Keycloak login (LB-120 to LB-126), or a silent SSO re-entry. There is no SPA-specific expiry screen.
- "Page has expired" is the Keycloak page.

---

## 3. Identity shown before the profile loads, and when the profile request fails

| App | Before JS (first paint) | Before profile (first React paint) | Profile request fails | Profile loads (live today) | Flash? |
|---|---|---|---|---|---|
| **Public** | Blank page; tab "NHDW · Federal Ministry of Health · Ethiopia"; FMoH favicon | `BUNDLED_COPY` + `BUNDLED`: govbar "NHDW" / "Federal Ministry of Health · Ethiopia" + FMoH crest; strip "Federal Ministry of Health · የጤና ሚኒስቴር"; hero "Ethiopia's health data," + Amharic native line + "…woreda in any of the 14 regions"; footer "National Health Data Warehouse · NHDW" / "Federal Ministry of Health · Federal Democratic Republic of Ethiopia". Fetch starts at module load (`useProfile.ts:150`); one gateway round trip | The proxy returns 200 `{_unavailable}`, so `ok()` is false and **all of the previous column persists**, on any profile including zm-v1. If only the copy fails: bundled legacy copy with profile data | "Palladium", "Palladium · Ethiopia", "Palladium · {ministry.native_name}", "{platform.native_name}", "Data Intelligence Platform · Palladium", "Palladium · Federal Democratic Republic of Ethiopia"; **FMoH crest kept** via merge and fallback | **Yes**: NHDW/FMoH, then Palladium on every cold load |
| **Public** (profile directory missing, gateway up) | as above | as above | Gateway `_fallback_manifest`: "NHDW", "National Health Data Warehouse · NHDW", "Ministry of Health · ", "All ", "Ministry of Health · " (LB-107) | — | — |
| **Internal BI** | Tab "NHDW Internal BI · Federal Ministry of Health · Ethiopia"; FMoH favicon | AuthSplash "NHDW / Signing you in…", then the shell: sidehead "NHDW" (`useState('NHDW')`), no icon; foot "NHDW v1.0 · PROD / National Health Data Warehouse"; breadcrumb "NHDW ›" | **Always fails today** (plain `fetch('/gw/profile')`, 401) → the previous column persists; reference labels stay "All areas" (neutral) | (never reached) | No flash; **legacy is permanent** |
| **Admin** | Tab "Infrastructure & Access Management · NHDW"; FMoH favicon | AuthSplash "NHDW"; sidehead `BUNDLED.platform.abbr` "NHDW", no icon | 401 → bundled: "NHDW"; e-mail sign-off "Ministry of Health · NHDW" | (never reached) | Permanent |
| **Workshop** | Tab "NHDW Workshop · Community portal · FMoH Ethiopia"; FMoH favicon | AuthSplash "NHDW"; sidehead "NHDW"; footer "Community Workshop Portal · NHDW / Ministry of Health" | 401 → same | (never reached) | Permanent |
| **dbt-docs** | Tab "NHDW — Data lineage · dbt docs"; bar "NHDW" (static, no profile) | n/a | n/a | n/a | Static legacy |
| **Keycloak** | Server-rendered; no JS phase | n/a (not profile-aware) | n/a | displayName "Palladium" + hard-coded NHDW/FMoH/Ethiopia | Static mix |

If the 401 were fixed **without** other changes, the staff SPAs would flash "NHDW" and then show "Palladium". The icon would stay absent on both host profiles, which have no `ministry.logo`; under the repo et-v3 profile it would be the FMoH crest.

---

## 4. Caching: can a returning client show the old identity after a rebrand deploy?

| Resource | Live headers (GET) | Risk after rebrand | Fix |
|---|---|---|---|
| public `/` (index.html) | `Cache-Control: no-cache, no-store, must-revalidate` (`public/app/main.py:68`) | none | — |
| internal-bi `/`, admin `/` | same no-store (`internal-bi/app/main.py:153`, `admin/app/main.py:210`) | none | — |
| **workshop `/`** | **no Cache-Control**; `ETag`, `Last-Modified: 2026-09-21` (`workshop/app/main.py:204`, bare FileResponse) | **Heuristic freshness** (about 10 % of age, so about 3 days today). A returning browser can show the **old title**, and the old hashed bundle names, which 404 on the new image, giving a blank page, without revalidating | add the same no-store header as admin |
| dbt-docs `/` | bare FileResponse, no Cache-Control (`dbt-docs/app/main.py:283`) | same heuristic risk (behind auth) | add no-cache |
| `/assets/index-<hash>.js/.css` (all SPAs) | no Cache-Control; ETag + Last-Modified; **content-hashed names** | none: a new build gets new names | optional `immutable, max-age=1y` |
| `/static/assets/logo-fmoh.png` (favicon + crest) | no Cache-Control; `Last-Modified: 2026-08-20` | heuristic cache (about 6 days); **browser favicon caches are sticky** (often weeks). Overwriting the file *content* under the same name will keep showing the emblem | ship the new mark under a **new filename**; repoint `index.html`, the govbar and footer fallback, and the KC template |
| `/static/assets/icons.html` | no Cache-Control | comment only; no visible risk | — |
| Keycloak theme resources `/resources/h580u/login/nhdw/...` | `Cache-Control: no-cache` (`start-dev`) | none now. In production mode (`start`) resources get long max-age, but the path is versioned per KC start, and the template HTML is never cached | new logo filename anyway |
| `/api/proxy/profile*`, `/gw/profile*` | no Cache-Control, no validators → not cached by browsers | gateway in-process TTL **20 s** (`NHDW_PROFILE_TTL`, `profile.py:58`): up to 20 s of the old identity after a profile edit | — |
| Service worker / PWA | none: no `sw.js`, no `navigator.serviceWorker` in any `src`, `/manifest.json` 404, no apple-touch-icon | none | — |
| localStorage / sessionStorage | **no profile or copy cached**. Only tokens in sessionStorage (`nhdw_bi_at`, `nhdw_admin_at`, `nhdw_workshop_at`, `pkce_*`) and BI display preferences in localStorage (`nhdw.bi.display.*`) | none | — |
| In-memory | module-level `cache` per page load (`useProfile.ts`) | open tabs keep the old bundle until reload | — |
| Browser history, bookmarks, pinned tabs | old `<title>` and favicon stored by the browser | cosmetic, persists until revisit | — |

---

## 5. Hard-coded Ethiopian context that leaks onto zm-v1

"Visible on zm-v1?" assumes host zm-v1 is activated. Pages that zm-v1's `catalog.yaml` disables (overview, disease, service, resource) are marked latent.

| # | Where | String / behaviour | file:line | Visible on zm-v1? |
|---|---|---|---|---|
| Z1 | Public `<title>` | "…Federal Ministry of Health · **Ethiopia**" | dash/public/ui/index.html:5 | **yes**, every load |
| Z2 | Public govbar and footer crest | Ethiopian FMoH emblem via `BUNDLED.ministry.logo` merge + `'logo-fmoh.png'` fallback (zm-v1 has no logo) | useProfile.ts:51-52,128; pub-govbar/index.tsx:25; pub-footer/index.tsx:15 | **yes**, always |
| Z3 | Public favicon | FMoH emblem | dash/public/ui/index.html:7 (and all SPAs and KC) | **yes** |
| Z4 | Public first paint / failed profile | "Ethiopia's health data,", Amharic lines, "woreda in any of the 14 regions", "Federal Democratic Republic of Ethiopia" | useProfile.ts:44-93 | **yes**: flash on every cold load; permanent on failure |
| Z5 | Public Articles page intro | "…Federal Ministry of Health… Ethiopia's health institutions…" | pub-articles/index.tsx:157-158 | **yes** |
| Z6 | Public newsroom (live DB) | FMoH / EPHI / Somali-region bulletins; `public_article` is not filtered by profile; zm-v1's `articles: []` applies only when the live fetch is empty | gw/routes/public_articles.py:52-74; bundle/seed-pack/app/articles/articles.yaml | **yes** |
| Z7 | Public Dashboards modal | "FMoH staff · RHB · programme directors" | pub-dashboards-modal/index.tsx:62 | **yes** |
| Z8 | Public Access modal | Fayda (Ethiopian national ID, FAN/FIN regex) verification block and 10 messages; `@moh.gov.et`; "FMoH / RHB / EPHI"; "FMoH data use agreement"; "FMoH IT" | pub-access-modal/index.tsx:33-210,409-493 | **yes** |
| Z9 | Public region chart fallback | 14 Ethiopian region names when live region data is absent | dash/public/ui/src/hooks/charts.ts:44 | if the live data is empty |
| Z10 | Public datasets fallback | `DATASETS` (EPHI, CSA, woreda, HSTP-II) when the live catalogue is empty | dash/public/ui/src/data/datasets.ts:20-31; hooks/useDatasets.ts:62 | if the live data is empty |
| Z11 | BI alert modal (any page) | "**All Ethiopia (national)**" option; chip "All Ethiopia" | dash/internal-bi/ui/src/modals/AlertModal.tsx:74,121 | **yes** |
| Z12 | BI `<title>` | "…Federal Ministry of Health · Ethiopia" | dash/internal-bi/ui/index.html:5 | **yes** |
| Z13 | BI Disease map lead | "…across Ethiopia's regions" | widgets/dz-region-map/widget.ts:184 | latent (disease page off) |
| Z14 | BI Overview KPIs and benchmarks | "Of 14 regions", "HSTP-II indicators"; static 17,550 / 107.3M / 14 / 1,082 | widgets/ov-national-kpis/widget.ts:14,17; ov-benchmarks/widget.ts:15-18 | latent (overview off) |
| Z15 | BI Service / Resource | "Targets: HSTP-II flagship"; unit "ETB {v}M"; "Woreda" column labels | sv-flagship-table/widget.ts:57; rm-statboard/widget.ts:20; dz-woreda-table:52, sv-risk-woredas:39, ov-act-first-woredas:47, dz-outbreaks-table:64 | latent (pages off) |
| Z16 | BI Control Tower static plan | Ethiopian EPSS hubs and 160+ facilities shipped in the bundle (`import * as STATIC`) but not rendered (runtime has no fallback) | dash/internal-bi/ui/src/ct/data/plan.ts:39-45; ct/data/runtime.ts:10 | no (dead weight) |
| Z17 | Workshop `<title>` | "…FMoH Ethiopia" | dash/workshop/ui/index.html:5 | **yes** |
| Z18 | Keycloak every page | footer "Federal Ministry of Health · **Ethiopia**"; "Ministry of Health account"; `you@moh.gov.et` | kc/themes/nhdw/login/template.ftl:53; login.ftl:5,13 | **yes** (not profile-aware) |
| Z19 | Gateway onboarding e-mail | "…access to the **Ethiopia** National Health Data Warehouse" | gw/routes/access_requests.py:307 | **yes** |
| Z20 | Keycloak seed e-mail sender | fromDisplayName "**Ethiopia** NHDW"; displayName "Ethiopia NHDW" on reseed | kc/scripts/setup-keycloak.py:875,915 | **yes** after reseed |

Related trap (R1): `/opt/nhdw-profiles/ACTIVE = zm-v1`, but `/opt/nhdw-state/ACTIVE = et-v3` wins. Deleting the state file switches the deployment to Zambia with all of the above.

---

## 6. Don't-rename list (technical identifiers)

**R1 §6 is confirmed, with one correction:** the token keys are `nhdw_bi_at`, `nhdw_admin_at` and `nhdw_workshop_at` (`*/ui/src/api/useAuth.ts:47`). R1 wrote `nhdw_internal-bi_at`, which is wrong.

**Additions to R1's list:**
- **Gateway API tokens:** PAT prefix `nhdw_pat_` (`gw/auth.py:5,153`, `gw/main.py:130`). Issued tokens are recognised by this prefix, so renaming it breaks every PAT already issued.
- **Keycloak:**
  - theme directory `nhdw`, which appears in the public resource URL `/resources/<v>/login/nhdw/…`;
  - stylesheet `brand.v2.css` (versioned name used for cache-busting; bump it to `brand.v3.css` on redesign instead of renaming in place);
  - body class `nhdw-login`;
  - ConfigMaps `keycloak-seed-script`, `keycloak-realm-configs`, `keycloak-users-seed`;
  - env `NHDW_USERS_YAML`.
- **Superset:** database name "NHDW Marts (Trino)" is a *lookup key* in `create_trino_db.py:21`. It is user-visible, so rename it, but in place in the Superset UI or by migration, and change the constant at the same time; otherwise you get a duplicate DB.
- **Environment and config:**
  - `NHDW_GATEWAY_URL`, `NHDW_GATEWAY_TIMEOUT_S`, `NHDW_BASE_DOMAIN`, `NHDW_MINIO_INTERNAL`, `NHDW_S3_ENDPOINT`;
  - `NHDW_LLM_MODEL/NUM_CTX/KEEP_ALIVE`, `NHDW_CHAT_*`;
  - `NHDW_PROFILE_TTL`;
  - `SMTP_FROM` (the key; the *value* should change).
- **Services and DNS:** `nhdw-gateway`, `nhdw-trino`, `nhdw-ollama`, `*.nhdw.svc.cluster.local`, the registry `nhdw-registry:5500`. In the admin topology, show labels and keep the ids (LB-072).
- **Buckets:** `nhdw-docs`, `nhdw-static`, `nhdw-raw` (`nhdw-static` is anonymously listable at `s3.…/`).
- **Python and lab artefacts:** module `nhdw_mlflow`, `nhdw_project_sync`, `start-nhdw.sh`; classes `NHDWSupersetSecurityManager`, `NHDWKeycloakSecurityManager`.
- **Asset filename** `logo-fmoh.png`. Keep the file (it is referenced in about 10 places and in host profile `et-v3/assets`). **Add** a new product mark under a new name, and repoint the references; do not overwrite the content (§4 favicon caching).
- **Profile copy-deck keys and placeholders** (`govbar.mark_text`, `{platform.abbr}`, …). Add new keys (`{brand.product}`, `{brand.attribution}`, `{brand.logo}`) instead of renaming existing ones.

**Rule (unchanged from R1):** strings that *display* an identifier ("Bearer · privileged-ops", "OIDC · Keycloak (moh-staff)", "nhdw-docs", "Scanning nhdw-raw manifests…") get new wording. The identifier itself stays.

---

