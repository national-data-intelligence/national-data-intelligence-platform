#!/usr/bin/env bash
# sources-up.sh — bring up + seed the EXTERNAL replicas the warehouse depends on:
# the ingestion sources (DHIS2, an OpenMRS EMR, the EPSS SQL Server hosting HCMISWDM
# + mBrana, a HAPI FHIR facility registry, a climate CSV API, an eLMIS/OpenLMIS
# logistics extract), the Fayda OIDC IdP,
# AND the LLM (Ollama) the dashboard assistant calls. These are the "outside world"
# systems: they live in docker-compose (NOT k8s) — in production they are not ours to
# run — and publish on 0.0.0.0 so k3d pods reach them via host.k3d.internal (the LLM
# on :11434, fayda on :8096, each source on its own port).
#
# bootstrap.sh calls `sources-up.sh up` after the k3d cluster exists (so
# host.k3d.internal routing is valid) and before seed-realistic.
#
# Usage:
#   sources-up.sh up        # compose up + restore/seed every source + LLM + fayda
#   sources-up.sh down      # docker compose down every external stack (teardown)
#   sources-up.sh up llm    # (optional) just one target: llm|dhis2|ethioemr|hcmis|mfr|climate|elmis
#
# Host prereqs (documented in each source README): docker compose, python3 with the
# per-source deps (requests for DHIS2/MFR seeders; pyodbc/pymssql for the SQL-Server
# synthesize scripts). The reader passwords in each 0_external/sources/<src>/.env MUST match the
# `source-creds` Secret the in-cluster ingestors use (kept in lock-step by design).
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$REPO/0_external/sources"
EXT="$REPO/0_external"

log()  { printf '  %s\n' "$*"; }
step() { printf '\n▸ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*" >&2; }

# Ensure a source has a usable .env (restore/seed scripts `source .env`). The committed
# .env.example carries changeme-* placeholders that already match source-creds for dev.
ensure_env() { local d="$1"; [ -f "$d/.env" ] || { [ -f "$d/.env.example" ] && cp "$d/.env.example" "$d/.env" && log "created $(basename "$d")/.env from .env.example"; }; return 0; }

compose() { docker compose -f "$1/docker-compose.yml" "${@:2}"; }

# Poll an HTTP endpoint until it returns (optionally matching a body substring).
wait_http() { # url pattern timeout_s
  local url="$1" pat="${2:-}" t="${3:-300}" i=0
  while [ "$i" -lt "$t" ]; do
    local body; body="$(curl -fs --max-time 5 "$url" 2>/dev/null)" && { [ -z "$pat" ] || printf '%s' "$body" | grep -q "$pat"; } && return 0
    sleep 5; i=$((i+5))
  done
  return 1
}

# Poll `docker inspect` health until healthy.
wait_healthy() { # container timeout_s
  local c="$1" t="${2:-240}" i=0
  while [ "$i" -lt "$t" ]; do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$c" 2>/dev/null)" = "healthy" ] && return 0
    sleep 5; i=$((i+5))
  done
  return 1
}

# The SYNTH_VERSION a synthesizer script declares (its data contract). Compared
# against the marker the synthesizer stamps into the DB (dbo.SynthMeta /
# openmrs.synth_meta): a restored pack made by an OLDER synthesizer no longer
# passes the seed-only-if-empty check — it gets re-synthesized. Root-cause guard
# for the 2026-07-10 supply-utopia regression (stale .bak masked the 07-07 fix).
synth_ver() { grep -oE 'SYNTH_VERSION *= *[0-9]+' "$1" | head -1 | grep -oE '[0-9]+'; }

# ── per-source bring-up ───────────────────────────────────────────────────────

