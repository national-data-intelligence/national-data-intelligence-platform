# Host add-ons (palladium2)

The k3s/Traefik plumbing that lets the shared `20.84.70.78.nip.io` front door reach
two **separate products** that run as docker-compose on this host and are **not** part
of NHDW:

- **Palladium Projects Console** — its own product/repo; its compose service is
  published on the node at `:8099`. → `palladium-console.yaml`
- **EMR AI-assistant + MLOps tools** — a re-homed system; a host Caddy on `:9443`
  (TLS, self-signed) fronts five hostnames (`emr-ai/files/label/mlflow/s3`).
  → `emr-tools.yaml`

## Why this exists

These manifests are *only* the routing bridge: a selector-less `Service` + a manual
`Endpoints` pointing at the host node IP, plus the `Ingress` (and, for the https EMR
backend, a Traefik `ServersTransport`). The **workloads** stay with their own products
(their compose files live outside this repo) — per the repo's "Kubernetes only" rule
NHDW does not absorb third-party / separate-product systems; it only records the
routing so a reprovision re-applies it instead of silently 404'ing them. That 404 is
the exact failure mode logged in `docs/decisions/2026-10-16-shared-llm-and-emr-rehome.md`.

They are **not** rendered by the Helm chart or the kustomize overlay, and
`ci-redeploy.sh` does not manage them. Apply by hand AFTER provisioning:

    kubectl apply -f bundle/host-addons/

## Host-specific values (swap on a re-home)

Source of truth: `1_infrastructure/ansible/inventory/palladium2.yml`.

| value    | here                  | inventory key              |
|----------|-----------------------|----------------------------|
| hostBase | `20.84.70.78.nip.io`  | `nhdw_host_base_inventory` |
| node IP  | `172.16.0.4`          | `nhdw_node_ip`             |

If either changes, update the hostnames and the Endpoints `ip` in both files. The
live cluster currently carries equivalent directly-created `EndpointSlice`s; applying
the classic `Endpoints` here on a fresh cluster yields the same routing (k8s mirrors
it to a slice automatically).
