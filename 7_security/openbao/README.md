> **FUTURE PHASE (P-C.2) — NOT DEPLOYED.** Nothing in the current boot deploys
> OpenBao; every live component consumes k8s Secrets from
> `1_infrastructure/k8s/overlays/dev/secrets.yaml`. This folder is the design
> spec (policies, rotation scripts) for the production-grade secrets phase:
> OpenBao + External Secrets Operator syncing into the SAME k8s Secret names,
> so activation requires zero component changes. Do not wire anything here into
> the boot before that phase.

# NHDW OpenBao — secrets manager + dynamic credential issuer

OpenBao is the open-source fork of HashiCorp Vault (MPL-2.0; same API + CLI;
the `bao` binary is a drop-in for `vault`). We run it as the central
**secrets store** AND the **dynamic credential issuer** for the warehouse.

| Role | What it does for us |
|---|---|
| **KV v2 (`secret/`)** | static service secrets replacing ad-hoc `.env` files (MLflow tokens, MinIO scratch keys, etc.) |
| **Database secrets engine** | issues short-TTL Postgres roles to dbt runs, JupyterHub kernels, the bridge job, BI consumers — never store a long-lived DB password in app config again |
| **AppRole auth** | machine-to-machine auth for services that can't OIDC (cron jobs, the bridge job) |
| **OIDC auth** | (wired in A4 after Keycloak) maps Keycloak JWTs → Bao identities so a user's `R-CONS-ANA` claim lets them call `bao read database/creds/postgres-vault-bi-reader` |

## Layout

```
7_security/openbao/
├── docker-compose.yml         openbao 2.4.3 on 127.0.0.1:8200
├── .env.example
├── config/                    (reserved for future declarative audit config)
├── policies/                  HCL policies, one per role (role-r-ops-eng.hcl, …)
└── scripts/
    ├── bootstrap.sh           idempotent: init → unseal → mounts → policies
    └── verify.sh              sanity checks
```

## First boot

```bash
cd 7_security/openbao
cp .env.example .env                   # fill PG_VAULT_ADMIN_PASSWORD
docker compose up -d
docker exec openbao sh /openbao/scripts/bootstrap.sh
docker exec openbao sh /openbao/scripts/verify.sh
```

The bootstrap is idempotent — re-running it on an already-initialised
instance reloads policies and re-mounts engines without losing data.

## Issuing a short-TTL credential (example)

```bash
docker exec openbao sh -c 'export BAO_TOKEN=$(cat /var/lib/openbao/root-token); \
                          bao read database/creds/postgres-vault-bi-reader'
```

Output is a username + password + 4 h lease. Use it for the next 4 h then
let it expire — never persist it. The `vault_writer` and `landing_writer`
equivalents exist at `postgres-vault-writer` and `postgres-vault-landing-writer`.

## Policies

| Policy | For role | Path summary |
|---|---|---|
| `role-r-ops-eng` | R-OPS-ENG | read service kv, issue writer/staging DB creds |
| `role-r-ops-adm` | R-OPS-ADM | manage mounts/auth/policies, no data-plane |
| `role-r-ops-sec` | R-OPS-SEC | full audit, break-glass approve, no data-plane |
| `role-r-cons-ana` | R-CONS-ANA | issue bi-reader DB creds, read mlflow service secrets |
| `role-r-cons-sci` | R-CONS-SCI | + scratch bucket access, marts read |
| `role-r-prod-submit` | R-PROD-SUBMIT | submission-portal service secrets only |

## Re-init from scratch (loses all secrets)

```bash
docker compose down
sudo rm -rf /data/security/openbao
sudo mkdir -p /data/security/openbao
sudo chown -R 100:1000 /data/security/openbao
docker compose up -d
docker exec openbao sh /openbao/scripts/bootstrap.sh
```

## Dev posture vs production

| Aspect | Dev (this setup) | Production |
|---|---|---|
| Storage | File backend | Integrated Raft (HA) |
| Listener | TLS off | TLS on, behind reverse proxy |
| Unseal | Shamir 5/3, both keys + root token on disk | Shamir keys split across R-OPS-SEC officers; auto-unseal via cloud-KMS or transit |
| Root token | Persisted on disk for bootstrap | Revoked immediately after issuing the first admin policy |
| Audit | Deferred (declarative-only in 2.x, wired in A8) | File + Loki sink with append-only retention |
