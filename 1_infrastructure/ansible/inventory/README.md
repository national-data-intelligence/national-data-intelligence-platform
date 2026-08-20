# NHDW deploy inventory — the host-fleet contract

This directory is where you **declare the machines NHDW deploys onto**. It is the single
knob that turns a one-laptop demo into a multi-node fleet — *local or remote* — with no code
changes. (Design: `docs/production-deployment-plan.md`.)

## The contract
Every inventory has two host groups and a topology var:

| Field | Meaning |
|---|---|
| `control_plane` (group) | the machine(s) that run the k3s **server** (API + control plane). 1 host normally; 3 (odd) for an HA control plane. |
| `workers` (group) | the k3s **agent** machines that run workloads. Empty on single-node. |
| `nhdw_topology` (var) | `single` or `fleet` — selects the matching workload values profile (replicas, storage class, resource requests, anti-affinity) at deploy time. |
| `nhdw_cluster_name` (var) | the cluster name (`nhdw`). |
| `ansible_host` / `ansible_user` / `ansible_ssh_private_key_file` | per-host: where and how to reach a **remote** machine over SSH. Omit for `localhost` (uses `ansible_connection: local`). |

## Local vs remote is just per-host connection
- **Local** (single laptop): `localhost` with `ansible_connection: local` — see `single-node.yml`.
- **Remote fleet**: real IPs/hostnames + SSH creds — see `fleet.example.yml`.

## Provided inventories
- **`single-node.yml`** — a laptop / one machine. The control-plane node also runs workloads.
- **`fleet.example.yml`** — template for a server + N agents. Copy to `fleet.yml`, fill in hosts.

## How it's used (once the provisioning role lands — P5.1)
```
# single node (this machine)
ansible-playbook -i inventory/single-node.yml site.yml

# a fleet you defined
ansible-playbook -i inventory/fleet.yml site.yml
```
The playbook installs k3s across the inventory (server + agents), lays down the CNI, deploys
the workloads with the topology's values profile, and runs the seed pack. Same command,
different inventory.
