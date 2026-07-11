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

## Tool access

Analyst and operator tools — dbt docs, Airflow, Superset, MLflow, Jupyter, the
MinIO console, Prometheus, the Kubernetes console — are all reached from the
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
