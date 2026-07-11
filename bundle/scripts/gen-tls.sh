#!/usr/bin/env bash
# gen-tls.sh — one locally-trusted wildcard cert for *.127.0.0.1.nip.io so the
# browser stops showing the "your connection is not private" warning.
#
# The CA (bundle/tls/rootCA.pem) is generated ONCE and reused forever — you
# import it into your browser/OS trust store a single time (see the printed
# hint). The leaf cert is (re)issued each run and loaded into the k8s TLS
# secret nhdw-wildcard-tls, which every ingress references. Idempotent.
#
# Usage: bundle/scripts/gen-tls.sh [--cluster nhdw] [--namespace nhdw]
set -euo pipefail
NS="nhdw"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CERTDIR="$REPO/bundle/tls"
mkdir -p "$CERTDIR"

if [ ! -f "$CERTDIR/rootCA.pem" ]; then
  openssl genrsa -out "$CERTDIR/rootCA.key" 4096 2>/dev/null
  openssl req -x509 -new -nodes -key "$CERTDIR/rootCA.key" -sha256 -days 3650 \
    -out "$CERTDIR/rootCA.pem" -subj "/CN=NHDW Local Dev CA/O=NHDW Demo" 2>/dev/null
  echo "  ✓ created local CA — import ONCE: $CERTDIR/rootCA.pem"
fi

cat > "$CERTDIR/wild.cnf" <<'CNF'
[req]
distinguished_name = dn
[dn]
[ext]
subjectAltName = @alt
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
[alt]
DNS.1 = *.127.0.0.1.nip.io
DNS.2 = 127.0.0.1.nip.io
CNF
openssl genrsa -out "$CERTDIR/wild.key" 2048 2>/dev/null
openssl req -new -key "$CERTDIR/wild.key" -out "$CERTDIR/wild.csr" \
  -subj "/CN=*.127.0.0.1.nip.io" 2>/dev/null
openssl x509 -req -in "$CERTDIR/wild.csr" -CA "$CERTDIR/rootCA.pem" -CAkey "$CERTDIR/rootCA.key" \
  -CAcreateserial -out "$CERTDIR/wild.crt" -days 825 -sha256 \
  -extensions ext -extfile "$CERTDIR/wild.cnf" 2>/dev/null

# On a FRESH cluster this script runs BEFORE the kustomize apply that creates the
# namespace — ensure it exists so the secret create can't fail with NotFound
# (found on the 2026-07-10 cold boot: silent fallback to Traefik's default cert).
kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "$NS" create secret tls nhdw-wildcard-tls \
  --cert="$CERTDIR/wild.crt" --key="$CERTDIR/wild.key" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null
echo "  ✓ nhdw-wildcard-tls loaded — ingresses now serve the trusted wildcard cert"
echo "  → one-time browser trust: import bundle/tls/rootCA.pem into your OS/browser trusted-root store"
