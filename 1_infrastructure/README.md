# `1_infrastructure/` — the declarative production definition

Contains ONLY `k8s/` (kustomize):

- `k8s/base/` — every workload manifest (single namespace `nhdw`).
- `k8s/overlays/dev/` — what the boot applies: base + secrets + ingress +
  the registry→local `images:` remap and OIDC hostname patches.
- `k8s/jobs/` — the one-shot pipeline Jobs (dbt stages + ingestors), built
  per-job by the seed script with the same kustomize `images:` transform.

The imperative bring-up machinery (bootstrap, sources-up, seed scripts, image
build/cache) lives in `bundle/scripts/` — it initializes the system but does
not ship as part of it. Rule: nothing in here mutates at runtime; scripts may
only `kustomize build | kubectl apply` this tree.
