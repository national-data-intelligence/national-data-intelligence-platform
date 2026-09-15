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

# ── 1. object-store artifacts first (DB rows reference these objects) ─────────
# Phase 6 (2026-09-09): restored INTO SeaweedFS via bundle/scripts/lib/objstore.sh
# (bundled host-side mc + port-forward). The packed directory is still
# state/minio/nhdw-artifacts — the bundle format did not change.
if [ -d "$STATE/minio/nhdw-artifacts" ]; then
  . "$REPO/bundle/scripts/lib/objstore.sh"
  if objstore_mc && objstore_creds; then
    objstore_pf 19000
    objstore_alias \
      && { "$MC" --config-dir "$OS_MC_CFG" mb --ignore-existing L/nhdw-artifacts >/dev/null 2>&1
           "$MC" --config-dir "$OS_MC_CFG" mirror --quiet --overwrite "$STATE/minio/nhdw-artifacts" L/nhdw-artifacts; } \
      && echo "  ✓ artifacts restored into $OBJSTORE_SVC" || echo "  ! artifact restore failed" >&2
    objstore_pf_stop
  else echo "  ! mc or object-store creds unavailable — artifact restore SKIPPED" >&2; fi
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
