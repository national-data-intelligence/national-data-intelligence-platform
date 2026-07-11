# Deployment and operations

## One entry point

The system has a single canonical bring-up: `bundle/scripts/bootstrap.sh`, with a
thin `./bootstrap.sh` wrapper at the repo root. There is one boot mode. It seeds
only the source systems and lets the real pipeline populate everything downstream
— nothing in the warehouse tiers is seeded directly, so what you see in the
dashboards genuinely came through ingestion and dbt.

```
./bootstrap.sh                 # full bring-up
./bootstrap.sh --rebuild-images  # rebuild the service images from source first
./bootstrap.sh teardown        # remove the cluster, keep the source volumes
./bootstrap.sh teardown --wipe-sources   # factory reset, including source data
```

Roughly, a boot creates the k3d cluster, installs the Cilium network layer, loads
or builds the container images, applies the Kubernetes manifests, waits for
Keycloak and Postgres, brings the source systems up and seeds them, runs the
ingestion and dbt pipeline, then seeds the application and security state
(identities, roles, projects, the ML models, the served docs). Each seeding step
fails loudly, so a red boot means something real broke rather than a silent
half-populated system.

## What ships and what doesn't

The public repository carries the source, not the heavy artifacts. Container image
tars, language-model weights, packed runtime state, the helm/mc binaries and the
source seed dumps are excluded for size. The images rebuild from source and the
binaries download on first run, so a machine with internet reconstitutes them. The
source seed data is the exception — without it the source systems start empty and
the pipeline has nothing to ingest. Supply the dumps under each
`0_external/sources/*/sample-data/` folder (see the notice files there) to
populate a real demo.

## Packing and moving the system

`bundle/scripts/pack.sh` exports the live system's state back into the bundle so a
later boot reproduces it: each source is dumped to its native restore format, the
non-derivable application state (operational databases, the model registry,
stored artifacts) goes to `bundle/state/`, and the served docs are synced into the
bundle. Pipeline-derived tiers are never packed — the boot rebuilds them from the
sources. This keeps the pack/unpack pair honest: sources and app state survive a
round trip, derived data is always recomputed.

## Observability

The cluster runs an offline-capable observability stack — Prometheus for metrics,
Alertmanager for routing, Loki for logs, and Cilium's Hubble for network flow.
The admin console's health-and-topology page reads from these to draw the live
service graph, per-node health, and request-rate on the edges. The operator tools
(Prometheus, Alertmanager, the Kubernetes console) are reached through single
sign-on and restricted to operator roles.

## Seeing it work

Bring the system up, then open the dashboards at their `*.127.0.0.1.nip.io` hosts
and sign in through Keycloak. The demo set includes users across every role — a
data analyst, a regional health bureau officer scoped to one region, a
programme-specific decision-maker, a data scientist, a security officer, and so on
— so you can watch access control in action: the same page shows different data,
or refuses it, depending on who is looking. The public portal needs no login; the
internal, workshop, admin and operator surfaces each admit their own roles.
