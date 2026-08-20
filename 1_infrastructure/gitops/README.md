# NHDW GitOps — day-2 continuous reconciliation (P6.2, optional)

Once a cluster is up and seeded, GitOps keeps the **app tier** in lockstep with git: a push to the
tracked revision becomes a declarative, self-healing upgrade, with drift corrected automatically.
This is the **day-2** story — it does not replace the initial bootstrap.

## The boundary (what GitOps owns vs what stays bootstrap-owned)

ArgoCD reconciles the **same Helm chart** the Ansible deploy role installs
(`1_infrastructure/helm/nhdw`), and **only** that chart:

| Owned by ArgoCD (in the chart, git-reconciled) | NOT owned by ArgoCD (bootstrap prerequisites) |
|---|---|
| Deployments, StatefulSets, Services, RBAC, Ingress | The 7 external-file ConfigMaps + all Secrets (deploy role / secret store) |
| Inline configMaps (opa/trino/observability config) | The seed-pack (a one-time data load, not a reconciled resource) |
| The gateway HPA | The cluster + CNI (provision/cni roles; k3s + Cilium in P5) |

Because the chart never renders the external configMaps or secrets, ArgoCD never touches them —
the boundary is clean by construction (see the chart README's deploy-role contract).

## The flow

```
  Ansible bootstrap  (ONCE)                 ArgoCD  (CONTINUOUS, day-2)
  ────────────────────────────             ──────────────────────────────
  provision → cni → images                 watches the tracked revision
  deploy: configMaps + secrets             reconciles 1_infrastructure/helm/nhdw
          + helm install (first sync)  ──▶  self-heals drift, applies chart upgrades
  seed: source → pipeline → app                (workloads only)
  verify
```

After the one-time bootstrap has created the cluster, CNI, configMaps, secrets, and the first seed,
hand the chart off to ArgoCD. From then on, chart changes ship by merging to the tracked revision.

## Install

1. Install ArgoCD (its own Helm chart / manifests) into the `argocd` namespace — standard, not
   included here.
2. Edit `argocd/appproject.yaml` and `argocd/nhdw-application.yaml`: set `repoURL` /
   `sourceRepos` to your repo, and (production) pin `targetRevision` to an immutable tag/commit
   instead of `main`.
3. Apply:
   ```
   kubectl apply -f argocd/appproject.yaml
   kubectl apply -f argocd/nhdw-application.yaml
   ```
4. Fleet vs single node: switch the Application's `helm.valueFiles` to `values-fleet.yaml`.

## Notes
- `selfHeal: true` + `prune: true` give real day-2 reconciliation; on a shared demo cluster review
  `prune` before enabling, since it deletes objects removed from the chart.
- The Application `ignoreDifferences` the gateway Deployment's `replicas` so ArgoCD does not fight
  the HPA (the autoscaler owns that field, not git).
- A production install should pin `targetRevision` to a tag and use versioned image refs (P2.1) so
  every sync is a deliberate, reviewable bump — not a moving `:dev` / `main`.
