# Release readiness: assessment pack (2026-10-21)

An evidence-based assessment of what works, what is incomplete and what could mislead a reviewer or customer. It
covers three stages: customer demonstration, controlled pilot and supported production.

It assessed `develop` 92ede8e and the live single-node cluster (`nhdw` namespace) on 2026-10-20/21. It **supersedes**
`docs/production-readiness-assessment.md` (14 July 2026) as the current verdict.

## Verdict in brief

| Stage | Ready? | Effort to reach it |
|---|---|---|
| Customer demonstration | **No** | WP-0 to WP-3: about 1.5–2 weeks with two engineers |
| Controlled pilot | **No** | About 5–7 weeks after the demo gate, if pilot data and the legal memo arrive in time |
| Supported production | **No** | Months, depending on decisions D6 and D7 |

## Documents

| # | Document | What it answers |
|---|---|---|
| A | [Readiness assessment](01-readiness-assessment.md) | Verdicts, blockers, what works, verification coverage, decisions, claims vs capability |
| B | [System and product coverage map](02-coverage-map.md) | As-built architecture, component inventory, pipelines, dashboard and metric matrix, route/link matrix, workflows, accessibility |
| C | [Findings register](03-findings-register.md) | 71 findings with stable IDs, severity, blocking stage, evidence, cause, resolution, effort, acceptance criteria |
| D | [Execution plan](04-execution-plan.md) | Bounded work packages WP-0 to WP-11, critical path, decisions, deferrals |
| E | [Demo and operational handover](05-demo-and-operations-handover.md) | Demo script, preflight, personas, expected values, limitations, reset/recovery, troubleshooting, runbook gaps |
| F | [Standards and acceptance criteria](06-standards-and-acceptance-criteria.md) | Cited sources (OWASP ASVS 5.0, WCAG 2.2, Kubernetes, SLSA, SSDF, DORA, SRE, DAMA, dbt, NIST 800-34, CISA 3-2-1, SDC, data-protection law to confirm) and the demo/pilot/production criteria |

## How to use this pack

- **Engineers** start at the [execution plan](04-execution-plan.md). Each work package lists the findings it closes,
  and each finding states what "done" means and how to verify it.
- **Presenters** use the [handover](05-demo-and-operations-handover.md). The preflight must pass before any demo on the
  live host.
- **Decision-makers** read [assessment §6](01-readiness-assessment.md#6-decisions-needed).

## Keeping it current

- Close a finding by linking the PR and its acceptance evidence in the register entry. Never delete an entry.
- Add new findings in the right class, using the next free ID.
- Re-run the preflight and the coverage counts at each release gate.
- Record each gate decision with its date at the end of this file.

## Gate log

| Date | Gate | Decision | By |
|---|---|---|---|
| 2026-10-21 | Baseline assessment | Not ready at any stage | — |