up_llm() {
  # External Ollama — the dashboard assistant's model runtime (0_external/llm/).
  # It is external for the same reason the sources are: on WSL2 a GPU can't be used
  # inside a nested k3d pod, so the ONLY working 14b-on-GPU path is a host-local
  # ollama container. The gateway reaches it at host.k3d.internal:11434.
  step "LLM — external Ollama (dashboard assistant model runtime)"
  local d="$EXT/llm"; local files=(-f "$d/docker-compose.yml")
  # Host GPU? layer the additive GPU overlay so ollama offloads the model (14b ≈ 25
  # tok/s on an RTX 5080). CPU-only hosts run the base compose unchanged (3b). This
  # is the SAME host-GPU decision gpu-detect.sh uses to pick the gateway model.
  local have_gpu=0
  if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
    have_gpu=1; files+=(-f "$d/docker-compose.gpu.yml")
    log "host GPU detected — bringing up ollama WITH the GPU overlay (14b)"
  else
    log "no host GPU — bringing up ollama on CPU (3b)"
  fi
  docker compose "${files[@]}" up -d >/dev/null 2>&1 || { warn "llm compose up failed"; return 1; }
  wait_http "http://127.0.0.1:11434/api/tags" "" 180 \
    || { warn "external ollama never became ready on :11434"; return 1; }
  log "external ollama healthy (host.k3d.internal:11434)"
  # Ensure the model(s) the gateway will use are present in the mounted weights.
  # Both 3b + 14b ship in 0_external/llm/models, so this is a no-op on a bundle
  # cold-boot; it only LOUD-pulls if a weight is genuinely missing (fresh weights dir).
  ensure_model() { # tag
    docker exec nhdw-ollama ollama list 2>/dev/null | grep -q "qwen2.5:$1" && { log "qwen2.5:$1 present in the weights"; return 0; }
    warn "qwen2.5:$1 NOT in the weights — NETWORK pull (FIX THE BUNDLE to ship it)"
    docker exec nhdw-ollama ollama pull "qwen2.5:$1" >/dev/null 2>&1 && log "qwen2.5:$1 pulled" || warn "qwen2.5:$1 pull failed"
  }
  ensure_model 3b
  [ "$have_gpu" = 1 ] && ensure_model 14b
  # Preload the model the gateway will use into (V)RAM + pin it resident, so the
  # first assistant request isn't a cold load (which surfaces as "model
  # unreachable"). 14b on GPU hosts, 3b on CPU — matches the gateway's model pick.
  local warm_model="qwen2.5:3b"; [ "$have_gpu" = 1 ] && warm_model="qwen2.5:14b"
  curl -s --max-time 120 "http://127.0.0.1:11434/api/generate" \
    -d "{\"model\":\"$warm_model\",\"keep_alive\":\"24h\",\"prompt\":\"warmup\",\"stream\":false,\"options\":{\"num_predict\":1}}" \
    >/dev/null 2>&1 && log "$warm_model preloaded + pinned resident" \
    || warn "$warm_model preload failed (first assistant call will cold-start)"
}

up_fayda() {
  step "Fayda Replica — external OIDC IdP (national digital-ID integration demo)"
  compose "$EXT/fayda" up -d --build >/dev/null 2>&1 || { warn "fayda compose up failed"; return 1; }
  wait_healthy fayda-replica 120 && log "fayda-replica healthy (localhost:8096)" || warn "fayda-replica not healthy (continuing)"
}

up_climate() {
  step "Climate — CSV API (no seed; serves the mounted weekly.csv)"
  ensure_env "$SRC/Climate"
  compose "$SRC/Climate" up -d >/dev/null 2>&1 || { warn "climate compose up failed"; return 1; }
  wait_healthy climate-api 120 && log "climate-api healthy" || warn "climate-api not healthy (continuing)"
}

up_mfr() {
  step "MFR — HAPI FHIR facility registry"
  ensure_env "$SRC/MFR"
  compose "$SRC/MFR" up -d >/dev/null 2>&1 || { warn "mfr compose up failed"; return 1; }
  wait_http "http://127.0.0.1:8093/fhir/metadata" "" 300 || { warn "MFR FHIR never became ready"; return 1; }
  log "MFR ready — seeding FHIR bundles"
  ( cd "$SRC/MFR" && MFR_FHIR_BASE="http://127.0.0.1:8093/fhir" python3 scripts/seed.py ) \
    && log "MFR seeded" || warn "MFR seed.py failed"
}

