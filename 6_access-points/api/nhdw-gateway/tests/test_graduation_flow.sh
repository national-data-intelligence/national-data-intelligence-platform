#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# Regression test — model-graduation authz + writers (task #18, Part B3).
#
# Guards the SENSITIVE security surface of app/routes/graduation.py:
#   · the direct role gates (_contrib_gate / _review_gate) on every verb,
#     BOTH the allow and the deny path;
#   · the DB writers that were the point of the feature — artifact_review
#     (previously write-orphaned), the tier personal→shared move, the
#     'rejected' status (a 4th state that was never written), and the real
#     sha256 on artifact_version (was a blank string);
#   · the validator gate = schema/deps/resources, with 'smoke' self-skipping
#     under k8s instead of crashing /validate.
#
# Self-contained: builds its own conforming package, drives the LIVE gateway
# through a port-forward (GATEWAY_DEMO_IMPERSONATION channel), asserts the
# resulting DB state via psql, then DELETES its own test artifacts so the
# catalogue is left clean. Exits non-zero on any failed assertion.
#
# Prereqs: a running `nhdw` k3d cluster with the gateway + postgres up, and
# the gateway image built from the current graduation.py. Run from anywhere:
#   bash 6_access-points/api/nhdw-gateway/tests/test_graduation_flow.sh
# ─────────────────────────────────────────────────────────────────────────
set -uo pipefail

NS=nhdw
PGPOD=postgres-vault-0
PGCMD="kubectl -n $NS exec -i $PGPOD -- psql -U vault_admin -d nhdw_ops -tA"
PORT=18091
GW="http://127.0.0.1:${PORT}"

# Real seeded kc_subs (FK ops_identity.user). Keep in sync with the demo seed.
SCI="44444444-aaaa-bbbb-cccc-dddddddddddd"     # contributor  (R-CONS-SCI)
ANA="33333333-aaaa-bbbb-cccc-dddddddddddd"     # contributor  (R-CONS-ANA, NOT a reviewer)
STEW="bbbbbbbb-cccc-dddd-eeee-ffffffffffff"    # reviewer      (R-STEW)

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ✓ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ✗ $1"; }
eq()   { if [ "$1" = "$2" ]; then ok "$3 ($1)"; else bad "$3 — got '$1' expected '$2'"; fi; }

