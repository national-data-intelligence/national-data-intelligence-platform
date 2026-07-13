# NHDW Dashboard Presentation Guide

A presenter's field guide to the Ethiopia **National Health Data Warehouse (NHDW)**
demo dashboards. The goal: let a presenter walk into a meeting and confidently
explain **what every page, section, widget, and metric means**, where the number
comes from, how to read it, what it does *not* say, and how to answer the questions
an audience is likely to ask.

> **Grounding promise.** Every statement in this guide is traced to the actual
> code, catalog, SQL, or dbt model in this repository — not to a mockup or a
> guess. Where the implementation does not fully pin something down (a refresh
> cadence, an external target value, a threshold rationale), the entry is
> explicitly marked **_requires confirmation_** rather than invented. If a widget
> shows an honest `NULL` because the data does not exist yet, this guide says so.

## How to use this guide

- **Before the meeting:** read [general.md](general.md) once end-to-end. It
  covers the shared vocabulary (regions, periods, denominators, colour/trend
  semantics, data-quality rules) that every page reuses. Then read the page file
  for whatever you will demo.
- **While preparing a specific page:** each page file follows the same shape —
  page overview → per-section purpose → per-widget deep dive (data source,
  fields, calculation, interpretation, limitations, common misinterpretations,
  talking points, likely Q&A).
- **When someone asks "how is X calculated?":** go to
  [metric-glossary.md](metric-glossary.md). Every metric is defined **once**
  there, with numerator/denominator/formula/units and the exact source columns.
- **When someone asks "where does this data come from?":** go to
  [data-sources.md](data-sources.md). It maps every widget to the mart/table/
  endpoint it reads.

## Table of contents

| File | What it covers |
|------|----------------|
| [general.md](general.md) | Shared design system: card & section hierarchy, colour/trend semantics, filter behaviour, data refresh, empty/error states, shared terminology, time periods, geographic levels, denominators, data-quality rules, interpretation guidance. |
| [bi-dashboard.md](bi-dashboard.md) | **Internal BI → Overview** page (the Decision Brief, national reliability, act-first woredas, system-trust band). |
| [disease-surveillance.md](disease-surveillance.md) | **Internal BI → Disease Surveillance** page (EWARS-style signal, burden map, outbreaks, anomaly trend, climate drivers). |
| [resource-management.md](resource-management.md) | **Internal BI → Resource Management** page (stockout watch, supply-stress geography, commodity detail, stockout→service impact). |
| [service-performance.md](service-performance.md) | **Internal BI → Service Performance** page (topline KPIs, flagship attainment, care cascades, reported-vs-recorded trust). |
| [public-portal.md](public-portal.md) | The **public** open-data portal (hero, KPIs, charts, Open Data catalogue, articles, access request). |
| [admin-dashboard.md](admin-dashboard.md) | The **admin** cockpit (topology/health, dashboard control, alert routing, quality & lineage, users, roles, SSO, documentation). |
| [metric-glossary.md](metric-glossary.md) | Every metric defined once: definition, numerator, denominator, formula, unit, aggregation, missing-value handling, trend/colour logic, source fields, interpretation. |
| [data-sources.md](data-sources.md) | Per-widget data provenance: the schema.table (or endpoint / mock location) each widget reads and the key columns. |

## The five dashboards at a glance

The demo ships five browser applications (single-page apps), each a separate
"access point" under `6_access-points/dashboards/`:

| Dashboard | Audience | This guide |
|-----------|----------|------------|
| **Internal BI** | Ministry decision-makers, programme managers, epidemiologists | [bi-dashboard](bi-dashboard.md), [disease](disease-surveillance.md), [resource](resource-management.md), [service](service-performance.md) |
| **Public portal** | Citizens, journalists, researchers, partners | [public-portal](public-portal.md) |
| **Admin** | Platform operators, data-governance & security admins | [admin-dashboard](admin-dashboard.md) |
| Workshop | Data scientists / analysts (JupyterLab, datasets, models) | *out of scope for this guide* |
| dbt-docs / Superset | Operator & analyst tools reached via SSO | *out of scope for this guide* |

## The one thing to remember about the data

This is a **real pipeline**, not a slideware mock. Numbers flow
`sources → dlt ingestors → data lake → ClickHouse → bridge → data vault → dbt
marts → gateway → dashboard`. The Internal-BI widgets read **governed marts**
(PostgreSQL `nhdw_vault`, `bi_*` schemas) through the gateway, which enforces
access with OPA before any SQL runs. When a real signal does not exist yet, the
widgets show an **honest empty state or a `NULL` column** — they **never fabricate
a number**. This is the single most important thing to convey to a technical
audience, and it is enforced in code (see `runtime/dataHook.ts`: "there is NO
synthetic fallback").

## Two structural notes on the current UI (post-overhaul)

The Overview page was overhauled; this guide documents the dashboards **as they
are now**:

- The Overview headline is the **Decision Brief** (widget `ov-brief`, title
  "Decision Brief") — not an older "Overview · Decision brief" label.
- Several older Overview/Resource widgets were **removed** from the catalog
  (e.g. a Malaria-KPI tile, an Attainment-Summary, an Operational-Quality tile,
  a Units-Received tile). They are not placed on any current page; this guide
  documents only what the catalog actually renders.
- The drug-stock heatmap widget is now titled **"National Stock Distribution"**
  (widget `rm-stock-heatmap`).
- Cards in a section are laid out **equal-height / equal-row**, and trend
  indicators use **muted, executive-suitable colours** (softer green/amber/red;
  red reserved for genuine alerts) — see [general.md](general.md).
