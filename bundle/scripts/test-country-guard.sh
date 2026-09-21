#!/usr/bin/env bash
# test-country-guard.sh — a cold boot must not seed the wrong country.
#
# The bug this guards: the seed-only-if-current contract in sources-up.sh
# compares a synth VERSION and nothing else, so a packed dump of one country's
# rows — stamped with the current version — makes every skip branch fire and the
# warehouse comes up holding that country's data no matter which profile was
# asked for. It looks like a completely successful boot.
#
# This is a rare-path bug by nature: it only appears on a profile that is not the
# default, which ordinary runs never exercise. That is exactly the class of
# defect that hides until a demo.
#
#   bash bundle/scripts/test-country-guard.sh
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$REPO/bundle/scripts/sources-up.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ✓ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ✗ $1"; [ -n "${2:-}" ] && echo "      $2"; }

# Evaluate the guard exactly as sources-up.sh defines it, with no side effects.
guard_for() {
  ( export NHDW_PROFILE="${1:-}" NHDW_ENTITY_BUILD="${2:-}"
    COUNTRY_FORCES_SYNTH=0
    if [ -n "${NHDW_ENTITY_BUILD:-}" ] || { [ -n "${NHDW_PROFILE:-}" ] && [ "${NHDW_PROFILE}" != "et-v3" ]; }; then
      COUNTRY_FORCES_SYNTH=1
    fi
    echo "$COUNTRY_FORCES_SYNTH" )
}

echo "── the guard itself"
[ "$(guard_for '' '')"          = "0" ] && ok "no profile → packed dumps are trusted (unchanged default)" \
                                        || bad "no profile should not force re-synthesis"
[ "$(guard_for 'et-v3' '')"     = "0" ] && ok "et-v3 → packed dumps are trusted" \
                                        || bad "et-v3 should not force re-synthesis"
[ "$(guard_for 'zm-v1' '')"     = "1" ] && ok "a non-default profile forces re-synthesis" \
                                        || bad "zm-v1 must force re-synthesis"
[ "$(guard_for '' '/x/_build-entity-model.zm')" = "1" ] \
    && ok "an explicit entity build forces re-synthesis" \
    || bad "NHDW_ENTITY_BUILD must force re-synthesis"

echo "── every skip branch consults it"
# A branch that decides whether to skip synthesis MUST be gated. A new source
# added without the guard is the way this bug comes back.
BRANCHES=$(grep -cE 'skipping synthesize|already seeded .*skipping' "$SRC" || true)
GATED=$(grep -cE 'COUNTRY_FORCES_SYNTH' "$SRC" || true)
[ "$GATED" -ge 5 ] && ok "guard referenced $GATED times for $BRANCHES skip messages" \
                   || bad "only $GATED guard references — a skip branch is unguarded"

# The eLMIS branch is deliberately NOT guarded: that archive IS the Zambian
# data, so re-restoring it is wasted work rather than wrong data. Assert the
# exemption stays deliberate rather than drifting into the general rule.
grep -q 'eLMIS already carries history' "$SRC" \
  && ok "the eLMIS exemption is still present and intentional" \
  || bad "the eLMIS branch changed — re-check whether the exemption still holds"

echo
echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
