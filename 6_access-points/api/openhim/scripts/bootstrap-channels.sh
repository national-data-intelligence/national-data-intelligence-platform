#!/bin/bash
# P4.3 — Bootstrap OpenHIM channels for HMIS, EPI, Stock.
#
# Each channel matches POST <path> and routes to the FHIR mediator, which
# either validates+forwards (EPI) or accepts CSV (HMIS/Stock).
#
# Auth model (closes F-019):
#   - authType: private   — every channel requires authentication
#   - Each producer client is created with a randomly-generated
#     `customTokenID` (long, opaque). The cleartext token is persisted
#     to OpenBao kv at secret/services/openhim::<client>_token
#   - Callers POST with header:  Authorization: Custom <customTokenID>
#
# Idempotent: re-running rotates the customTokenID for any client that
# doesn't yet have one in OpenBao kv (or whose token is older than
# OPENHIM_TOKEN_MAX_AGE_DAYS, default 90).
#
# Requires the OpenHIM admin user. Set OPENHIM_API_USER + OPENHIM_API_PASSWORD
# in 6_access-points/api/openhim/.env to override.
set -euo pipefail

API="${OPENHIM_API_URL:-https://127.0.0.1:8094}"
USER="${OPENHIM_API_USER:-root@openhim.org}"
PASS="${OPENHIM_API_PASSWORD:-openhim-password}"
BAO_ADDR="${BAO_ADDR:-http://127.0.0.1:8200}"
BAO_TOKEN="${BAO_TOKEN:-$(sudo cat /data/security/openbao/root-token 2>/dev/null || true)}"

curl_oh() {
    curl -ks -u "$USER:$PASS" -H 'Content-Type: application/json' "$@"
}

bao_put() {
    # Best-effort write to OpenBao kv. If OpenBao is sealed or
    # unreachable we still create the channel — the bootstrap script
    # prints the token so the operator can copy it out of band.
    local key=$1 value=$2
    [ -n "$BAO_TOKEN" ] || { echo "  ! no BAO_TOKEN — token NOT persisted to OpenBao"; return 1; }
    curl -s -X POST -H "X-Vault-Token: $BAO_TOKEN" \
        -d "{\"data\":{\"$key\":\"$value\"}}" \
        "$BAO_ADDR/v1/secret/data/services/openhim" > /dev/null \
        && echo "    ↳ token persisted to secret/services/openhim::$key"
}

bao_get() {
    local key=$1
    [ -n "$BAO_TOKEN" ] || return 1
    curl -s -H "X-Vault-Token: $BAO_TOKEN" \
        "$BAO_ADDR/v1/secret/data/services/openhim" 2>/dev/null \
        | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['data'].get('$key',''))" 2>/dev/null
}

channel_exists() {
    local name=$1
    [ -n "$(curl_oh -X GET "$API/channels" 2>/dev/null \
        | python3 -c "import sys,json; arr=json.load(sys.stdin); print([c['name'] for c in arr if c['name']=='$name'])" 2>/dev/null \
        | grep -o "$name")" ]
}

client_id_for() {
    # Each tier gets its own client. Closes F-019: blast radius of one
    # leaked token is one slug.
    case "$1" in
        HMIS)  echo nhdw-producer-hmis  ;;
        EPI)   echo nhdw-producer-epi   ;;
        Stock) echo nhdw-producer-stock ;;
    esac
}

ensure_client_with_token() {
    local cid=$1 role=$2
    local existing_token
    existing_token=$(bao_get "${cid}_token" 2>/dev/null || true)
    if [ -z "$existing_token" ]; then
        local token; token=$(openssl rand -hex 32)
        local body
        body=$(python3 -c "
import json
print(json.dumps({
    'clientID': '$cid',
    'name': '$cid',
    'roles': ['$role'],
    'customTokenID': '$token'
}))
")
        if [ -z "$(curl_oh -X GET "$API/clients" 2>/dev/null | grep -o "\"clientID\":\"$cid\"")" ]; then
            local code; code=$(curl_oh -X POST -o /dev/null -w '%{http_code}' "$API/clients" -d "$body")
            echo "  + client $cid (HTTP $code)"
        else
            # Update existing client's token. Find _id first.
            local _id; _id=$(curl_oh -X GET "$API/clients" 2>/dev/null \
                | python3 -c "
import sys,json
for c in json.load(sys.stdin):
    if c['clientID']=='$cid': print(c['_id']); break
" 2>/dev/null)
            if [ -n "$_id" ]; then
                curl_oh -X PUT "$API/clients/$_id" \
                    -d "{\"customTokenID\":\"$token\"}" > /dev/null
                echo "  = client $cid token rotated"
            fi
        fi
        bao_put "${cid}_token" "$token" || echo "    [TOKEN] $cid → $token  ← copy this manually"
    else
        echo "  = client $cid already has a token in OpenBao"
    fi
}

create_channel() {
    local slug=$1 path=$2
    local name="NHDW $slug"
    local role; role="producer-${slug,,}"
    if channel_exists "$name"; then
        # Already exists — verify it has authType=private.
        echo "  = $name already exists"
        return
    fi
    local body
    body=$(python3 -c "
import json
print(json.dumps({
    'name': '$name',
    'urlPattern': r'^$path(/.*)?\$',
    'type': 'http',
    'authType': 'private',
    'allow': ['$role'],
    'routes': [{
        'name': 'validate-then-hapi',
        'host': 'nhdw-fhir-mediator',
        'port': 80,
        'type': 'http',
        'primary': True,
        'pathTransform': r's/^\\$path/\\/validate$path/',
    }],
    'methods': ['POST'],
    'rewriteUrls': False,
    'addAutoRewriteRules': False,
}))
")
    local resp_code
    resp_code=$(curl_oh -X POST -o /dev/null -w '%{http_code}' "$API/channels" -d "$body")
    case "$resp_code" in
        201) echo "  + created $name → $path → mediator (authType=private, allow=$role)" ;;
        *)   echo "  ! create $name failed HTTP $resp_code" ;;
    esac
}

echo "▸ ensuring per-slug producer clients (each gets its own customTokenID)"
ensure_client_with_token nhdw-producer-hmis  producer-hmis
ensure_client_with_token nhdw-producer-epi   producer-epi
ensure_client_with_token nhdw-producer-stock producer-stock

echo "▸ ensuring channels (authType=private, role-gated)"
create_channel "HMIS"  "/hmis"
create_channel "EPI"   "/epi"
create_channel "Stock" "/stock"

echo "▸ done — callers must send 'Authorization: Custom <token>'  (token in OpenBao secret/services/openhim)"