up_ethioemr() {
  step "EthioEMR — OpenMRS/MySQL"
  ensure_env "$SRC/EthioEMR"
  compose "$SRC/EthioEMR" up -d >/dev/null 2>&1 || { warn "ethioemr compose up failed"; return 1; }
  wait_healthy ethioemr-mysql 240 || { warn "ethioemr-mysql not healthy"; return 1; }
  log "ethioemr-mysql healthy — restoring dump + provisioning reader"
  ( cd "$SRC/EthioEMR" && bash scripts/restore.sh ) && log "EthioEMR restored" || warn "EthioEMR restore.sh failed"
  # SEED-ONLY-IF-CURRENT (pack/unpack contract): the restore artifact is the
  # source of truth. A factory dump is schema-only → synthesize fills it; a
  # PACKED dump carries clinical rows (incl. runtime changes) → trusted, BUT
  # only while its synth_meta version matches the synthesizer's contract —
  # version drift means the script changed what it writes, so re-synthesize.
  # A marker-LESS non-empty dump is trusted with a warning (pre-marker packs
  # may carry runtime clinical edits that a blind re-synth would destroy).
  MYQ() { docker exec ethioemr-mysql mysql -h127.0.0.1 -uroot -p"${ETHIOEMR_MYSQL_ROOT_PASSWORD:-changeme-ethioemr-root}" -N -e "$1" 2>/dev/null | tr -dc 0-9; }
  OBS=$(MYQ "SELECT COUNT(*) FROM openmrs.obs;")
  EMR_HAVE=$(MYQ "SELECT COALESCE(MAX(synth_version),0) FROM openmrs.synth_meta;")
  EMR_WANT=$(synth_ver "$SRC/EthioEMR/scripts/synthesize.py")
  if [ "${OBS:-0}" -gt 0 ] && [ "${EMR_HAVE:-0}" = "${EMR_WANT:-1}" ]; then
    log "EthioEMR already carries current clinical data (obs=${OBS}, synth v${EMR_HAVE}) — skipping synthesize"
  elif [ "${OBS:-0}" -gt 0 ] && [ "${EMR_HAVE:-0}" = "0" ]; then
    warn "EthioEMR carries data (obs=${OBS}) but NO synth marker (pre-marker pack) — trusting it; re-pack to stamp"
  else
    [ "${OBS:-0}" -gt 0 ] && log "EthioEMR synth-version drift (have v${EMR_HAVE:-0}, want v${EMR_WANT:-1}) — re-synthesizing"
    ( cd "$SRC/EthioEMR" && python3 scripts/synthesize.py ) && log "EthioEMR synthesized" || warn "EthioEMR synthesize failed"
  fi
}

up_hcmis_mbrana() {
  # ONE SQL Server hosts BOTH HCMISWDM and HCMISWCloud (mBrana). Bring the instance
  # up via the HCMISWDM compose, restore HCMISWDM, then restore mBrana side-by-side.
  step "HCMISWDM + mBrana — shared SQL Server 2025"
  ensure_env "$SRC/HCMISWDM"; ensure_env "$SRC/mBrana"
  compose "$SRC/HCMISWDM" up -d >/dev/null 2>&1 || { warn "hcmiswdm compose up failed"; return 1; }
  wait_healthy hcmiswdm-sqlserver 300 || { warn "hcmiswdm-sqlserver not healthy"; return 1; }
  log "SQL Server healthy — restoring HCMISWDM"
  ( cd "$SRC/HCMISWDM" && bash scripts/restore.sh ) && log "HCMISWDM restored" || warn "HCMISWDM restore.sh failed"
  # SEED-ONLY-IF-CURRENT: the golden .bak carries facts, but only facts stamped
  # with the CURRENT synthesizer contract count — a version-drifted (or
  # marker-less) pack is re-synthesized in place (idempotent DELETE+INSERT).
  SQLQ() { docker exec hcmiswdm-sqlserver /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "${HCMISWDM_SA_PASSWORD:-ChangeMe-MUST-be-strong-Aa1!}" -C -h -1 -Q "SET NOCOUNT ON; $1" 2>/dev/null | tr -dc 0-9; }
  FACTS=$(SQLQ "SELECT COUNT(*) FROM HCMISWDM.Fact.DailyRecord")
  WDM_HAVE=$(SQLQ "SELECT ISNULL(MAX(SynthVersion),0) FROM HCMISWDM.dbo.SynthMeta")
  WDM_WANT=$(synth_ver "$SRC/HCMISWDM/scripts/synthesize_analytics.py")
  # Dispatch plan (Supply Control Tower) rides the same restore — its own marker
  # so a pack that predates the dispatch loader re-synthesizes to add it.
  DISP_HAVE=$(SQLQ "SELECT ISNULL(MAX(SynthVersion),0) FROM HCMISWDM.dbo.DispatchSynthMeta")
  DISP_WANT=$(grep -oE 'DISPATCH_SYNTH_VERSION *= *[0-9]+' "$SRC/HCMISWDM/scripts/synthesize_dispatch.py" | head -1 | grep -oE '[0-9]+')
  if [ "${FACTS:-0}" -gt 0 ] && [ "${WDM_HAVE:-0}" = "${WDM_WANT:-1}" ] && [ "${DISP_HAVE:-0}" = "${DISP_WANT:-1}" ]; then
    log "HCMISWDM already carries current facts (DailyRecord=${FACTS}, synth v${WDM_HAVE}, dispatch v${DISP_HAVE}) — skipping synthesize"
  else
    [ "${FACTS:-0}" -gt 0 ] && log "HCMISWDM synth-version drift (analytics have v${WDM_HAVE:-0}/want v${WDM_WANT:-1}, dispatch have v${DISP_HAVE:-0}/want v${DISP_WANT:-1}) — re-synthesizing"
    ( cd "$SRC/HCMISWDM" && python3 scripts/synthesize.py && python3 scripts/synthesize_analytics.py && python3 scripts/synthesize_dispatch.py ) \
      && log "HCMISWDM synthesized" || warn "HCMISWDM synthesize failed (facts may be empty — resilient views tolerate this)"
  fi
  log "restoring mBrana (HCMISWCloud) into the same instance"
  ( cd "$SRC/mBrana" && bash scripts/restore.sh ) && log "mBrana restored" || warn "mBrana restore.sh failed"
  MBR=$(SQLQ "SELECT COUNT(*) FROM HCMISWCloud.mFlowUSSD.SOHLogs")
  MBR_HAVE=$(SQLQ "SELECT ISNULL(MAX(SynthVersion),0) FROM HCMISWCloud.dbo.SynthMeta")
  MBR_WANT=$(synth_ver "$SRC/mBrana/scripts/synthesize.py")
  if [ "${MBR:-0}" -gt 0 ] && [ "${MBR_HAVE:-0}" = "${MBR_WANT:-1}" ]; then
    log "mBrana already carries current data (SOHLogs=${MBR}, synth v${MBR_HAVE}) — skipping synthesize"
  else
    [ "${MBR:-0}" -gt 0 ] && log "mBrana synth-version drift (have v${MBR_HAVE:-0}, want v${MBR_WANT:-1}) — re-synthesizing"
    ( cd "$SRC/mBrana" && python3 scripts/synthesize.py ) && log "mBrana synthesized" || warn "mBrana synthesize failed"
  fi
}