WORK="$(mktemp -d)"
PF_PID=""
cleanup() {
  [ -n "$PF_PID" ] && kill "$PF_PID" 2>/dev/null
  # delete any artifacts this test created (marker tag on the title)
  $PGCMD -c "DELETE FROM ops_artifact.promotion_log WHERE artifact_id IN
             (SELECT id FROM ops_artifact.artifact WHERE title LIKE 'REGTEST-grad-%');
             DELETE FROM ops_artifact.artifact WHERE title LIKE 'REGTEST-grad-%';" >/dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT

# ── build a conforming package (schema/deps/resources all pass) ───────────
cat > "$WORK/driver.py" <<'PY'
class _Meta:
    feature_columns = ["x"]
    name = "regtest_grad_model"
class Model:
    meta = _Meta()
    def fit(self, df):
        self._mean = float(sum(df["x"]) / max(len(df), 1)); return self
    def predict(self, df):
        df = df.copy(); df["yhat"] = self._mean; return df
PY
cat > "$WORK/deployment.yaml" <<'YML'
mode: batch
resource_request:
  cpu: "1"
  memory: "2Gi"
YML
cat > "$WORK/feature_spec.yaml" <<'YML'
input_columns:
  - name: x
    type: float
YML
( cd "$WORK" && tar czf pkg.tar.gz driver.py deployment.yaml feature_spec.yaml )
PKG="$WORK/pkg.tar.gz"

jval() { python3 -c "import sys,json;print(json.load(sys.stdin).get('$1',''))" 2>/dev/null; }
sub()  { curl -s -X POST "$GW/api/graduation/submit" -H "X-Mock-User: $1" -H "X-Mock-Role: $2" \
           -F title="$3" -F kind=model -F file=@"$PKG"; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

# ── port-forward the gateway ──────────────────────────────────────────────
kubectl -n $NS port-forward svc/nhdw-gateway ${PORT}:8000 >/dev/null 2>&1 &
PF_PID=$!
for _ in $(seq 1 30); do curl -sf -o /dev/null "$GW/openapi.json" 2>/dev/null && break; sleep 0.5; done

echo "── contributor gate ──────────────────────────────────────"
c=$(code -X POST "$GW/api/graduation/submit" -H "X-Mock-User: $ANA" -H "X-Mock-Role: R-PUB-ANON" \
      -F title="REGTEST-grad-denied" -F kind=model -F file=@"$PKG")
eq "$c" "403" "submit as R-PUB-ANON is denied"

AID=$(sub "$SCI" "R-CONS-SCI" "REGTEST-grad-approve" | jval artifact_id)
[ -n "$AID" ] && ok "submit as R-CONS-SCI accepted" || bad "submit as R-CONS-SCI"
SHALEN=$($PGCMD -c "SELECT length(sha256) FROM ops_artifact.artifact_version WHERE artifact_id='$AID'")
eq "$SHALEN" "64" "artifact_version.sha256 is a real 64-char digest"

echo "── validate gate (schema/deps/resources; smoke self-skips) ─"
V=$(curl -s -X POST "$GW/api/graduation/$AID/validate" -H "X-Mock-User: $SCI" -H "X-Mock-Role: R-CONS-SCI")
ALLREQ=$(echo "$V" | jval all_required_passed)
eq "$ALLREQ" "True" "all required validators passed → in_review"
echo "$V" | python3 -c "import sys,json;d=json.load(sys.stdin);
sk=[r for r in d['results'] if r['validator']=='smoke']
print('  ✓ smoke self-skipped (non-blocking)' if sk and not sk[0]['passed'] and 'unavailable' in (sk[0]['error_msg'] or '') else '  ✗ smoke did not self-skip cleanly')"

echo "── review gate ───────────────────────────────────────────"
eq "$(code "$GW/api/graduation/queue" -H "X-Mock-User: $ANA" -H "X-Mock-Role: R-CONS-ANA")" "403" "queue denied to non-reviewer"
eq "$(code "$GW/api/graduation/queue" -H "X-Mock-User: $STEW" -H "X-Mock-Role: R-STEW")" "200" "queue allowed to reviewer"
eq "$(code -X POST "$GW/api/graduation/$AID/promote" -H "X-Mock-User: $ANA" -H "X-Mock-Role: R-CONS-ANA" \
       -H 'Content-Type: application/json' -d '{"canonical_name":"regtest_grad_model"}')" "403" "promote denied to non-reviewer"

echo "── approve writers (status + tier + artifact_review) ──────"
curl -s -X POST "$GW/api/graduation/$AID/promote" -H "X-Mock-User: $STEW" -H "X-Mock-Role: R-STEW" \
  -H 'Content-Type: application/json' \
  -d '{"canonical_name":"regtest_grad_model","target_stage":"Staging","tier":"shared","note":"regtest ok"}' >/dev/null
eq "$($PGCMD -c "SELECT peer_review_status FROM ops_artifact.artifact WHERE id='$AID'")" "approved" "status→approved"
eq "$($PGCMD -c "SELECT tier FROM ops_artifact.artifact WHERE id='$AID'")" "shared" "tier personal→shared"
eq "$($PGCMD -c "SELECT verdict FROM ops_artifact.artifact_review WHERE artifact_id='$AID'")" "approved" "artifact_review verdict=approved"

echo "── reject path ───────────────────────────────────────────"
BID=$(sub "$SCI" "R-CONS-SCI" "REGTEST-grad-reject" | jval artifact_id)
curl -s -X POST "$GW/api/graduation/$BID/validate" -H "X-Mock-User: $SCI" -H "X-Mock-Role: R-CONS-SCI" >/dev/null
eq "$(code -X POST "$GW/api/graduation/$BID/reject" -H "X-Mock-User: $SCI" -H "X-Mock-Role: R-CONS-SCI" \
       -H 'Content-Type: application/json' -d '{"note":"x"}')" "403" "reject denied to non-reviewer"
curl -s -X POST "$GW/api/graduation/$BID/reject" -H "X-Mock-User: $STEW" -H "X-Mock-Role: R-STEW" \
  -H 'Content-Type: application/json' -d '{"note":"regtest reject"}' >/dev/null
eq "$($PGCMD -c "SELECT peer_review_status FROM ops_artifact.artifact WHERE id='$BID'")" "rejected" "status→rejected"
eq "$($PGCMD -c "SELECT verdict FROM ops_artifact.artifact_review WHERE artifact_id='$BID'")" "rejected" "artifact_review verdict=rejected"

echo "── input hardening (adversarial-review fixes) ────────────"
# kind outside the CHECK domain → 400 up front (no orphaned MinIO object)
eq "$(code -X POST "$GW/api/graduation/submit" -H "X-Mock-User: $SCI" -H "X-Mock-Role: R-CONS-SCI" \
       -F title="REGTEST-grad-badkind" -F kind=foo -F file=@"$PKG")" "400" "submit with bad kind → 400"

# a fresh UNVALIDATED draft owned by SCI, used for the 409 + detail-authz checks
CID=$(sub "$SCI" "R-CONS-SCI" "REGTEST-grad-draft" | jval artifact_id)
# promote before validate → 409 (required validators absent)
eq "$(code -X POST "$GW/api/graduation/$CID/promote" -H "X-Mock-User: $STEW" -H "X-Mock-Role: R-STEW" \
       -H 'Content-Type: application/json' -d '{"canonical_name":"regtest_grad_model"}')" "409" "promote before validate → 409"

echo "── detail authz gate ─────────────────────────────────────"
# a personal/unreviewed draft is invisible to a non-owner non-reviewer → 404
eq "$(code "$GW/api/graduation/$CID" -H "X-Mock-User: $ANA" -H "X-Mock-Role: R-CONS-ANA")" "404" "draft detail hidden from non-owner (404)"
eq "$(code "$GW/api/graduation/$CID" -H "X-Mock-User: $SCI" -H "X-Mock-Role: R-CONS-SCI")" "200" "draft detail visible to owner (200)"
eq "$(code "$GW/api/graduation/$CID" -H "X-Mock-User: $STEW" -H "X-Mock-Role: R-STEW")" "200" "draft detail visible to reviewer (200)"

echo
echo "══════════════════════════════════════════════════════════"
echo "  PASS=$PASS  FAIL=$FAIL"
echo "══════════════════════════════════════════════════════════"
[ "$FAIL" -eq 0 ]
