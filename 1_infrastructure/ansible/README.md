# NHDW deploy — Ansible (config-driven, single node or fleet)

The operator declares the host fleet in an **inventory** file and one command deploys NHDW —
on one node or many, local or over SSH — with the seed data decoupled from the system. This is
the P4 orchestration layer over the Helm chart (P3) and the seed-pack (P1).

```
cd 1_infrastructure/ansible
ansible-playbook site.yml                                  # single node (inventory/single-node.yml)
ansible-playbook -i inventory/fleet.example.yml site.yml   # fleet
```

Laptop → fleet is **one edit**: the inventory (its `nhdw_topology: single|fleet` selects the
matching Helm values profile, `values-single.yaml` / `values-fleet.yaml`).

## Stages (roles) — they mirror `bundle/scripts/bootstrap.sh`, as inventory-driven roles

| Role | What it does | Wraps |
|---|---|---|
| `provision` | create the cluster | k3d today (P4); **k3s server+agents from the inventory in P5** |
| `cni` | Cilium + Hubble + the node-IP-drift self-heal | bundled Cilium chart + `cilium-values.yaml` |
| `images` | load pre-baked image tars (offline-first) | `cache-images.sh --load-only` |
| `deploy` | external-file configMaps + secrets, `helm upgrade --install`, metrics-server | `gen-secrets.sh`, `gen-tls.sh`, the Helm chart |
| `seed` | source replicas → real pipeline → app/security → OPA → docs/ml/projects/… | the canonical `sources-up.sh` + `seed-*.sh` (bootstrap step-7 order) |
| `verify` | workloads Ready + every dashboard reachable + OPA enforcing | `verify-system.sh` |

The roles **wrap the canonical scripts** — they do not reimplement seeding or the pipeline, so
there is one implementation, one behaviour. The `seed` role's step list is kept in lockstep with
bootstrap.sh's step-7 sequence (a future refactor may extract a shared `seed-all.sh`).

## The deploy role's one piece of real logic
The Helm chart renders every workload + the *inline* configMaps but delegates the **7 external-file
configMaps + the Secrets** (see the chart README). The deploy role generates those from the
**canonical overlay** (no file-list duplication) and applies only them — `roles/deploy/files/
select-external-config.py` drops the chart-owned inline configMaps so Helm and `kubectl apply`
never contend for the same object. Validated against `kustomize build`: it emits exactly the 7
external configMaps + the secrets, zero chart-owned leakage.

## Status
- ✅ Structure + all six roles + playbook + group_vars; YAML-valid; the config selector is
  verified against real `kustomize build` output.
- ⏳ **P4.3** is the end-to-end gate: run this playbook on a clean single node and confirm it
  reproduces today's laptop boot. It needs `ansible` on the control host (not installed in the
  authoring env). `provision`/`cni` are the k3d form; **P5** swaps them to native k3s from the
  inventory and proves a real 2-node fleet + a single node from the same code path.