up_elmis() {
  step "eLMIS — OpenLMIS historical extract (Postgres)"
  ensure_env "$SRC/OpenLMIS"
  compose "$SRC/OpenLMIS" up -d >/dev/null 2>&1 || { warn "elmis compose up failed"; return 1; }
  wait_healthy elmis-postgres 240 || { warn "elmis-postgres not healthy"; return 1; }
  log "elmis-postgres healthy"
  # SEED-ONLY-IF-EMPTY. eLMIS has NO synthesizer (unlike EthioEMR/HCMISWDM/mBrana):
  # the dump is a historical extract with no source app that could regenerate it,
  # so there is no synth-version contract to drift against — a populated DB is
  # always trusted, and a missing dump is a hard stop rather than a fallback.
  local dump="$SRC/OpenLMIS/sample-data/elmis_historical_data_simulated.sql.gz"
  if [ ! -f "$dump" ]; then
    warn "eLMIS dump absent ($dump) — source stays EMPTY (see sample-data/SEED-DATA-NOTICE.md)"
    return 1
  fi
  PGQ() { docker exec elmis-postgres psql -U "${ELMIS_DB_USER:-elmis}" -d "${ELMIS_DB_NAME:-elmis}" -At -c "$1" 2>/dev/null | tr -dc 0-9; }
  local lines; lines=$(PGQ "SELECT count(*) FROM history.requisition_line;")
  if [ "${lines:-0}" -gt 0 ]; then
    log "eLMIS already carries history (requisition_line=${lines}) — skipping restore"
  else
    log "restoring eLMIS extract ($(du -h "$dump" | cut -f1) gz / ~1.5 GB — 5-15 min)"
    ( cd "$SRC/OpenLMIS" && bash scripts/restore.sh ) >/dev/null 2>&1 \
      && log "eLMIS restored" || warn "eLMIS restore.sh failed"
  fi
}

