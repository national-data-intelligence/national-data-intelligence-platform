#!/bin/bash
# NHDW singleuser entrypoint: reconcile the project's MinIO files into the
# workdir BEFORE the lab opens, keep pushing edits back on a background loop,
# then hand off to the stock start-singleuser.sh (KubeSpawner cmd).
set -u

if [ -n "${NHDW_PROJECT_PREFIX:-}" ]; then
  echo "[nhdw] project-scoped lab (${NHDW_PROJECT_SLUG:-?}) — pulling project files…"
  python3 /usr/local/bin/nhdw_project_sync.py pull || \
    echo "[nhdw] WARNING: project pull failed — the lab opens without project files" >&2
  python3 /usr/local/bin/nhdw_project_sync.py loop &
fi

# First-launch convenience: drop the MLflow quickstart notebook into the workdir
# so researchers discover that MLflow is wired. Non-destructive — never
# overwrites a copy the user already has (and never fights the project sync,
# which reconciles the projects/<id>/files/ prefix, not this repo file).
NB_SRC=/opt/nhdw/mlflow_quickstart.ipynb
NB_DST=/home/jovyan/work/mlflow_quickstart.ipynb
if [ -f "$NB_SRC" ] && [ ! -e "$NB_DST" ]; then
  cp "$NB_SRC" "$NB_DST" 2>/dev/null && echo "[nhdw] seeded mlflow_quickstart.ipynb into ~/work"
fi

exec /usr/local/bin/start-singleuser.sh "$@"
