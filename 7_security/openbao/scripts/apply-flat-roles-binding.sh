#!/bin/sh
# P5.1.1 — bind OpenBao jwt-keycloak roles against the flattened `roles`
# claim that the moh-staff realm's `nhdw-flat-roles` clientScope now emits.
#
# Before this, F-001 noted that OpenBao bound_claims couldn't descend into
# `realm_access.roles` (nested array). With nhdw-flat-roles attached to
# the internal-bi/jupyterhub/mlflow/submission-portal clients, every JWT
# they issue carries a top-level `roles: ["R-CONS-ANA", ...]` claim that
# bound_claims CAN match.
#
# Idempotent — re-running just re-puts the role definitions.
set -eu
export BAO_ADDR="${BAO_ADDR:-http://127.0.0.1:8200}"
export BAO_TOKEN="${BAO_TOKEN:-$(cat /var/lib/openbao/root-token)}"

# Each NHDW role → which OpenBao PG / KV policy gets attached + the
# allowed Keycloak realm roles. bound_claims accepts a string-array
# match — exactly what `nhdw-flat-roles` produces.

bind_role() {
    role_name=$1
    nhdw_role=$2
    bao_policies=$3
    bao write "auth/jwt-keycloak/role/${role_name}" \
        bound_audiences="moh-staff" \
        bound_claims="{\"roles\":[\"${nhdw_role}\"]}" \
        bound_claims_type=glob \
        user_claim=preferred_username \
        groups_claim=roles \
        role_type=jwt \
        token_policies="${bao_policies}" \
        token_ttl=15m \
        token_max_ttl=60m > /dev/null
    echo "  ↳ jwt-keycloak/role/${role_name} → roles contains [${nhdw_role}], policies=[${bao_policies}]"
}

echo "[apply-flat-roles] re-binding OpenBao JWT roles against flat `roles` claim"
bind_role r-cons-ana    R-CONS-ANA    "role-r-cons-ana-jwt"
bind_role r-stew        R-STEW        "role-r-stew-jwt"
bind_role r-cons-sci    R-CONS-SCI    "role-r-cons-ana-jwt,role-r-jupyterhub-spawn"
bind_role r-cons-res    R-CONS-RES    "role-r-cons-ana-jwt"
bind_role r-prod-submit R-PROD-SUBMIT "role-r-submission-portal"
bind_role r-dec         R-DEC         "role-r-internal-bi"

echo "[apply-flat-roles] done — verify with: bao read auth/jwt-keycloak/role/r-cons-ana"
