#!/usr/bin/env bash
# Download + restore the DHIS2 demo database (Sierra Leone reference DB by default).
# This populates the empty DHIS2 PG database with realistic org units, data
# elements, indicators, and data values, so the API at /api/... returns real
# answers.
#
# Prereq: dhis2-db container is up and healthy.
# Usage:  bash scripts/restore.sh

set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
else
  echo "ERROR: .env not found. Run: cp .env.example .env" >&2
  exit 1
fi

CONTAINER=dhis2-db
DB="${DHIS2_DB_NAME:-dhis2}"
DB_USER="${DHIS2_DB_USER:-dhis}"
DEMO_URL="${DHIS2_DEMO_DB_URL:?DHIS2_DEMO_DB_URL must be set}"
DUMP_LOCAL="sample-data/dhis2_${DHIS2_DEMO_DB_VARIANT:-demo}.sql.gz"
DUMP_IN_CONTAINER=/tmp/dhis2.sql.gz

echo "==> Waiting for $CONTAINER to be healthy..."
for _ in $(seq 1 60); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo "starting")
  if [ "$status" = "healthy" ]; then break; fi
  sleep 3
done
if [ "$status" != "healthy" ]; then
  echo "ERROR: $CONTAINER did not reach healthy status." >&2
  exit 1
fi

# Download the demo dump if we don't already have it.
if [ ! -f "$DUMP_LOCAL" ]; then
  echo "==> Downloading DHIS2 demo DB from $DEMO_URL ..."
  curl -fSL "$DEMO_URL" -o "$DUMP_LOCAL"
else
  echo "==> Reusing cached dump at $DUMP_LOCAL"
fi

echo "==> Copying dump into container..."
docker cp "$DUMP_LOCAL" "$CONTAINER:$DUMP_IN_CONTAINER"

echo "==> Dropping + recreating database '$DB' ..."
docker exec -i "$CONTAINER" psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$DB\";"
docker exec -i "$CONTAINER" psql -U "$DB_USER" -d postgres -c "CREATE DATABASE \"$DB\" WITH OWNER \"$DB_USER\";"
docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB" -c "CREATE EXTENSION IF NOT EXISTS postgis;"

echo "==> Restoring dump (5-20 min depending on size)..."
docker exec -i "$CONTAINER" bash -c "gunzip -c $DUMP_IN_CONTAINER | psql -U $DB_USER -d $DB -q"

echo "==> Removing dump from container..."
docker exec "$CONTAINER" rm -f "$DUMP_IN_CONTAINER"

echo "==> Provisioning read-only ingestor user..."
docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB" <<SQL
CREATE USER ingestor WITH PASSWORD 'changeme-ingestor-password' NOSUPERUSER LOGIN;
ALTER USER ingestor WITH PASSWORD 'changeme-ingestor-password';
GRANT CONNECT ON DATABASE "${DB}" TO ingestor;
GRANT USAGE ON SCHEMA public TO ingestor;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ingestor;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ingestor;
SQL

echo "==> Row counts..."
docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB" -c "
SELECT 'organisationunit'  AS tbl, count(*) FROM organisationunit
UNION ALL SELECT 'dataelement',   count(*) FROM dataelement
UNION ALL SELECT 'datavalue',     count(*) FROM datavalue
UNION ALL SELECT 'indicator',     count(*) FROM indicator
UNION ALL SELECT 'dataset',       count(*) FROM dataset
UNION ALL SELECT 'period',        count(*) FROM period;
"

echo ""
echo "OK — restore complete."
echo "Next: start the DHIS2 web app (Liquibase migrations run on first boot, 5-15 min):"
echo "  docker compose up -d dhis2"
echo "  docker logs -f dhis2-web   # wait for 'Server startup in X ms'"
echo ""
echo "Then verify: bash scripts/verify.sh"
echo ""
echo "Note: we deliberately do NOT trigger /api/resourceTables/generate (analytics"
echo "tables). The ingestor consumes raw values via /api/dataValueSets and"
echo "re-aggregates in dbt — analytics tables would couple us to DHIS2's"
echo "business-rule layer, which the Data Vault 2.0 methodology argues against."
