#!/usr/bin/env bash
# seed-resource-requests.sh — boot step 7.57: leave the compute resource-request
# review queue with REAL, back-traced demo content by driving the REAL gateway
# API (POST /api/workspace/resource-request → the workshop "request a bigger
# profile" form; POST /api/workspace/resource-requests/{id}/decide → the admin
# approve action). NEVER by INSERTing ops_governance.resource_request rows: an
# INSERTed row would fabricate the requester/reviewer forensic trail (requested_
# at, reviewer, decision_at) those columns exist to record.
#
# Owner rule (2026-07-06): every seeded row at a LATER stage of a flow must have a
# back-trace a real flow would take to reach it, and its fields must MATCH what the
# real form produces. So a "pending compute request" here is submitted by a real
# workshop user whose role genuinely CANNOT self-serve that profile, and the
# "approved" one is decided by a real System-Admin principal — exactly the two
# states the admin review queue renders.
#
# Leaves two requests spanning both review states:
#   1) sci.demo  → Large   → PENDING   (R-CONS-SCI self-serves only Small/Medium →
#                                        Large legitimately needs review) → the
#                                        "unapproved request" in the admin queue.
#   2) ana.demo  → XLarge  → APPROVED  (submitted, then granted by solomon.m) →
#                                        the granted state (unlocks XLarge spawn).
#
# CONVERGENT (cf. seed-projects/seed-graduation): a request by the same
# (requester, requested_profile) is skipped/resumed, so re-running every boot
# creates no duplicates. Reaches the gateway EXACTLY like seed-projects.sh: a
# host-side `kubectl port-forward svc/nhdw-gateway`, waited on by polling /health,
# authed via the demo impersonation channel (X-Mock-User/Role/Secret) with REAL
# seeded ops_identity.user subs. Fails LOUDLY — accumulates failures and exits
# non-zero so bootstrap gates on it.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NS=nhdw
GW_LOCAL_PORT="${RESOURCE_REQ_GW_PORT:-18081}"
export PATH="$HOME/.local/bin:$PATH"

# Real seeded principals (ops_identity.user.kc_sub — FK'd by requester/reviewer).
SCI_SUB=44444444-aaaa-bbbb-cccc-dddddddddddd;  SCI_ROLE=R-CONS-SCI   # requester (Large)
ANA_SUB=33333333-aaaa-bbbb-cccc-dddddddddddd;  ANA_ROLE=R-CONS-ANA   # requester (XLarge)
ADM_SUB=a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11;  ADM_ROLE=R-OPS-ADM     # approver (solomon.m; has approve_access_request)

FAILED=0
step() { echo; echo "▸ $*"; }
ok()   { echo "  ✓ $*"; }
warn() { echo "  ! $*" >&2; }

echo "== resource-request seed (real /api/workspace/resource-request + decide APIs) =="

kubectl -n "$NS" port-forward svc/nhdw-gateway "${GW_LOCAL_PORT}:8000" >/dev/null 2>&1 &
PF=$!
trap 'kill $PF 2>/dev/null' EXIT
GW="http://127.0.0.1:${GW_LOCAL_PORT}"
up=0
for _ in $(seq 1 24); do
  if curl -s -o /dev/null --max-time 2 "$GW/health"; then up=1; break; fi
  sleep 2
done
[ "$up" = 1 ] || { warn "gateway not reachable on $GW/health after ~48s"; exit 1; }
ok "gateway reachable ($GW)"

PGPW=$(kubectl -n "$NS" get secret postgres-vault-secrets -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d)
IMP_SECRET=$(kubectl -n "$NS" get secret nhdw-gateway-secrets -o jsonpath='{.data.IMPERSONATION_SECRET}' | base64 -d 2>/dev/null)

json_get() { # <key> ; reads a JSON object on stdin, prints obj[key] ('' if absent)
  python3 -c "import sys,json
key=sys.argv[1]
try:
    d=json.load(sys.stdin)
except Exception:
    d={}
print(d.get(key,'') if isinstance(d,dict) else '')" "$1" 2>/dev/null
}

psql_one() { # <sql> → first column of the first row ('' if none)
  kubectl -n "$NS" exec postgres-vault-0 -- env PGPASSWORD="$PGPW" \
    psql -U vault_admin -d nhdw_ops -At -c "$1" 2>/dev/null | head -1
}

REQ_ID=""   # ensure_request's out-param (logs go to fd1, so no $() capture)
ensure_request() { # <sub> <role> <profile> <justification>
  local sub="$1" role="$2" profile="$3" just="$4" resp
  REQ_ID=$(psql_one "SELECT id FROM ops_governance.resource_request WHERE requester = '$sub'::uuid AND requested_profile = \$\$$profile\$\$ ORDER BY requested_at DESC LIMIT 1")
  if [ -n "$REQ_ID" ]; then ok "request ($profile by $sub) already present (convergent)"; return 0; fi
  resp=$(curl -s --max-time 30 -X POST "$GW/api/workspace/resource-request" \
    -H "X-Mock-User: $sub" -H "X-Mock-Role: $role" -H "X-Mock-Secret: $IMP_SECRET" \
    -H "Content-Type: application/json" \
    -d "{\"requested_profile\":\"$profile\",\"justification\":\"$just\"}")
  REQ_ID=$(echo "$resp" | json_get id)
  if [ -n "$REQ_ID" ]; then ok "submitted request '$profile' ($REQ_ID)"
  else warn "resource-request submit FAILED ($profile): $resp"; FAILED=1; return 1; fi
}

approve_request() { # <req_id> <granted_profile> <note>
  local rid="$1" granted="$2" note="$3" status resp
  [ -n "$rid" ] || { FAILED=1; return 1; }
  status=$(psql_one "SELECT status FROM ops_governance.resource_request WHERE id = '$rid'::uuid")
  [ "$status" = "approved" ] && { ok "request $rid already approved (convergent)"; return 0; }
  resp=$(curl -s --max-time 30 -X POST "$GW/api/workspace/resource-requests/$rid/decide" \
    -H "X-Mock-User: $ADM_SUB" -H "X-Mock-Role: $ADM_ROLE" -H "X-Mock-Secret: $IMP_SECRET" \
    -H "Content-Type: application/json" \
    -d "{\"decision\":\"approved\",\"granted_profile\":\"$granted\",\"note\":\"$note\"}")
  if [ "$(echo "$resp" | json_get status)" = "approved" ]; then ok "approved → granted $granted"
  else warn "decide FAILED for $rid: $resp"; FAILED=1; return 1; fi
}

step "request 1/2 — sci.demo → Large (stays PENDING for the admin queue)"
ensure_request "$SCI_SUB" "$SCI_ROLE" "Large" \
  "Whole-region EWARS retraining (all zones, 5y history) needs 4 CPU / 8 GiB — exceeds the Medium self-serve ceiling."

step "request 2/2 — ana.demo → XLarge (submitted, then APPROVED by solomon.m)"
ensure_request "$ANA_SUB" "$ANA_ROLE" "XLarge" \
  "National stock-availability feature build over the full commodity catalogue — 8 CPU / 16 GiB for the join." \
  && approve_request "$REQ_ID" "XLarge" "Approved for the Q3 supply-chain analysis window; please release the pod when the build completes."

echo
if [ "$FAILED" = 0 ]; then
  echo "== resource-request seed OK (1 pending + 1 approved, all via the real API) =="
else
  echo "== resource-request seed had FAILURES ==" >&2; exit 1
fi
