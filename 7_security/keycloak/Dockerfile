# NHDW Keycloak — stock upstream + the custom "nhdw" login theme baked in.
# We run `start-dev`, which reads themes live from /opt/keycloak/themes, so no
# `kc.sh build` step is needed. Theming (not forking Keycloak) is the supported,
# upgrade-safe way to brand the hosted login page while keeping PKCE/SSO/social/
# MFA/lockout intact — see docs/security-and-identity.md.
FROM quay.io/keycloak/keycloak:26.0.7

COPY themes/nhdw /opt/keycloak/themes/nhdw