up_dhis2() {
  step "DHIS2 — the slow one (Liquibase schema init, ~5-10 min) + Ethiopia + IDSR seed"
  ensure_env "$SRC/DHIS2"
  compose "$SRC/DHIS2" up -d >/dev/null 2>&1 || { warn "dhis2 compose up failed"; return 1; }
  # PACKED-STATE restore: if pack.sh exported a pg dump and the DB has no data
  # values yet, restore it (then bounce the web app so caches/migrations realign).
  DHIS2_DUMP="$SRC/DHIS2/sample-data/dhis2_seeded.pgdump"
  if [ -f "$DHIS2_DUMP" ]; then
    for i in $(seq 1 24); do docker exec dhis2-db pg_isready -U dhis -d postgres -q 2>/dev/null && break; sleep 5; done
    DV=$(docker exec dhis2-db psql -U dhis -d dhis2 -At -c "SELECT count(*) FROM datavalue" 2>/dev/null | tr -dc 0-9)
    if [ "${DV:-0}" -eq 0 ]; then
      log "restoring packed DHIS2 state ($(du -h "$DHIS2_DUMP" | cut -f1))"
      ( cd "$SRC/DHIS2" && bash scripts/restore.sh ) && { docker restart dhis2-web >/dev/null 2>&1; log "DHIS2 restored from pack"; } \
        || warn "DHIS2 packed restore failed — continuing to live-seed path"
    else
      log "DHIS2 already carries data (datavalue=${DV}) — packed dump not needed"
    fi
  fi
  # DHIS2 answers /api/system/info once migrations finish (auth required — use admin).
  wait_http "http://admin:district@127.0.0.1:8080/api/system/info.json" "version" 900 \
    || { warn "DHIS2 never became ready (schema init can take >10 min)"; return 1; }
  # Skip the expensive seed if IDSR is already present (idempotent re-runs).
  if curl -fs "http://admin:district@127.0.0.1:8080/api/dataElements.json?filter=code:like:IDSR&fields=id&paging=false" 2>/dev/null | grep -q '"id"'; then
    log "DHIS2 already seeded (IDSR data elements present) — skipping seed_ethiopia.py"
    return 0
  fi
  log "DHIS2 ready — seeding Ethiopia metadata + HMIS + IDSR weekly surveillance"
  ( cd "$SRC/DHIS2" && python3 scripts/seed_ethiopia.py ) && log "DHIS2 seeded (incl. IDSR)" || warn "seed_ethiopia.py failed"
}

# ── teardown ──────────────────────────────────────────────────────────────────
down_all() { # $1 = "--wipe" to ALSO delete the volumes (true factory reset)
  local vol_flag=""
  [ "${1:-}" = "--wipe" ] && vol_flag="-v"
  step "Stopping all external source stacks${vol_flag:+ + WIPING volumes (factory reset)}"
  for d in DHIS2 EthioEMR HCMISWDM MFR Climate OpenLMIS; do
    [ -f "$SRC/$d/docker-compose.yml" ] && { compose "$SRC/$d" down $vol_flag >/dev/null 2>&1 && log "$d down${vol_flag:+ (volumes wiped)}" || warn "$d down failed"; }
  done
  [ -f "$EXT/fayda/docker-compose.yml" ] && { compose "$EXT/fayda" down $vol_flag >/dev/null 2>&1 && log "fayda down" || warn "fayda down failed"; }
  # External LLM (0_external/llm/) — bind-mounts ./models (no named volume), so `down
  # -v` never wipes the bundled weights. `down` without the GPU overlay is enough.
  [ -f "$EXT/llm/docker-compose.yml" ] && { docker compose -f "$EXT/llm/docker-compose.yml" down $vol_flag >/dev/null 2>&1 && log "llm down" || warn "llm down failed"; }
  # mBrana shares HCMISWDM's instance (no own compose) — already handled above.
}

# ── main ──────────────────────────────────────────────────────────────────────
ACTION="${1:-up}"; ONLY="${2:-}"
case "$ACTION" in
  up)
    echo "== sources-up: bringing up external source replicas =="
    if [ -n "$ONLY" ]; then
      case "$ONLY" in
        llm) up_llm ;; climate) up_climate ;; mfr) up_mfr ;; ethioemr) up_ethioemr ;;
        hcmis|hcmiswdm|mbrana) up_hcmis_mbrana ;; dhis2) up_dhis2 ;;
        elmis|openlmis) up_elmis ;;
        *) echo "unknown source: $ONLY" >&2; exit 2 ;;
      esac
    else
      # LLM + fayda first (fast; the assistant + auth want them early). Then the
      # data sources; DHIS2 (slowest) last so its long wait overlaps nothing critical.
      up_llm; up_fayda; up_climate; up_mfr; up_ethioemr; up_hcmis_mbrana; up_elmis; up_dhis2
    fi
    echo; echo "== sources-up: done =="
    ;;
  down) down_all "${2:-}" ;;
  *) echo "usage: sources-up.sh up|down [--wipe] | up [source]" >&2; exit 2 ;;
esac
