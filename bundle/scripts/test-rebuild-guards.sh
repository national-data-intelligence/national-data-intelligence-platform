#!/usr/bin/env bash
# test-rebuild-guards.sh — every fix that supported tonight's rebuild must be
# PRESENT IN THE CODE, so a future full rebuild never re-hits the same wall.
#
# This exists because several of those fixes were, at some point, believed
# applied when the edit had silently no-op'd. A grep-based assertion per fix is
# cheap insurance that the repeatable path really is repeatable.
set -uo pipefail
R="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
P=0; F=0
ok(){ P=$((P+1)); echo "  ✓ $1"; }
no(){ F=$((F+1)); echo "  ✗ $1"; }
has(){ grep -q "$2" "$R/$1" && ok "$3" || no "$3 — missing in $1"; }

echo "── boot integrity"
has 3_storage/postgres/init/99_init_complete.sql "initdb_sentinel" "initdb sentinel exists (catches half-init)"
has bundle/scripts/bootstrap.sh "initdb sentinel is missing" "bootstrap waits on the sentinel, not just Ready"
has bundle/scripts/bootstrap.sh "secrets.yaml is missing keys" "bootstrap gates on secrets parity"

echo "── images"
has bundle/scripts/cache-images.sh 'tar -tf "\$tar.tmp"' "cache saves are verified before rename"
has bundle/scripts/cache-images.sh "failed to load (corrupt?)" "a corrupt tar self-heals to a remote pull"

echo "── country switch is real"
has bundle/scripts/lib-country-guard.sh "profile_matches" "shared country guard exists"
has bundle/scripts/sources-up.sh "resetting source containers" "a country switch resets host source containers"
has bundle/scripts/sources-up.sh "profile_matches" "sources-up compares the stamp"
has 1_infrastructure/ansible/roles/seed/tasks/main.yml "NHDW_PROFILE" "the seed role passes the profile down"

echo "── the specific walls this rebuild hit"
has 1_infrastructure/ansible/roles/seed/tasks/main.yml "RESOLVES from inside the cluster" "host-alias check tests resolution, not k3d internals"
has 1_infrastructure/ansible/roles/deploy/tasks/main.yml "adopt-into-helm.sh" "deploy adopts pre-existing objects before helm upgrade"
has bundle/scripts/sources-up.sh "dhis.conf is a directory" "dhis.conf directory-mount is repaired"
has bundle/scripts/sources-up.sh "sudo rm -rf" "the dhis.conf repair can escalate for a root-owned dir"
has bundle/scripts/seed-realistic.sh "PF_TRIES" "source preflight retries a cold source"
has bundle/scripts/seed-realistic.sh "JOBTMP" "job manifests use a private per-run tmp dir"

echo "── dhis.conf ships (was gitignored → docker made a directory)"
git -C "$R" ls-files --error-unmatch 0_external/sources/DHIS2/config/dhis.conf >/dev/null 2>&1 \
  && ok "the DHIS2 demo config is tracked" || no "dhis.conf is not tracked — docker will make a directory"

echo
echo "  $P passed, $F failed"
[ "$F" -eq 0 ]
