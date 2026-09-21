# Admin console — live browser regressions

Playwright walkthroughs against a RUNNING deployment (they assert what a real
operator sees, which no unit test can). Each drives a real Keycloak login and
fails on any page error.

| Test | Covers |
|---|---|
| `test_steward_console.mjs` | R-STEW (`steward.ops`): the nav is NARROWED to its grants (a steward must not see operator pages it has no widget for — that husk class regressed once), the MDM queue with its entity toggle and accurate decision-timing copy, the master-detail panel ("who is this?": members, golden attributes, identifiers), and Column Governance with both tabs |
| `test_dq_incidents.mjs` | R-SUPER (`root`): the DQ page's incident section renders REAL detector findings — the stale-ingest flags and the MDM backlog flag (the cross-track signal: the quality plane reading the MDM queue) |

Run against the shared deployment:

```bash
docker run --rm --network host -v "$PWD/6_access-points/dashboards/admin/tests:/t" \
  mcr.microsoft.com/playwright:v1.49.0-jammy bash -c \
  'cd /tmp && npm init -y >/dev/null && npm i --silent playwright@1.49.0 >/dev/null \
   && cp /t/test_steward_console.mjs . && node test_steward_console.mjs'
```

Point them at another host by editing `BASE`; the demo password comes from
`SEED_PASSWORD` (default is the seeded demo value).
