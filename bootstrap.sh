#!/usr/bin/env bash
# bootstrap.sh (repo root) — thin wrapper for the canonical Kubernetes bootstrap.
#
# This is the entry point after extracting the release zip:
#   ./bootstrap.sh                   # full rebuild: sources → ingestors → pipeline
#   ./bootstrap.sh teardown          # delete cluster + stop sources (clean slate)
#
# The real logic lives in bundle/scripts/bootstrap.sh (Kubernetes only; the
# legacy docker-compose bootstrap is archived under _archive/2026-06-30/).

exec bash "$(dirname "$0")/bundle/scripts/bootstrap.sh" "$@"
