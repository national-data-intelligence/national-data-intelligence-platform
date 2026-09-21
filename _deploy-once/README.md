# Temporary — remove after the console deploy

The demo console is its own repository and is deliberately **not** part of this
one. It is here for exactly one reason: it has to reach the self-hosted runner,
and the runner only ever checks out this repository.

So this directory is a one-off courier, authorised as a one-off. The moment the
console is on the host, **delete this directory and the `deploy-console` job in
`.github/workflows/deploy.yml`** — the console is not an NHDW component and a
copy of it living here will go stale and mislead somebody.

The durable answer is the console having its own repository with a workflow
pointed at the same runner. Until then, this.

Copied from `palladium-console/` at the commit that added it.
