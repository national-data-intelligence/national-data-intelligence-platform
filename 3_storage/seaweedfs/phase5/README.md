# Phase 5 — data migration (NOT run; needs an explicit go)

Copies every object from MinIO into the verified SeaweedFS stack and proves the copy
three ways. MinIO stays authoritative and untouched throughout — this is a copy, not a
move. Consumers keep using MinIO until Phase 6/7.

## Why a FRESH backup first
The Phase 3 archive is from 2026-09-07 13:10. MinIO has kept serving since, so its
contents may have moved on. Phase 5 therefore re-takes the backup (same method, S3
layer, from inside the MinIO pod, credentials never leave it), restores *that*, and
verifies against *that* manifest. The old archive stays as history.

## Steps (each idempotent; each stops on failure)
| Step | Script | What |
|---|---|---|
| 1 | `01-fresh-backup.sh` | S3-layer pull of every bucket + manifests + sha256 → `~/nhdw-backups/minio-s3-backup-<stamp>/` |
| 2 | `02-restore-job.sh` | in-cluster Job (gateway image, boto3) restores the archive from a hostPath mount into SeaweedFS with content-type + metadata; admin creds mounted from the Secret |
| 3 | `03-verify-job.sh` | in-cluster Job runs `verify_against_manifest.py`: counts, sizes, sha256 per bucket |

**Exit gate:** step 3 prints `ALL BUCKETS VERIFIED` and exits 0.

Then MinIO keeps running and consumers are repointed one at a time (Phase 6), starting
with read-only ones. Rollback at any point in Phase 5 is: do nothing — MinIO was never
touched.
