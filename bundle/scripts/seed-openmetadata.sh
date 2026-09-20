#!/usr/bin/env bash
# seed-openmetadata.sh — bootstrap the OpenMetadata catalog after deploy.
#
# What it does (idempotent):
#   1. waits for the OM API to answer;
#   2. verifies the ingestion-bot JWT exists in openmetadata-secrets
#      (INGESTION_BOT_TOKEN) and is accepted by the API;
#   3. unpauses + triggers the `openmetadata_ingestion` Airflow DAG once, so
#      the catalog fills (postgres, clickhouse, lake, dbt column lineage,
#      airflow pipelines) without waiting for the 05:00 schedule.
#
# The ONE manual step on a cold boot: the bot token. With SSO enabled OM has
# no scriptable admin login, so an OM administrator (the `superadmin` SSO
# account — AUTHORIZER_ADMIN_PRINCIPALS in base/openmetadata.yaml) issues it
# in the UI: Settings → Bots → ingestion-bot → (re)generate token, then:
#     kubectl -n nhdw patch secret openmetadata-secrets --type merge \
#       -p '{"stringData":{"INGESTION_BOT_TOKEN":"<token>"}}'
# This script tells you exactly that when the token is missing, and exits 0
# (OpenMetadata is catalog-only; a missing catalog never blocks the platform).
set -euo pipefail
NS="${NS:-nhdw}"
OM_SVC="http://openmetadata.$NS.svc.cluster.local:8585"

echo "== seed-openmetadata =="

# 1. OM up? (probe from inside the cluster; OM may legitimately be disabled)
if ! kubectl -n "$NS" get deploy openmetadata >/dev/null 2>&1; then
  echo "  openmetadata not deployed — skipping (catalog is optional)"; exit 0
fi
for i in $(seq 1 60); do
  code=$(kubectl -n "$NS" run om-seed-probe --rm -i --restart=Never --quiet \
      --image=curlimages/curl:8.10.1 -- -s -o /dev/null -w '%{http_code}' \
      -m 5 "$OM_SVC/api/v1/system/version" 2>/dev/null | tail -c 3 || true)
  [ "$code" = "200" ] && break
  sleep 5
done
if [ "${code:-}" != "200" ]; then
  echo "  ✗ OM API not answering after 5 min — skipping (rerun this script later)"; exit 0
fi
echo "  ✓ OM API up"

# 2. bot token present + accepted?
tok=$(kubectl -n "$NS" get secret openmetadata-secrets \
        -o jsonpath='{.data.INGESTION_BOT_TOKEN}' 2>/dev/null | base64 -d || true)
if [ -z "$tok" ]; then
  cat <<'EOT'
  ✗ openmetadata-secrets has no INGESTION_BOT_TOKEN.
    An OM admin (superadmin via SSO) must issue it once:
      Settings → Bots → ingestion-bot → Generate token
    then store it:
      kubectl -n nhdw patch secret openmetadata-secrets --type merge \
        -p '{"stringData":{"INGESTION_BOT_TOKEN":"<token>"}}'
    and rerun this script. Skipping (catalog stays empty until then).
EOT
  exit 0
fi
code=$(kubectl -n "$NS" run om-seed-probe --rm -i --restart=Never --quiet \
    --image=curlimages/curl:8.10.1 -- -s -o /dev/null -w '%{http_code}' -m 5 \
    -H "Authorization: Bearer $tok" "$OM_SVC/api/v1/tables?limit=1" 2>/dev/null | tail -c 3 || true)
if [ "$code" != "200" ]; then
  echo "  ✗ stored bot token rejected ($code) — reissue it (see header). Skipping."; exit 0
fi
echo "  ✓ ingestion-bot token accepted"

# 3. kick the ingestion DAG once (best-effort; scheduler also runs it daily)
if kubectl -n "$NS" get deploy airflow >/dev/null 2>&1; then
  kubectl -n "$NS" exec deploy/airflow -- airflow dags unpause openmetadata_ingestion >/dev/null 2>&1 || true
  kubectl -n "$NS" exec deploy/airflow -- airflow dags trigger openmetadata_ingestion >/dev/null 2>&1 \
    && echo "  ✓ openmetadata_ingestion triggered" \
    || echo "  … could not trigger the DAG (is it parsed yet?) — the 05:00 schedule will run it"
fi
echo "== seed-openmetadata done =="
