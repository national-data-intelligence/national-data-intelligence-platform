#!/usr/bin/env bash
# restore-state.sh — the unpack half of pack.sh. Restores bundle/state/ (the
# machine-exported runtime state) into the freshly-booted cluster, BEFORE the
# editable bundle/seeds YAML is applied on top (managed_by provenance keeps the
# YAML authoritative for what it declares; runtime rows come from these dumps).
#
# OPTIONAL by design: a factory bundle ships no bundle/state/ — this script
# no-ops and the boot produces the day-one system purely from seeds.
# Ordering inside: MinIO objects BEFORE the DB dumps that reference them
# (MLflow registry rows / ops_artifact rows carry object URIs).
#
# Called by bootstrap.sh between the platform wait and the DATA/APP seeds.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NS=nhdw
STATE="$REPO/bundle/state"
export PATH="$HOME/.local/bin:$PATH"

[ -d "$STATE" ] || { echo "  (no bundle/state — factory bundle, nothing to restore)"; exit 0; }

echo "== restore-state: applying packed runtime state =="

# ── 1. MinIO artifacts first (DB rows reference these objects) ───────────────
# Host-side BUNDLED mc binary against a short-lived port-forward. Never docker:
# on Docker Desktop/WSL2 a container (even --network=host) lives in the Desktop
# VM and cannot reach a port-forward bound on the WSL host — only the host can.
if [ -d "$STATE/minio/nhdw-artifacts" ]; then
  MC="$REPO/bundle/bin/mc"
  if [ ! -x "$MC" ]; then
    echo "  ! bundle/bin/mc missing — falling back to NETWORK download (FIX THE BUNDLE)" >&2
    mkdir -p "$REPO/bundle/bin"
    curl -fsSL --max-time 120 -o "$MC" https://dl.min.io/client/mc/release/linux-amd64/mc \
      && chmod +x "$MC" || { echo "  ! mc unavailable — MinIO artifact restore SKIPPED" >&2; MC=""; }
  fi
  MUSER=$(kubectl -n "$NS" get secret minio-secrets -o jsonpath='{.data.ROOT_USER}' 2>/dev/null | base64 -d)
  MPW=$(kubectl -n "$NS" get secret minio-secrets -o jsonpath='{.data.ROOT_PASSWORD}' 2>/dev/null | base64 -d)
  for i in $(seq 1 24); do
    kubectl -n "$NS" get pods -l app=minio-datalake -o jsonpath='{.items[0].status.phase}' 2>/dev/null | grep -q Running && break
    sleep 5
  done
  kubectl -n "$NS" port-forward svc/minio-datalake 19000:9000 >/dev/null 2>&1 &
  PF=$!
  for i in $(seq 1 12); do
    curl -s -o /dev/null --max-time 2 http://127.0.0.1:19000/minio/health/live && break
    sleep 2
  done
  if [ -n "$MC" ]; then
    MC_CONFIG_DIR=$(mktemp -d)
    "$MC" --config-dir "$MC_CONFIG_DIR" alias set L http://127.0.0.1:19000 "$MUSER" "$MPW" >/dev/null \
      && { "$MC" --config-dir "$MC_CONFIG_DIR" mb --ignore-existing L/nhdw-artifacts >/dev/null 2>&1
           "$MC" --config-dir "$MC_CONFIG_DIR" mirror --quiet --overwrite "$STATE/minio/nhdw-artifacts" L/nhdw-artifacts; } \
      && echo "  ✓ MinIO artifacts restored" || echo "  ! MinIO artifact restore failed" >&2
    rm -rf "$MC_CONFIG_DIR"
  fi
  kill $PF 2>/dev/null
fi

# ── 2. ops databases — FAST-BOOT ONLY (a warm-start CACHE, not truth) ─────────
# The default cold boot does NOT restore these: it seeds nhdw_ops / nhdw_mlflow
# FRESH from files + Jobs (seed-app-security's YAML loaders, seed-ml's train +
# predict-batch, seed-projects, seed-graduation) on top of the CURRENT initdb
# schema. That is the canonical "seed from files, never restore stale app state"
# contract and the true from-scratch cold boot the validation proves.
# `pg_restore --clean` of a packed dump silently reverts the schema to the dump's
# (possibly stale) shape — dropping any column/table added since it was packed —
# which repeatedly broke cold boot (widget.source, model_drift.kind, …). So this
# runs ONLY under `bootstrap.sh --fast` (NHDW_FAST_BOOT=1), same as the derived
# cache below; a fast boot restores the packed rows to skip the seed/train work.
PGPW=$(kubectl -n "$NS" get secret postgres-vault-secrets -o jsonpath='{.data.POSTGRES_PASSWORD}' 2>/dev/null | base64 -d)
if [ "${NHDW_FAST_BOOT:-0}" = "1" ]; then
  for db in nhdw_ops nhdw_mlflow; do
    dump="$STATE/ops/${db}.dump"
    [ -f "$dump" ] || continue
    kubectl -n "$NS" exec -i postgres-vault-0 -- env PGPASSWORD="$PGPW" \
      pg_restore -U vault_admin -d "$db" --clean --if-exists --no-owner < "$dump" >/dev/null 2>&1
    echo "  ⚡ FAST BOOT: ${db} restored from pack ($(du -h "$dump" | cut -f1))"
  done
else
  echo "  default boot — nhdw_ops / nhdw_mlflow seeded FRESH from files (packed dumps skipped; --fast to restore)"
fi

# ── 3. OPTIONAL derived fast-boot cache — ONLY under NHDW_FAST_BOOT ───────────
# Default boot NEVER touches this (the pipeline re-derives marts from source).
# `bootstrap.sh --fast` sets NHDW_FAST_BOOT=1 and, if the snapshot is present,
# restores it here so the pipeline stage can be skipped. Exports FAST_DERIVED=1
# on success so bootstrap knows the marts are already in place.
if [ "${NHDW_FAST_BOOT:-0}" = "1" ] && [ -f "$STATE/derived/derived.dump" ]; then
  echo "  ⚡ FAST BOOT: restoring derived snapshot (marts/vault/landing) — a CACHE, not truth"
  if kubectl -n "$NS" exec -i postgres-vault-0 -- env PGPASSWORD="$PGPW" \
       pg_restore -U vault_admin -d nhdw_vault --clean --if-exists --no-owner < "$STATE/derived/derived.dump" >/dev/null 2>&1; then
    echo "  ✓ derived snapshot restored ($(du -h "$STATE/derived/derived.dump" | cut -f1)) — pipeline will be SKIPPED"
    echo "FAST_DERIVED=1" > /tmp/nhdw-fast-boot.flag
  else
    echo "  ! derived restore failed — bootstrap will fall back to the full pipeline" >&2
  fi
fi

echo "== restore-state complete =="
