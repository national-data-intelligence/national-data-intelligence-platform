#!/usr/bin/env bash
# resolve-users-seed.sh — WHICH CAST does the active country use?
#
# Prints the basename of the users seed file (e.g. `users.yaml`,
# `users.zm.yaml`). ONE resolver, because this answer is needed in three
# places — the security-seed Job env, the keycloak-users-seed configmap, and
# the profile-swap worker — and the first implementation was already being
# copy-pasted by the second caller when this file replaced it.
#
# Order (mirrors load_security_seed.py's own resolution):
#   $NHDW_USERS_SEED           explicit override
#   $NHDW_PROFILE              the named profile's layers.appsec.users
#   ACTIVE pointer files       state dir first, then the profile dir
#   users.yaml                 the default that shipped before profiles
set -uo pipefail
PDIR="${NHDW_PROFILE_DIR:-/opt/nhdw-profiles}"
SDIR="${NHDW_PROFILE_STATE_DIR:-/opt/nhdw-state}"

if [ -n "${NHDW_USERS_SEED:-}" ]; then basename "$NHDW_USERS_SEED"; exit 0; fi

KEY="${NHDW_PROFILE:-}"
if [ -z "$KEY" ]; then
  for ptr in "$SDIR/ACTIVE" "$PDIR/ACTIVE"; do
    [ -f "$ptr" ] && KEY=$(tr -d '[:space:]' < "$ptr") && [ -n "$KEY" ] && break
  done
fi
if [ -n "$KEY" ] && [ -f "$PDIR/$KEY/profile.yaml" ]; then
  DECL=$(sed -n 's|^ *users: *||p' "$PDIR/$KEY/profile.yaml" | head -1)
  [ -n "$DECL" ] && { basename "$DECL"; exit 0; }
fi
echo "users.yaml"
