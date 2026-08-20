# NHDW seed pack

This directory is a **seed pack** — the *data* the demo is initialised with, kept **separate
from the system that consumes it**. The goal: change or update the seed data (or ship a
different pack for demo / staging / production) **without editing any application**, and have
the system **refuse a pack it isn't compatible with** rather than break.

## The contract
- `manifest.yaml` declares WHAT is seeded, in WHAT order, and WHICH system versions the pack
  targets (`targets_system`). It conforms to
  [`../scripts/seed-pack-engine/manifest.schema.json`](../scripts/seed-pack-engine/manifest.schema.json).
- The **engine** (`../scripts/seed-pack-engine/`, part of the *system*, versioned with it)
  reads the manifest, checks compatibility, and applies each entry through the adapter named by
  its `kind` (`mysql-dump`, `sqlserver-bak`, `pg-dump`, `sql`, `kcadm`, `mc`, `api`, `csv`).
- **The system defines the contract + the how; the pack provides the what.** Schema/migrations
  stay with the apps (schema = system); only *data* lives here.

## Layout (target)
```
seed-pack/
├── manifest.yaml        # this pack's declaration
├── sources/<system>/    # external-replica dumps (loaded into the source systems)
└── app/                 # application-DB seeds
    ├── security/  keycloak/  ml/  projects/  resource/  graduation/  docs/
```
Data files are migrated in during tasks P1.4–P1.6 (see `docs/production-deployment-plan.md`).

## Validate a pack
```bash
python3 bundle/scripts/seed-pack-engine/validate.py bundle/seed-pack/manifest.yaml \
        --system-version 1.4.0
```
Exit 0 = structurally valid and compatible. A pack whose `targets_system` excludes the running
system version exits non-zero and is **not applied** — the fail-closed guarantee.

## To ship new/updated seeds
1. Edit the data files (or assemble a new pack directory).
2. Bump `seed_pack_version`; set `targets_system` to the compatible system range.
3. Deploy seeds only — no application image rebuild, no script edit.
