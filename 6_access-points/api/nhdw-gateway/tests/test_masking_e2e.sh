#!/usr/bin/env bash
# test_masking_e2e.sh — the masking NEGATIVE PATH against a live deployment.
#
# Unit tests prove the primitives and `opa test` proves the policy; this proves
# the two are actually wired together on the paths that serve real users. It
# reads the live Supply Control Tower feed (bi_supply.mart_ct_nodes carries the
# classified facility GPS) as several identities and asserts what each one gets:
#
#   R-CONS-ANA  (reveal: restricted)   → EXACT coordinates
#   R-SUPER     (reveal: wildcard)     → EXACT coordinates
#   R-CONS-ANA  + LOW TRUST            → GENERALIZED (1 decimal ≈ 11 km)
#   R-CONS-PRT  (no read grant)        → 403 (denied before masking matters)
#   unauthenticated                    → 403
#
# The low-trust case is the one that proves masking TRANSFORMS rather than
# merely logging: same role, same mart, coordinates rounded.
#
# Usage (from the k3s host, or anywhere with cluster + ingress access):
#   NHDW_HOSTBASE=20.84.70.78.nip.io bundle-or-repo/tests/test_masking_e2e.sh
# The impersonation secret is read from the cluster; it never appears in args.
set -uo pipefail
NS="${NS:-nhdw}"
HOSTBASE="${NHDW_HOSTBASE:-127.0.0.1.nip.io}"
GW="https://gateway.${HOSTBASE}"
FAILED=0

pass(){ echo "  ✓ $*"; }
fail(){ echo "  ✗ $*"; FAILED=1; }

SECRET="$(kubectl -n "$NS" get secret nhdw-gateway-secrets \
            -o jsonpath='{.data.IMPERSONATION_SECRET}' 2>/dev/null | base64 -d)"
[ -n "$SECRET" ] || { echo "FATAL: no impersonation secret in $NS/nhdw-gateway-secrets"; exit 2; }

# $1=role  $2=trust(high|low)  → first node's lat, or the HTTP status on failure
ct_lat() {
  local body status
  body="$(curl -sk --max-time 20 -w '\n%{http_code}' \
      -H "X-Mock-User: 00000000-0000-0000-0000-00000000000$3" \
      -H "X-Mock-Role: $1" -H "X-Mock-Trust: $2" -H "X-Mock-Secret: $SECRET" \
      "$GW/api/ct/plan")"
  status="$(printf '%s' "$body" | tail -1)"
  if [ "$status" != "200" ]; then printf 'HTTP-%s' "$status"; return; fi
  printf '%s' "$body" | sed '$d' | python3 -c "
import sys, json
n = (json.load(sys.stdin).get('nodes') or [])
print(n[0]['lat'] if n else 'NO-NODES')"
}

echo "== masking end-to-end (${GW}) =="

ana="$(ct_lat R-CONS-ANA high 1)"
case "$ana" in
  HTTP-*|NO-NODES) fail "analyst could not read the CT feed ($ana)" ;;
  *.*[0-9][0-9][0-9]*) pass "analyst (reveal: restricted) sees EXACT coordinates ($ana)" ;;
  *) fail "analyst coordinates look generalized — reveal grant not applied ($ana)" ;;
esac

sup="$(ct_lat R-SUPER high 2)"
case "$sup" in
  *.*[0-9][0-9][0-9]*) pass "super-user sees EXACT coordinates ($sup)" ;;
  *) fail "super-user coordinates unexpected ($sup)" ;;
esac

low="$(ct_lat R-CONS-ANA low 3)"
case "$low" in
  HTTP-*|NO-NODES) fail "low-trust analyst could not read the CT feed ($low)" ;;
  *.*[0-9][0-9][0-9]*) fail "LOW-TRUST IDENTITY SAW EXACT COORDINATES — masking not applied ($low)" ;;
  *) pass "low-trust analyst sees GENERALIZED coordinates ($low vs $ana)" ;;
esac

prt="$(ct_lat R-CONS-PRT high 4)"
case "$prt" in
  HTTP-403) pass "partner role denied the CT feed outright (403)" ;;
  *) fail "partner role expected 403, got $prt" ;;
esac

anon="$(curl -sk --max-time 20 -o /dev/null -w '%{http_code}' "$GW/api/ct/plan")"
[ "$anon" = "403" ] || [ "$anon" = "401" ] \
  && pass "unauthenticated denied ($anon)" \
  || fail "unauthenticated expected 401/403, got $anon"

echo
[ "$FAILED" = 0 ] && echo "== masking e2e: ALL PASS ==" || echo "== masking e2e: FAILURES above =="
exit $FAILED
