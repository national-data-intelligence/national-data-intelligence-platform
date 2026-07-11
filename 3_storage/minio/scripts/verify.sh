#!/usr/bin/env bash
# verify.sh — sanity-check that the data lake is up and provisioned.
#
# Run from the data-lake folder:
#   bash scripts/verify.sh
#
# Exit codes:
#   0   all checks pass
#   1   at least one check failed (details on stderr)

set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/.."

if [ ! -f .env ]; then
  echo "ERROR: .env not found in $(pwd). Copy .env.example -> .env first." >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a; . ./.env; set +a

fail=0
pass() { printf "  \033[32mPASS\033[0m  %s\n" "$1"; }
warn() { printf "  \033[33mWARN\033[0m  %s\n" "$1"; }
fail() { printf "  \033[31mFAIL\033[0m  %s\n" "$1"; fail=1; }

echo "→ MinIO server liveness"
if curl -fsS -o /dev/null http://127.0.0.1:9100/minio/health/live; then
  pass "http://127.0.0.1:9100 responds"
else
  fail "http://127.0.0.1:9100 not responding (is minio up?)"
  exit 1
fi

echo "→ Buckets exist"
ALIAS_NAME="nhdw-verify-$$"
trap 'docker exec minio-datalake mc alias remove "$ALIAS_NAME" >/dev/null 2>&1 || true' EXIT

docker exec minio-datalake mc alias set "$ALIAS_NAME" http://localhost:9000 \
  "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null

for b in nhdw-raw nhdw-processed nhdw-archive; do
  if docker exec minio-datalake mc ls "$ALIAS_NAME/$b" >/dev/null 2>&1; then
    pass "$b exists"
  else
    fail "$b missing — run: docker compose up minio-init"
  fi
done

echo "→ Versioning"
for b in nhdw-raw nhdw-archive; do
  v=$(docker exec minio-datalake mc version info "$ALIAS_NAME/$b" 2>/dev/null | tr -d '\r')
  if echo "$v" | grep -qi enabled; then
    pass "$b versioning enabled"
  else
    warn "$b versioning not enabled: $v"
  fi
done

echo "→ Service accounts"
# `mc admin user list` rows look like: "enabled    nhdw_ingestor    nhdw-ingestor-policy"
USERS=$(docker exec minio-datalake mc admin user list "$ALIAS_NAME" 2>/dev/null | awk '{print $2}')
for u in "$INGESTOR_ACCESS_KEY" "$TRANSFORMER_ACCESS_KEY" "$ARCHIVER_ACCESS_KEY" "$READER_ACCESS_KEY"; do
  if echo "$USERS" | grep -qx "$u"; then
    pass "user $u exists"
  else
    fail "user $u missing — run: docker compose up minio-init"
  fi
done

echo "→ Ingestor can write to nhdw-raw (functional check)"
WRITE_ALIAS="nhdw-ingestor-verify-$$"
trap 'docker exec minio-datalake mc alias remove "$ALIAS_NAME" >/dev/null 2>&1 || true; docker exec minio-datalake mc alias remove "$WRITE_ALIAS" >/dev/null 2>&1 || true' EXIT

docker exec minio-datalake mc alias set "$WRITE_ALIAS" http://localhost:9000 \
  "$INGESTOR_ACCESS_KEY" "$INGESTOR_SECRET_KEY" >/dev/null

PROBE="/tmp/nhdw-probe-$$.txt"
docker exec minio-datalake sh -c "echo 'probe' > $PROBE && mc cp --quiet $PROBE $WRITE_ALIAS/nhdw-raw/_verify/probe-$$.txt && mc rm $WRITE_ALIAS/nhdw-raw/_verify/probe-$$.txt && rm -f $PROBE" >/dev/null \
  && pass "ingestor RW on nhdw-raw" \
  || fail "ingestor cannot write to nhdw-raw — check policy attachment"

echo ""
if [ "$fail" = "0" ]; then
  printf "\033[32mAll checks passed.\033[0m\n"
else
  printf "\033[31mOne or more checks failed.\033[0m\n" >&2
  exit 1
fi
