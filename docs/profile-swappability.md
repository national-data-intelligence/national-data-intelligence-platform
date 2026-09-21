# What a country profile actually swaps

A running audit of how much of the platform follows the active profile, and
what is still pinned to one country. Written 2026-09-21 while wiring the
remaining surfaces; update it when you change the answer.

## The mechanism

A profile lives in `bundle/profiles/<key>/` and has three layers that cost
wildly different amounts to swap:

| Layer | What it holds | Cost |
|---|---|---|
| presentation | copy decks, geography, branding, catalog tailoring | seconds, in-process |
| appsec | people, roles, scopes, policy | ~a minute, a seed step |
| data | source replicas → the whole pipeline | a full pipeline run |

The gateway serves the presentation layer:

    GET /api/profile                  the manifest
    GET /api/profile/copy/{surface}   a resolved copy deck
    GET /api/profile/geo/{name}       boundaries      (?profile= for a named one)
    GET /api/profile/reference        regions, programmes, diseases, commodities
                                                      (?profile= for a named one)
    GET /api/profile/asset/{name}     branding — the ministry crest
    GET /api/profile/catalog          what this country turns off

`?profile=` exists because a page whose DATA belongs to one country (the PCT
page is Zambian) must draw that country's geometry whatever the deployment is
showing. Only installed keys are served.

`/catalog` is consumed by the visibility resolver — `permissions.py::
_profile_disabled()` — and can only ever SUBTRACT visibility. A widget that
suits one country and not another is in the catalog for everyone and disabled
by the profiles it does not suit, rather than granted twice.

## Which surfaces follow the profile

| Surface | State |
|---|---|
| public | Fully wired — `hooks/useProfile.ts`, masthead, hero, footer, globe |
| internal-bi | Wired — reference tables, geography and the scope label come from the profile; crest and word-mark too |
| workshop | Wired — crest, word-mark, footer owner line, scope label |
| admin | Wired — crest, word-mark, the access-review area picker, the decision-email sign-off |

## What is still pinned, and why

**The Control Tower's Ethiopian basemap.** `ct/components/MapView.tsx` loads
`ethiopia.pmtiles` and centres on Ethiopia. That widget family shows Ethiopian
EPSS movement and, since decision 29, is off the Zambian page entirely — so it
never renders under a Zambian profile. It is Ethiopian by subject, not by
oversight. Making it country-general means shipping a basemap per country.

**The appsec layer for Zambia does not exist.** `zm-v1/profile.yaml` declares
`users.zm.yaml`; the file is not there. Switching to `zm-v1` swaps presentation
and leaves the Ethiopian cast in place.

**Six of seven data sources are still Ethiopian.** Only the eLMIS archive is
genuinely Zambian. `zm-v1`'s own manifest says so. A profile swap changes what
the dashboards SAY, not what the warehouse HOLDS — the demo-control route is
explicit that only `presentation` is applied in-process, and reports the other
two layers as not applied rather than showing a green tick over a warehouse
that never changed.

## Not every source exists in every country

This is the part that is easy to get wrong, and getting it wrong is worse than
leaving a gap.

The Ethiopian source replicas are synthetic, so the reflex is to synthesise
Zambian ones the same way. But several of these sources are not generic
categories — they are particular Ethiopian systems:

| Source | Is it a thing in Zambia? |
|---|---|
| eLMIS (OpenLMIS) | **Yes** — and its 2016-2018 archive is already ingested and real |
| HCMIS WDM | No. Ethiopia's national warehouse system |
| mBrana | No. An Ethiopian mobile reporting product |
| MFR | No. Ethiopia's Master Facility Registry |
| EthioEMR | No. An Ethiopian EMR |
| DHIS2 | The platform is global, but this deployment's instance is Ethiopia's |
| Climate / EWARS | Generic, but tied to the Ethiopian geography it was built on |

Generating "Zambian HCMIS" rows would model a system that does not exist there.
A demo that invents a country's national infrastructure is worse than one that
says it has no data for it.

So the rule is: **a source with no counterpart in the country is not
synthesised — the surfaces that depend on it are disabled in that profile's
`catalog.yaml`.**

### How to decide what to disable

Trace widget → mart → vault source. The marts name their sources in the vault
tables they read (`hub_elmis_…`, `sat_hcmis_…`), and `fetchers.py` binds each
widget to its marts. A widget whose every mart reads an absent source has
nothing to show.

Disable at the RIGHT GRAIN. `internal-bi/resource` is disabled for `zm-v1` as a
**page**, not as eleven widgets, because every section of it reads HCMIS: an
empty tab reads as broken, while an absent tab reads as inapplicable — and
page-tab elision already drops a page with no visible sections.

Every entry carries a `why`. It is rendered nowhere; it exists so the next
person learns why something is missing instead of assuming it broke.

## The rule for new surfaces

A string that names a country, a region, an administrative level, a ministry or
a fiscal calendar comes from the profile. Fallbacks are country-NEUTRAL: a
fallback that names a country renders that name on a deployment configured for
a different one every time the gateway blinks, which is the bug this mechanism
exists to remove.
