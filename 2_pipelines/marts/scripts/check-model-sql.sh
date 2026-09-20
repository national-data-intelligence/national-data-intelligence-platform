#!/usr/bin/env bash
# check-model-sql.sh — EXPLAIN mart models against the LIVE warehouse,
# read-only, BEFORE the dbt job spends 40 minutes discovering the same thing.
#
# Why this exists: dbt builds its manifest without ever asking Postgres whether
# the SQL is legal, so a semantic error only surfaces mid-build. That cost a
# full deploy once — a dim table joined with ON ahead of a chain of
# `USING (facility_id)` joins gave those clauses two candidate columns on their
# left side ("common column name appears more than once in left table"). One
# EXPLAIN would have caught it in under a second.
#
# EXPLAIN plans the statement without executing it. Only plain SELECT/WITH
# models whose dbt refs are all `source()` can be rendered here; models using
# ref()/macros need dbt itself and are skipped loudly.
#
# Usage:
#   2_pipelines/marts/scripts/check-model-sql.sh                 # every model
#   2_pipelines/marts/scripts/check-model-sql.sh path/to/x.sql   # just these
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
NS="${NS:-nhdw}"
FAILED=0

render() {   # $1 = model file → stdout: EXPLAIN-able SQL (exit 9 = skip)
  python3 - "$1" <<'PY'
import re, sys
src = open(sys.argv[1]).read()
starts = [p for p in (src.find('WITH '), src.find('SELECT ')) if p >= 0]
if not starts:
    sys.exit(9)
body = src[min(starts):]
body = re.sub(r"\{\{\s*source\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)\s*\}\}",
              lambda m: f"{m.group(1)}.{m.group(2)}", body)
if '{{' in body:
    sys.exit(9)
print('EXPLAIN\n' + body + ';')
PY
}

models=( "$@" )
if [ ${#models[@]} -eq 0 ]; then
  mapfile -t models < <(find "$REPO/2_pipelines/marts/models" -name '*.sql' | sort)
fi

for m in "${models[@]}"; do
  if ! sql="$(render "$m")"; then
    echo "  ~ skip $(basename "$m") (ref()/macros — needs dbt)"
    continue
  fi
  if printf '%s' "$sql" | kubectl -n "$NS" exec -i postgres-vault-0 -- \
       psql -U vault_admin -d nhdw_vault -tA -v ON_ERROR_STOP=1 \
       >/dev/null 2>/tmp/check-model-sql.err; then
    echo "  ✓ $(basename "$m")"
  else
    echo "  ✗ $(basename "$m"): $(grep -m1 ERROR /tmp/check-model-sql.err)"
    FAILED=1
  fi
done

echo
[ "$FAILED" = 0 ] && echo "== mart SQL: all planned ==" || echo "== mart SQL: FAILURES above =="
exit $FAILED
