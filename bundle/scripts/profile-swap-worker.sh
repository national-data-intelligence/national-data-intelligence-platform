#!/usr/bin/env bash
# profile-swap-worker.sh — the host half of the console's Switch-profile button.
#
# The gateway applies the PRESENTATION layer itself (a pointer write) and can go
# no further: the appsec seed and the data pipeline are host operations, and the
# gateway pod holds no docker socket, no repo, no host shell — by design. What
# it DOES hold is a writable mount of /opt/nhdw-state. So the contract is a
# directory, not an API: the gateway drops swap-requests/<job>.json, this worker
# executes the SAME canonical scripts a cold boot runs, and streams stage state
# back through swap-status/<job>.json, which the gateway merges into the job it
# already reports. No new privileges anywhere; one orchestration path.
#
# Runs as a systemd service (see bundle/systemd/nhdw-profile-swap.service).
# Serial on purpose: two concurrent pipeline runs would interleave writes to
# the same warehouse.
set -uo pipefail
REPO="${NHDW_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
STATE="${NHDW_PROFILE_STATE_DIR:-/opt/nhdw-state}"
REQ="$STATE/swap-requests"; ST="$STATE/swap-status"
NS="${NHDW_NAMESPACE:-nhdw}"
mkdir -p "$REQ" "$ST"

jqget() { python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get(sys.argv[2],''))" "$1" "$2"; }

# status writes are whole-file + atomic rename: the gateway may read mid-write
write_status() { # id profile state stage_json note
  local id="$1" profile="$2" state="$3" stages="$4" note="${5:-}"
  python3 - "$ST/$id.json" "$id" "$profile" "$state" "$stages" "$note" <<'PY'
import json, sys, time, os
path, id_, profile, state, stages, note = sys.argv[1:7]
doc = {"job_id": id_, "profile": profile, "state": state,
       "stages": json.loads(stages), "note": note or None,
       "updated_at": time.time()}
tmp = path + ".tmp"
with open(tmp, "w") as f: json.dump(doc, f)
os.replace(tmp, path)
PY
}

run_stage() { # id profile stagesfile stage cmd...
  local id="$1" profile="$2" sf="$3" stage="$4"; shift 4
  python3 - "$sf" "$stage" running <<'PY'
import json,sys
d=json.load(open(sys.argv[1])); d[sys.argv[2]]={"state":sys.argv[3],"note":None}
json.dump(d,open(sys.argv[1],"w"))
PY
  write_status "$id" "$profile" running "$(cat "$sf")"
  local log="$ST/$id.$stage.log"
  if ( cd "$REPO" && "$@" ) >"$log" 2>&1; then
    python3 - "$sf" "$stage" done <<'PY'
import json,sys
d=json.load(open(sys.argv[1])); d[sys.argv[2]]={"state":"done","note":None}
json.dump(d,open(sys.argv[1],"w"))
PY
    write_status "$id" "$profile" running "$(cat "$sf")"
    return 0
  else
    local tail; tail=$(tail -3 "$log" | tr '\n' ' ' | cut -c1-280)
    python3 - "$sf" "$stage" failed "$tail" <<'PY'
import json,sys
d=json.load(open(sys.argv[1])); d[sys.argv[2]]={"state":"failed","note":sys.argv[4]}
json.dump(d,open(sys.argv[1],"w"))
PY
    write_status "$id" "$profile" failed "$(cat "$sf")" "stage $stage failed — $log"
    return 1
  fi
}

echo "profile-swap worker watching $REQ (repo: $REPO)"
while true; do
  req=$(ls "$REQ"/*.json 2>/dev/null | head -1)
  if [ -z "$req" ]; then sleep 5; continue; fi
  id=$(jqget "$req" job_id); profile=$(jqget "$req" profile); layers=$(jqget "$req" layers)
  mv "$req" "$ST/$id.request"           # claim
  echo "── swap $id → $profile (layers: $layers)"

  export NHDW_PROFILE="$profile"
  export NHDW_PROFILE_DIR="${NHDW_PROFILE_DIR:-/opt/nhdw-profiles}"
  sf="$ST/$id.stages"; echo '{}' > "$sf"

  ok=1
  case "$layers" in *appsec*)
    run_stage "$id" "$profile" "$sf" appsec \
      bash bundle/scripts/seed-app-security.sh || ok=0
    if [ "$ok" = 1 ]; then
      # the cast in Keycloak follows: same configmap + job re-run the redeploy
      # path uses, with the resolver picking the profile's users file
      # seed-app-security (above) has just rebuilt the security-seed-files
      # configmap, which globs every users*.yaml — so the resolved cast file is
      # already mounted at /seeds/security. Re-run the keycloak-seed job with its
      # NHDW_USERS_YAML repointed at that file. (A separate keycloak-users-seed
      # configmap is NOT mounted by the job and was silently ignored — that left
      # the cast on users.yaml regardless of profile.)
      run_stage "$id" "$profile" "$sf" keycloak-cast \
        bash -c 'USERS_SEED=$(bash bundle/scripts/resolve-users-seed.sh) && \
          kubectl -n '"$NS"' get job keycloak-seed -o json > /tmp/kc-live.json && \
          kubectl -n '"$NS"' delete job keycloak-seed --ignore-not-found --wait=true && \
          python3 - /tmp/kc-live.json "$USERS_SEED" <<PYX | kubectl -n '"$NS"' apply -f -
import json,sys
j=json.load(open(sys.argv[1])); seed=sys.argv[2]
for k in ("status",): j.pop(k,None)
m=j["metadata"]; [m.pop(k,None) for k in ("uid","resourceVersion","creationTimestamp","managedFields")]
j["spec"].pop("selector",None); j["spec"]["template"]["metadata"].pop("labels",None)
c=j["spec"]["template"]["spec"]["containers"][0]
env=c.setdefault("env",[])
for e in env:
    if e.get("name")=="NHDW_USERS_YAML": e["value"]="/seeds/security/"+seed; e.pop("valueFrom",None); break
else:
    env.append({"name":"NHDW_USERS_YAML","value":"/seeds/security/"+seed})
print(json.dumps(j))
PYX
          kubectl -n '"$NS"' wait --for=condition=complete job/keycloak-seed --timeout=420s' || ok=0
      [ "$ok" = 1 ] && run_stage "$id" "$profile" "$sf" gateway-restart \
        bash -c 'kubectl -n '"$NS"' rollout restart deploy/nhdw-gateway && \
                 kubectl -n '"$NS"' rollout status deploy/nhdw-gateway --timeout=300s' || ok=0
    fi ;;
  esac
  if [ "$ok" = 1 ]; then case "$layers" in *data*)
    run_stage "$id" "$profile" "$sf" sources \
      bash bundle/scripts/sources-up.sh up || ok=0
    [ "$ok" = 1 ] && run_stage "$id" "$profile" "$sf" pipeline \
      bash bundle/scripts/seed-realistic.sh || ok=0
  ;; esac; fi

  if [ "$ok" = 1 ]; then
    write_status "$id" "$profile" succeeded "$(cat "$sf")" "all requested layers applied"
    echo "── swap $id done"
  else
    echo "── swap $id FAILED (see $ST/$id.*.log)"
  fi
done
