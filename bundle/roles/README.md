# Role definitions — canonical PAP

These YAML files are the **Policy Administration Point** (PAP) for the
NHDW authorization model. They are the single source of truth that drives:

- **Keycloak**: realm roles + client scopes + token claims (one role per
  YAML file, with attributes derived from the YAML)
- **OPA**: Rego policies generated from these YAMLs by
  `7_security/opa/scripts/compile.py`
- **OpenBao**: Vault policies per role at `7_security/openbao/policies/`
- **Warehouse RLS**: ClickHouse + Postgres row-level security expressions
- **CloudBeaver**: per-team connection visibility
- **Custom access points** (Internal BI, Submission, etc.): role-claim →
  UI gating

The schema is documented in `docs/user-roles.md` §2.8 (Permission & Role
schema). Sections §2.1–§2.7 define the vocabulary referenced by each YAML.

## Files

| File | Role ID | Group | Phase |
|---|---|---|---|
| `r-pub-anon.yaml` | R-PUB-ANON | Public/Patient | 1 |
| `r-prod-clin.yaml` | R-PROD-CLIN | Producer | 4 |
| `r-prod-submit.yaml` | R-PROD-SUBMIT | Producer | 1 |
| `r-dec.yaml` | R-DEC | Decision-Maker | 1 |
| `r-cons-ana.yaml` | R-CONS-ANA | Consumer | 2 |
| `r-cons-sci.yaml` | R-CONS-SCI | Consumer | 4 |
| `r-cons-res.yaml` | R-CONS-RES | Consumer | 4 |
| `r-cons-prt.yaml` | R-CONS-PRT | Consumer | 3 |
| `r-stew.yaml` | R-STEW | Steward | 3 |
| `r-ops-eng.yaml` | R-OPS-ENG | Operator | 1 |
| `r-ops-adm.yaml` | R-OPS-ADM | Operator | 1 |
| `r-ops-sec.yaml` | R-OPS-SEC | Operator | 1 |

## Change procedure

Any edit to these YAMLs must:

1. Pass `7_security/opa/scripts/compile.py --check` (syntactic + schema
   validation against `docs/user-roles.md` §2.8).
2. Be reviewed by an R-STEW (governance impact) AND an R-OPS-SEC (security
   impact) — separation of duties is required for changes that touch PHI
   permissions.
3. Be tested against `7_security/opa/tests/` fixtures.
4. CI applies changes downstream (Keycloak realm import, OPA bundle
   rebuild, OpenBao policy upload) only after the above pass.
