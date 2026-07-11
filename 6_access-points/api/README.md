# NHDW FHIR API + OpenHIM (Phase-1 stub)

## What this folder is

The interoperability tier that producers and consumers will use to read /
write structured health data once Phase 4 lands. In Phase 1 it is a *stub*
— each service starts and is addressable on `127.0.0.1`, but neither is
wired to authentication, persistence, or routing yet.

## Components

| Service       | Container          | Port (127.0.0.1) | Phase 1 state                         |
|---------------|--------------------|-----------------:|---------------------------------------|
| HAPI FHIR R4  | `nhdw-fhir-server` | 8093             | H2 in-memory; default config          |
| OpenHIM Core  | `nhdw-openhim-core`| 8094, 5001, 7788 | Mongo-backed; default-only creds      |
| OpenHIM Mongo | `nhdw-openhim-mongo`| —               | Embedded; volume `mongo_data`         |

## Why it's a stub now

1. **No real auth.** SMART-on-FHIR (resource server + Keycloak as auth
   server + scopes) is Phase-4 work. Until then, anyone on the host loopback
   can hit these endpoints. **Do not expose off `127.0.0.1`.**
2. **No persistence on the FHIR server.** H2 in-memory means every restart
   blanks the resource server. That's intentional for Phase 1 — we are
   wiring the *interface*, not standing up the system of record yet.
3. **Default OpenHIM credentials.** The container ships with a default
   bootstrap account; Phase-4 setup rotates it and creates per-channel
   client certs.

## Phase-4 graduation

- HAPI FHIR → backend store on `postgres-vault` (`fhir_resources` schema),
  SMART-on-FHIR enabled, validated against client `fhir-api` in the
  `moh-staff` realm.
- OpenHIM Core → Console enabled at `:8095`, channels wired for HMIS,
  EPI, and Stock submissions, audit trail also forwarded to Loki.
- Both services move behind oauth2-proxy or use SMART's native introspection
  endpoint against Keycloak.

## How to bring it up locally

```
cd 6_access-points/api/fhir-server && docker compose up -d
cd 6_access-points/api/openhim     && docker compose up -d

curl http://127.0.0.1:8093/fhir/metadata    # FHIR capability statement
curl http://127.0.0.1:8094/heartbeat        # OpenHIM Core healthcheck
```
