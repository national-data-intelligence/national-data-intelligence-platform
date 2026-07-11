#!/usr/bin/env bash
# reset.sh — DESTRUCTIVE. Wipes the MinIO data volume and re-provisions.
# Run only against dev / throwaway data.

set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/.."

printf "About to:\n"
printf "  1. docker compose down -v\n"
printf "  2. sudo rm -rf %s\n" "${DATALAKE_DATA_DIR:-/data/storage/minio}"
printf "  3. recreate the directory\n"
printf "  4. docker compose up -d minio\n"
printf "  5. docker compose up minio-init\n\n"
read -r -p "Continue? (yes/NO) " ans
[ "$ans" = "yes" ] || { echo "Aborted."; exit 0; }

# shellcheck disable=SC1091
set -a; . ./.env; set +a

docker compose down -v
sudo rm -rf "${DATALAKE_DATA_DIR:-/data/storage/minio}"
sudo mkdir -p "${DATALAKE_DATA_DIR:-/data/storage/minio}"
sudo chown -R 1000:1000 "${DATALAKE_DATA_DIR:-/data/storage/minio}"
docker compose up -d minio
docker compose up minio-init
bash scripts/verify.sh
