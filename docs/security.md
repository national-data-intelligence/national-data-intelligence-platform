# Security and identity

Authentication and authorization are separate concerns handled by separate
systems. Keycloak proves who you are; OPA decides what you may read.

## Identity

Keycloak runs two staff-facing realms — one for Ministry staff and analysts, one
for privileged operators — plus a mock Fayda identity provider that stands in for
the national citizen ID used on the public portal. Staff sign in with passwords
(and, for sensitive roles, a second factor); the public portal offers the Fayda
citizen flow. Every dashboard and every analyst tool authenticates against the
same Keycloak, so a session opened in one place is honoured across the others.

The hostnames matter here: the token issuer, each dashboard's redirect URIs, the
gateway's accepted issuers and the seeded Keycloak clients all have to agree on
one base host. That single contract is what makes single sign-on work, and it is
the one thing to change when moving the system to a different domain.

## Authorization

Roles are the unit of access. A role carries a geography scope (national, or a
specific region) and a programme scope (all, or a named programme such as HIV or
malaria), and those scopes flow through to the data.

When a dashboard asks the gateway for a mart, the gateway builds a request from
the caller's role — subject, data class, granularity, verb — and hands it to OPA.
OPA answers allow or deny and, on allow, returns a row filter that the gateway
applies before it runs the query. So a regional officer sees only their region, a
programme decision-maker sees only their programme, and neither can widen that by
changing the UI: the filter lives at the gateway, not the browser.

A second layer decides what each role can even see. The dashboards are built from
a widget catalogue, and a role is granted a set of widgets and pages; a role never
renders a panel it has no data for. The grants and the OPA policies are kept in
step, so there are no empty shells where a widget is shown but every read behind
it is refused.

## Column masking

Below the row filter sits a column-level layer. Sensitive columns are classified
in `ops_perm.column_classification` (a denylist — a column with no row is simply
visible), each with a sensitivity tier and a masking treatment: drop the column,
hash it, reveal only the tail (phone numbers), reduce its precision (GPS
coordinates round to about 11 km, dates truncate to the month), or replace it
with a stable pseudonym so joins still work but the raw value never leaves.

Which caller sees a classified column clear is the policy's call, not the
gateway's: each role carries a reveal set (`column_access.reveal` in
`bundle/roles/*.yaml`, compiled into the OPA policy), the gateway sends the
queried relation's classified columns with every decision request, and OPA
returns the subset the caller may not see. Analysts and decision-makers reveal
`restricted` (their maps plot exact facility GPS); the security officer also
reveals `privileged`; a low-trust federated login reveals nothing regardless of
role. The transformation is applied on every read path — direct mart reads,
widgets, the Supply Control Tower feed, exports, reports, and ad-hoc SQL, where
an explicit reference to a masked column is refused outright (aliasing would
defeat name-based masking) while `SELECT *` comes back masked.

Every edge fails closed: an unknown masking class drops the column, a missing
HMAC key drops rather than reveals, and the gateway refuses to start if the live
policy's reveal behavior drifts from the expected matrix. Three parties write the
classification store — the committed seed, stewards, and the OpenMetadata sync —
each owning only its own rows (`managed_by`), so no writer can undo another's.

## Tool access

Analyst and operator tools — dbt docs, Airflow, Superset, MLflow, Jupyter, the
Prometheus, the Kubernetes console — are all reached from the
dashboards over the shared Keycloak session, and each is restricted to the roles
that should use it. Tools that speak OIDC enforce the role themselves; the rest
sit behind a small role-aware reverse proxy that checks the role before proxying,
and hides its launch button from anyone not permitted. Arriving from a
logged-in dashboard signs the user in silently; a direct visit shows the same
Keycloak login and still enforces the role.

## Secrets

Real secret material never lives in the repository. Templates carry placeholder
tokens, and a generator fills them with fresh values per deployment into a
gitignored secrets file. The API token used for this handoff, and any other
credentials, stay out of version control.
