#!/usr/bin/env bash
# test-coldboot-initdb.sh — does the database actually initialise from zero?
#
# WHY THIS EXISTS. `3_storage/postgres/init/*` runs on a FRESH volume only.
# Re-provisioning an existing host keeps its PVC, so these files never execute,
# and nothing else reads them either — a broken one can sit in the tree for
# weeks while every deploy and every provision reports green. Three did:
#
#   · 07_marts_schemas_extras.sql ended mid-statement (no GRANT clause), so the
#     file was unexecutable from the day bi_mdm was added;
#   · 23_perm_admin_grants.sql and 32_permission_store.sql write ops_perm, which
#     lives in nhdw_ops, but carried no `\connect` — each init file starts a
#     fresh psql session against POSTGRES_DB, so an earlier file's `\connect`
#     does not carry over.
#
# postgres:16-alpine runs these with ON_ERROR_STOP=1 and ABORTS initialisation
# on any error, so each of those would have killed a cold boot outright.
#
# This runs the real init directory through a throwaway postgres container with
# the same env the StatefulSet supplies, then asserts the databases and the
# schemas that matter actually exist. It needs Docker and nothing else — no
# cluster, no secrets — so it belongs in the hosted CI test job.
#
# Usage:  bundle/scripts/test-coldboot-initdb.sh
# Env:    PG_IMAGE (default postgres:16-alpine — keep it matching the manifest)
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INIT="$REPO/3_storage/postgres/init"
PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"
NAME="nhdw-coldinit-$$"
FAIL=0

pass() { echo "  ✓ $*"; }
fail() { echo "  ✗ $*"; FAIL=1; }

command -v docker >/dev/null || { echo "docker not found — cannot run"; exit 2; }
[ -d "$INIT" ] || { echo "init dir missing: $INIT"; exit 2; }

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# The env names are exactly those in 1_infrastructure/k8s/base/postgres-vault.yaml.
# Values are irrelevant here — this tests the SQL, not the credentials.
ENVS=(-e POSTGRES_DB=nhdw_vault -e POSTGRES_USER=vault_admin)
for v in POSTGRES_PASSWORD LANDING_WRITER_PASSWORD VAULT_WRITER_PASSWORD BI_READER_PASSWORD \
         OPS_GATEWAY_PASSWORD OPS_WRITER_PASSWORD OPS_READER_PASSWORD GRAFANA_DB_PASSWORD \
         MLFLOW_DB_PASSWORD SEAWEEDFS_FILER_DB_PASSWORD KEYCLOAK_DB_PASSWORD \
         AIRFLOW_DB_PASSWORD SUPERSET_DB_PASSWORD OPENMETADATA_DB_PASSWORD; do
  ENVS+=(-e "$v=coldboottest")
done

echo "== cold-boot initdb ($PG_IMAGE) =="
docker rm -f "$NAME" >/dev/null 2>&1
if ! docker run -d --name "$NAME" "${ENVS[@]}" \
      -v "$INIT":/docker-entrypoint-initdb.d:ro "$PG_IMAGE" >/dev/null; then
  echo "  ✗ could not start the container"; exit 1
fi

# The entrypoint reports "PostgreSQL init process complete" only after EVERY
# file succeeded; on an error it aborts and the container exits.
ready=0
for _ in $(seq 1 120); do
  logs="$(docker logs "$NAME" 2>&1)"
  if grep -q "PostgreSQL init process complete" <<<"$logs" \
     && grep -q "database system is ready to accept connections" <<<"$logs"; then
    ready=1; break
  fi
  docker ps --format '{{.Names}}' | grep -qx "$NAME" || break   # exited = failed
  sleep 2
done

if [ "$ready" = 1 ]; then
  pass "every init file applied — initialisation completed"
else
  fail "initialisation did NOT complete (a cold boot would fail here)"
  echo "  ── errors ──"
  docker logs "$NAME" 2>&1 | grep -E "^psql:.*(ERROR|FATAL)|^[0-9-]+ .*(ERROR|FATAL)" \
    | grep -v NOTICE | head -15 | sed 's/^/    /'
  exit 1
fi

# "It started" is not "it built the right thing" — assert the surfaces other
# tiers depend on. A file that silently lands its objects in the wrong database
# still lets the container come up.
q() { docker exec "$NAME" psql -U vault_admin -d "$1" -At -c "$2" 2>/dev/null; }

dbs="$(q postgres "SELECT string_agg(datname, ' ' ORDER BY datname) FROM pg_database WHERE NOT datistemplate")"
for db in nhdw_vault nhdw_ops nhdw_airflow nhdw_mlflow nhdw_grafana nhdw_openmetadata; do
  grep -qw "$db" <<<"$dbs" && pass "database $db created" || fail "database $db MISSING (got: $dbs)"
done

# ops_perm in nhdw_ops is the one the missing \connect got wrong — it is the
# store OPA and the masking layer read, so a misplaced copy is a silent
# authz failure rather than a loud one.
for s in ops_perm ops_governance ops_identity ops_workspace; do
  [ "$(q nhdw_ops "SELECT count(*) FROM information_schema.schemata WHERE schema_name='$s'")" = "1" ] \
    && pass "nhdw_ops.$s present" || fail "nhdw_ops.$s MISSING"
done

# the tables 23/32 create, in the database they must live in
for t in ops_perm.permission ops_perm.role_permission ops_perm.column_classification; do
  [ "$(q nhdw_ops "SELECT to_regclass('$t') IS NOT NULL")" = "t" ] \
    && pass "$t exists in nhdw_ops" || fail "$t MISSING from nhdw_ops"
done

# bi_mdm default privileges — the grant the truncated statement never made
[ "$(q nhdw_vault "SELECT count(*) FROM pg_default_acl a JOIN pg_namespace n ON n.oid=a.defaclnamespace WHERE n.nspname='bi_mdm'")" -ge 1 ] \
  && pass "bi_mdm default privileges granted" || fail "bi_mdm has NO default privileges (07 truncated again?)"

echo
[ "$FAIL" = 0 ] && echo "== cold-boot initdb: ALL GREEN ==" || echo "== cold-boot initdb: FAILURES above =="
exit "$FAIL"
