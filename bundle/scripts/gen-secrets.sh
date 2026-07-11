#!/usr/bin/env bash
# gen-secrets.sh — render overlays/dev/secrets.yaml from the committed
# secrets.yaml.template with FRESH random values per deploy.
#
# Safety: NEVER clobbers an existing secrets.yaml — that would rotate a live
# cluster's passwords out from under its already-initialised databases. Pass
# --force to regenerate (real third-party creds are preserved from the old file
# or taken from env; only the random-hex values change).
#
# Token substitution (see secrets.yaml.template header):
#   __G_*__       → one random hex per UNIQUE token (cross-refs reuse the value,
#                   so a shared credential can never drift); __G_FERNET__ is a
#                   valid urlsafe-base64 Fernet key.
#   __REAL:N|d__  → env $N, else the value already in secrets.yaml, else default d.
#
# Real creds you can inject at gen time (else placeholders / preserved):
#   GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET SMTP_USER SMTP_PASS SMTP_FROM
#   SEED_PASSWORD  ETHIOEMR_READER_PASSWORD HCMISWDM_READER_PASSWORD MBRANA_READER_PASSWORD
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OVERLAY="$REPO/1_infrastructure/k8s/overlays/dev"
TEMPLATE="$OVERLAY/secrets.yaml.template"
OUT="${SECRETS_OUT:-$OVERLAY/secrets.yaml}"
FORCE=0
for a in "$@"; do [ "$a" = "--force" ] && FORCE=1; done

[ -f "$TEMPLATE" ] || { echo "gen-secrets: template not found: $TEMPLATE" >&2; exit 1; }
if [ -f "$OUT" ] && [ "$FORCE" != 1 ]; then
  echo "gen-secrets: $OUT already exists — leaving it untouched (use --force to regenerate)."
  exit 0
fi

python3 - "$TEMPLATE" "$OUT" <<'PY'
import os, re, sys, secrets, base64
template_path, out_path = sys.argv[1], sys.argv[2]
tpl = open(template_path).read()
existing = open(out_path).read() if os.path.exists(out_path) else ""

# __G_*__ generated tokens — one value per unique token (cross-refs reuse it).
cache = {}
def gen(tok):
    if tok not in cache:
        # __G_FERNET__ needs a VALID base64-encoded 32-byte key; everything else
        # is a plain random hex token. (The oauth2-proxy cookie key was the other
        # base64 case — oauth2-proxy retired 2026-07-11, #80.)
        if tok in ("__G_FERNET__",):
            cache[tok] = base64.urlsafe_b64encode(os.urandom(32)).decode()
        elif tok in ("__G_JUPYTERHUB_CRYPT__",):
            # JupyterHub auth_state encryption requires EXACTLY 32 bytes; emit it
            # as 64 hex chars (token_hex(20) = 20 bytes was rejected at startup).
            cache[tok] = secrets.token_hex(32)
        else:
            cache[tok] = secrets.token_hex(20)
    return cache[tok]
tpl = re.sub(r"__G_[A-Z0-9_]+?__", lambda m: gen(m.group(0)), tpl)

# __REAL:NAME|default__ → env NAME, else the value already in secrets.yaml, else default.
def real(m):
    name, default = m.group(1), m.group(2)
    if os.environ.get(name):
        return os.environ[name]
    em = re.search(r'^\s*' + re.escape(name) + r':\s*"(.*)"\s*$', existing, re.M)
    return em.group(1) if em else default
tpl = re.sub(r"__REAL:([A-Z0-9_]+)\|(.*?)__", real, tpl)

leftover = re.findall(r"__[A-Z0-9_:|<>@. ]+?__", tpl)
if leftover:
    sys.stderr.write("gen-secrets: unsubstituted tokens: %s\n" % set(leftover)); sys.exit(2)
open(out_path, "w").write(tpl)
PY
echo "✓ gen-secrets: wrote $OUT (per-deploy random values; real creds from env/preserved)."
