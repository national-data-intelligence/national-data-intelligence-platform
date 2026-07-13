"""Structural + live derivation for GET /api/topology/graph.

APPS-ONLY. Nodes are the deployed **application** workloads in the namespace —
Deployments + StatefulSets. Jobs/CronJobs (ingestors, dbt, bridge-sync,
ml-runner), DB tables/schemas, MinIO buckets, external SOURCE systems and every
data-lineage / ETL edge are deliberately EXCLUDED (that story belongs to
dbt-docs + the data-lineage page, not here). Storage apps (postgres-vault,
minio-datalake, clickhouse) DO appear — we just never show their internal
tables/buckets or the ETL between them.

One EPHEMERAL exception to "declared workloads only": JupyterHub singleuser lab
pods (KubeSpawner, label app=jupyterhub + component=singleuser-server) ARE
surfaced — one dynamically-spawned compute node per running lab, marked
``ephemeral=True`` (observed, not manifest-declared) with a hub→lab ``spawns``
edge — so an operator watches labs come and go live. Every other node carries
``ephemeral=False``.

Edges are the DECLARED wiring, auto-derived on every call from each workload's
own container spec:

  * plain ``value:`` env DNS refs (secretKeyRef hosts are invisible by design —
    the manifest contract keeps every host a plain value and every password a
    secretKeyRef),
  * ``command`` / ``args`` (e.g. keycloak's wait-for-db psql, oauth2-proxy's
    redeem/jwks URLs), with ``$(VAR)`` / ``${VAR}`` interpolation resolved
    against the workload's own plain env,
  * referenced ConfigMap connection strings (e.g. the trino-catalog
    ``connection-url=jdbc:postgresql://postgres-vault:5432/...``).

Host tokens are matched against a lookup of every Service's
{short-name, ``<svc>.nhdw`` , ``<svc>.nhdw.svc`` , ``<svc>.nhdw.svc.cluster.local``}
form → the workload that Service selects. Edge ``kind`` (http|db|s3|smtp|native|
oidc) is inferred from the target service + a small port→protocol map.

Two honoured EXTERNAL exceptions are synthesized (neither is a deployed k8s
workload, but each is a real declared connection to a 0_external/ system reached
via the k3d host route):
  * fayda-replica — public-dashboard's
    ``FAYDA_INTERNAL_BASE=http://host.k3d.internal:8096`` auth connection;
  * nhdw-ollama — the gateway's ``OLLAMA_URL=http://host.k3d.internal:11434`` LLM
    connection (the assistant model runtime moved out of k8s to 0_external/llm/
    on 2026-07-06 — on WSL2 the GPU only works in an external container).
All *other* ``host.k3d.internal`` refs live only inside the excluded ingestor
Jobs, so they never surface here.

The live k8s scan (same LIST the /orchestration layer uses) reconciles every
node: declared × observed, health from ready-replica counts, phantom when a
workload is declared but has no running pod. Traffic is layered on top by the
provider registry in ``traffic_providers.py`` — this module never touches the
audit DB.
"""
from __future__ import annotations

import logging
import re
from typing import Any

import httpx

log = logging.getLogger("gateway.topology.graph")


# ─── the TWO id helpers everything shares ─────────────────────────────
# Centralised so the structural derivation here AND every traffic provider
# mint byte-identical ids — a mismatch would silently drop traffic on the floor.
def node_id(workload_name: str) -> str:
    return workload_name


def edge_id(src: str, dst: str) -> str:
    return f"{node_id(src)}->{node_id(dst)}"


# ─── node kind, keyed off the workload's own `tier:` label ────────────
KIND_BY_TIER: dict[str, str] = {
    "api":          "api",
    "storage":      "datastore",
    "security":     "security",
    "tool-sso":     "security",   # the tool-gate OIDC reverse proxies (#80)
    "bi":           "ui",         # Superset — self-service SQL/BI (#81)
    "ml":           "ml",
    "dashboard":    "ui",
    "orchestrator": "orchestrator",
    "platform":     "platform",
    "ops":          "ops",
    "compute":      "engine",
    "external":     "external",
}


# ─── edge kind inference ──────────────────────────────────────────────
# Storage/auth targets carry a fixed protocol regardless of the port the caller
# used (minio & clickhouse both surface on :9000 — port alone can't tell them
# apart, so the target node disambiguates). Everything else falls back to a
# small port→protocol map, then to plain http.
SPECIAL_TARGET_KIND: dict[str, str] = {
    "keycloak":       "oidc",
    "minio-datalake": "s3",
    "clickhouse":     "native",
    "postgres-vault": "db",
    "fayda-replica":  "oidc",
    "kubernetes-api": "k8s",
}


# ─── per-node subtitle (a one-line "what is this" for the map + detail) ─────
# The owner didn't recognise the API/data gateway on the map, so every node
# carries an optional human subtitle the renderer shows beneath the name (and
# the detail panel echoes). Keyed off the workload's `tier:` label; a couple of
# individually-notable workloads get a name-specific line.
SUBTITLE_BY_TIER: dict[str, str] = {
    "api": "API · data gateway",
    "tool-sso": "SSO gate · role-aware proxy",
    "bi": "self-service SQL/BI",
}
SUBTITLE_BY_NAME: dict[str, str] = {
    "nhdw-gateway":   "API · data gateway",
    "kubernetes-api": "control plane",
}


def node_subtitle(name: str, tier: str) -> str | None:
    return SUBTITLE_BY_NAME.get(name) or SUBTITLE_BY_TIER.get(tier)


# ─── placement zone (which architecture band a node sits in) ──────────
# The admin renderer draws the zone RECTANGLES + titles; the SEMANTIC zone each
# node belongs to is decided HERE so the two stay in lockstep. The API/data
# gateway sits in its OWN "apis" band (owner request #83) — no longer lumped in
# with the access endpoints. tier→zone, with a few per-node overrides (an access
# endpoint that isn't a security service, the ops console, the synthesized
# control plane, the external providers). The renderer keeps an identical
# fallback so an older graph payload (no `zone`) still lays out the same.
_TIER_ZONE: dict[str, str] = {
    "dashboard": "access", "api": "apis",
    "storage": "storage",
    "compute": "compute", "engine": "compute", "ml": "compute", "serving": "compute",
    "orchestrator": "compute", "platform": "compute",
    "security": "security", "external": "security",
    "tool-sso": "security",   # the tool-gate OIDC reverse proxies sit with auth (#80)
    "bi": "access",           # Superset sits with the access endpoints (#81)
    "ops": "observability", "observability": "observability",
}
_NODE_ZONE: dict[str, str] = {
    "headlamp": "observability",
    "kubernetes-api": "observability",
    "fayda-replica": "security",
    "nhdw-ollama": "compute",
}


def zone_for(name: str, tier: str) -> str:
    return _NODE_ZONE.get(name) or _TIER_ZONE.get(tier) or "compute"
PORT_KIND: dict[int, str] = {
    5432: "db",
    8025: "http",
    80:   "http",
    8000: "http",
    8080: "http",
    8181: "http",
    5000: "http",
    11434: "http",
    4180: "http",
    3100: "http",
    9000: "native",   # clickhouse native TCP (minio :9000 is special-cased s3)
    8123: "native",   # clickhouse http
    9001: "http",     # minio console
    8096: "oidc",     # fayda replica auth
}


def edge_kind(target: str, port: int | None) -> str:
    if target in SPECIAL_TARGET_KIND:
        return SPECIAL_TARGET_KIND[target]
    if port is not None and port in PORT_KIND:
        return PORT_KIND[port]
    return "http"


# fayda-replica: external eSignet-style auth, reached via the k3d host route.
_FAYDA_HOST = "host.k3d.internal"
_FAYDA_PORT = 8096
_FAYDA_NODE = "fayda-replica"

# nhdw-ollama: the external LLM (0_external/llm/) the gateway calls for the dashboard
# assistant, reached via the same k3d host route (OLLAMA_URL=host.k3d.internal:11434).
_LLM_HOST = "host.k3d.internal"
_LLM_PORT = 11434
_LLM_NODE = "nhdw-ollama"

_VAR_RE = re.compile(r"\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?")


# ─── low-level k8s GET ────────────────────────────────────────────────
async def _get(client: httpx.AsyncClient, api: str, path: str) -> dict[str, Any]:
    r = await client.get(f"{api}{path}")
    r.raise_for_status()
    return r.json()


def _interpolate(value: str, env: dict[str, str]) -> str:
    """Resolve $(VAR) / ${VAR} / $VAR against the workload's own plain env so a
    host hidden behind an env reference (airflow's SQL_ALCHEMY_CONN pattern)
    still resolves. `$(VAR)` is k8s syntax; regex handles ${VAR}/$VAR, and we
    pre-swap the `$(...)` form to `${...}` first."""
    value = value.replace("$(", "${").replace(")", "}") if "$(" in value else value
    return _VAR_RE.sub(lambda m: env.get(m.group(1), m.group(0)), value)


def _scan_texts(spec: dict[str, Any],
                configmaps: dict[str, dict[str, str]]) -> list[str]:
    """Every host-bearing string a workload declares: plain env values,
    command, args (across init + main containers), and the string values of
    every ConfigMap it references (connection strings). secretKeyRef env is
    skipped — it carries no host."""
    pod = (((spec.get("spec") or {}).get("template") or {}).get("spec")) or {}
    containers = (pod.get("initContainers") or []) + (pod.get("containers") or [])

    # workload-wide plain env map for $(VAR) resolution
    env_map: dict[str, str] = {}
    for c in containers:
        for e in c.get("env") or []:
            if "value" in e and e.get("name"):
                env_map[e["name"]] = str(e["value"])

    texts: list[str] = []
    for c in containers:
        for e in c.get("env") or []:
            if "value" in e:
                texts.append(_interpolate(str(e["value"]), env_map))
        for key in ("command", "args"):
            for part in c.get(key) or []:
                texts.append(_interpolate(str(part), env_map))

    # ConfigMaps referenced via volumes[].configMap or envFrom[].configMapRef
    cm_names: set[str] = set()
    for v in pod.get("volumes") or []:
        cm = (v.get("configMap") or {}).get("name")
        if cm:
            cm_names.add(cm)
    for c in containers:
        for ef in c.get("envFrom") or []:
            cm = (ef.get("configMapRef") or {}).get("name")
            if cm:
                cm_names.add(cm)
    for cm in cm_names:
        for val in (configmaps.get(cm) or {}).values():
            texts.append(str(val))

    return texts


def _labels_match(pod_labels: dict[str, str], selector: dict[str, str]) -> bool:
    return bool(selector) and all(pod_labels.get(k) == v for k, v in selector.items())


def _host_matches(text: str, short: str) -> list[int | None]:
    """Return the ports at which `short` (a service short-name) is referenced as
    a real host in `text` — matched as the short name alone or any
    <short>.nhdw[.svc[.cluster.local]] form, with an optional :port. Empty list
    ⇒ not referenced; a None entry ⇒ referenced without an explicit port.

    A match only counts as a real host reference if it carries a connection
    SIGNAL: an explicit ``:port``, the ``.nhdw`` FQDN suffix, or a ``//`` / ``@``
    (URL scheme / userinfo) immediately before it. Bare occurrences of a
    service-name-shaped token — an OIDC clientId ``admin`` in a realm export, a
    schema/role name ``keycloak`` in a mounted DDL bundle, a word in a comment —
    are NOT connections and are ignored. Every genuine wiring ref in this repo
    carries at least one of those signals, so this keeps every real edge while
    dropping the ConfigMap-scan noise."""
    pat = re.compile(
        r"(?<![\w.-])" + re.escape(short) +
        r"(?P<fqdn>\.nhdw(?:\.svc(?:\.cluster\.local)?)?)?"
        r"(?::(?P<port>\d+))?"
        r"(?![\w-])"
    )
    ports: list[int | None] = []
    for m in pat.finditer(text):
        port = int(m.group("port")) if m.group("port") else None
        pre2 = text[max(0, m.start() - 2):m.start()]
        signal = (port is not None
                  or m.group("fqdn") is not None
                  or pre2.endswith("//") or pre2.endswith("@"))
        if signal:
            ports.append(port)
    return ports


async def derive_graph(*, api: str, token: str, ca: str | bool,
                       ns: str) -> dict[str, Any]:
    """Build the apps-only {nodes, edges} graph from live k8s. Traffic + as_of +
    meta are attached by the caller. Raises on an unreachable API."""
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=8, verify=ca, headers=headers) as c:
        deploys = (await _get(c, api, f"/apis/apps/v1/namespaces/{ns}/deployments")).get("items", [])
        stses   = (await _get(c, api, f"/apis/apps/v1/namespaces/{ns}/statefulsets")).get("items", [])
        pods    = (await _get(c, api, f"/api/v1/namespaces/{ns}/pods")).get("items", [])
        svcs    = (await _get(c, api, f"/api/v1/namespaces/{ns}/services")).get("items", [])

        workloads = [("Deployment", d) for d in deploys] + \
                    [("StatefulSet", s) for s in stses]

        # ConfigMaps referenced by any workload → fetch once, for the scan.
        wanted_cms: set[str] = set()
        for _, w in workloads:
            pod = (((w.get("spec") or {}).get("template") or {}).get("spec")) or {}
            for v in pod.get("volumes") or []:
                cm = (v.get("configMap") or {}).get("name")
                if cm:
                    wanted_cms.add(cm)
            for cont in (pod.get("initContainers") or []) + (pod.get("containers") or []):
                for ef in cont.get("envFrom") or []:
                    cm = (ef.get("configMapRef") or {}).get("name")
                    if cm:
                        wanted_cms.add(cm)
        configmaps: dict[str, dict[str, str]] = {}
        for name in wanted_cms:
            try:
                cm = await _get(c, api, f"/api/v1/namespaces/{ns}/configmaps/{name}")
                configmaps[name] = cm.get("data") or {}
            except Exception as exc:
                log.debug("configmap %s not readable: %s", name, exc)

    # ── nodes + live reconciliation ────────────────────────────────────
    nodes: dict[str, dict[str, Any]] = {}
    wl_meta: dict[str, dict[str, Any]] = {}   # node_id → {selector, spec, tmpl_labels}

    for kind_k8s, w in workloads:
        md = w.get("metadata") or {}
        name = md.get("name")
        if not name:
            continue
        nid = node_id(name)
        spec = w.get("spec") or {}
        tmpl_labels = (((spec.get("template") or {}).get("metadata") or {}).get("labels")) or {}
        tier = (md.get("labels") or {}).get("tier") or tmpl_labels.get("tier") or "unknown"
        selector = (spec.get("selector") or {}).get("matchLabels") or {}

        # live health from pods matching this workload's selector
        wl_pods = [p for p in pods
                   if _labels_match((p.get("metadata") or {}).get("labels") or {}, selector)]
        desired = spec.get("replicas")
        desired = 1 if desired is None else int(desired)
        ready = int((w.get("status") or {}).get("readyReplicas") or 0)
        crashloop = any(
            (cs.get("state") or {}).get("waiting", {}).get("reason") == "CrashLoopBackOff"
            for p in wl_pods
            for cs in (p.get("status") or {}).get("containerStatuses") or []
        )
        observed = len(wl_pods) >= 1
        # v2 signals (#55): restart pressure + OOM kills from the SAME pod scan —
        # real per-node distress signals, zero extra API calls.
        restarts = sum(int(cs.get("restartCount") or 0)
                       for p in wl_pods
                       for cs in (p.get("status") or {}).get("containerStatuses") or [])
        oom_killed = any(
            (((cs.get("lastState") or {}).get("terminated") or {}).get("reason")) == "OOMKilled"
            for p in wl_pods
            for cs in (p.get("status") or {}).get("containerStatuses") or []
        )
        if crashloop:
            health = "down"
        elif desired == 0:
            health = "unknown"
        elif ready >= desired and ready > 0:
            health = "up"
        elif 0 < ready < desired:
            health = "degraded"
        elif ready == 0:
            health = "down"
        else:
            health = "unknown"

        nodes[nid] = {
            "id": nid,
            "label": name,
            "subtitle": node_subtitle(name, tier),
            "tier": tier,
            "zone": zone_for(name, tier),
            "kind": KIND_BY_TIER.get(tier, "service"),
            "declared": True,
            "observed": observed,
            "ephemeral": False,          # a declared workload, not a spawned pod
            "health": health,
            "phantom": (not observed),   # declared here, no live pod
            "k8s": {"deployment": name, "ready": f"{ready}/{desired}", "namespace": ns},
            # v2 distress signals (#55). errLogs15m is merged in by the graph
            # route from Loki (fail-soft) — absent when Loki is unreachable.
            "signals": {"restarts": restarts, "oomKilled": oom_killed},
        }
        wl_meta[nid] = {"selector": selector, "spec": w, "tmpl_labels": tmpl_labels}

    # ── service host-alias → owning node lookup ────────────────────────
    # short-name → node_id (the workload the Service selects). The regex in
    # _host_matches already accepts every FQDN form off the short-name.
    alias_to_node: dict[str, str] = {}
    alias_default_port: dict[str, int | None] = {}
    for s in svcs:
        smd = s.get("metadata") or {}
        sname = smd.get("name")
        sel = (s.get("spec") or {}).get("selector") or {}
        if not sname or not sel:
            continue
        owner = None
        for nid, meta in wl_meta.items():
            if _labels_match(meta["tmpl_labels"], sel):
                owner = nid
                break
        if owner is None:
            continue
        ports = (s.get("spec") or {}).get("ports") or []
        alias_to_node[sname] = owner
        alias_default_port[sname] = int(ports[0]["port"]) if ports else None

    # ── edges from the declared wiring of every workload ───────────────
    edges: dict[str, dict[str, Any]] = {}

    def _add_edge(src: str, dst: str, port: int | None) -> None:
        if src == dst:
            return
        eid = edge_id(src, dst)
        if eid in edges:
            return
        s_node, d_node = nodes.get(src), nodes.get(dst)
        s_h = s_node["health"] if s_node else "unknown"
        d_h = d_node["health"] if d_node else "unknown"
        if "down" in (s_h, d_h):
            status = "down"
        elif "degraded" in (s_h, d_h):
            status = "degraded"
        elif s_h == "up" and d_h == "up":
            status = "up"
        else:
            status = "unknown"
        edges[eid] = {
            "id": eid, "source": src, "target": dst,
            "kind": edge_kind(dst, port),
            "declared": True,
            "observed": bool(s_node and s_node["observed"] and d_node and d_node["observed"]),
            "status": status,
            "traffic": None,
        }

    for nid, meta in wl_meta.items():
        texts = _scan_texts(meta["spec"], configmaps)
        blob = "\n".join(texts)
        # in-cluster service refs
        for alias, target in alias_to_node.items():
            if target == nid:
                continue
            found_ports = _host_matches(blob, alias)
            if not found_ports:
                continue
            port = next((p for p in found_ports if p is not None), None)
            if port is None:
                port = alias_default_port.get(alias)
            _add_edge(nid, target, port)
        # External off-cluster dependencies (fayda-replica identity replica,
        # nhdw-ollama LLM — both reached via host.k3d.internal) are DELIBERATELY
        # NOT surfaced as topology nodes: the topology represents the Kubernetes
        # cluster, and a node for something that isn't a k8s workload reads as a
        # phantom (owner directive 2026-07-13 — "should not have a node for the
        # ollama if it's not in the Kubernetes cluster"). No edge is drawn to them.

    # (external nhdw-ollama / fayda-replica node synthesis REMOVED 2026-07-13 —
    #  the graph is a pure in-cluster view; external deps are not nodes.)

    # (SMTP → Mailpit edge RETIRED 2026-07-06 — app email now goes to an
    # EXTERNAL Google SMTP relay, like fayda/ollama; there's no in-cluster mail
    # sink node to draw an edge to.)

    # k8s control plane. The `kubernetes` Service lives in the `default`
    # namespace (outside our nhdw-scoped scan), so the API server never appears
    # as a scanned node and its in-cluster clients looked islanded. Synthesize a
    # `kubernetes-api` node and wire the two workloads that actually call it:
    # headlamp (the ops console — its ONLY peer is the API, so this de-islands it)
    # and nhdw-gateway (the /api/topology + /scale calls this module itself uses).
    k8s_clients = [c for c in ("headlamp", "nhdw-gateway") if c in nodes]
    if k8s_clients:
        nodes["kubernetes-api"] = {
            "id": "kubernetes-api",
            "label": "kubernetes-api",
            "subtitle": node_subtitle("kubernetes-api", "platform"),
            "tier": "platform",
            "zone": zone_for("kubernetes-api", "platform"),
            "kind": "platform",
            "declared": True,
            "observed": True,          # the gateway just reached it to build this graph
            "ephemeral": False,
            "health": "up",
            "phantom": False,
            "k8s": None,
        }
        for client in k8s_clients:
            _add_edge(client, "kubernetes-api", 443)

    # ── dynamically-spawned JupyterHub singleuser lab pods ────────────────
    # KubeSpawner launches one lab pod per user (labels app=jupyterhub +
    # component=singleuser-server + hub.jupyter.org/username=<user>). These are
    # NOT declared workloads (no Deployment/StatefulSet), so the scan above never
    # sees them — surface each as an EPHEMERAL compute node so the operator can
    # watch labs spin up and down live. The hub Deployment (component=hub) is
    # what spawns them, so draw a hub→lab "spawns" edge. Ephemeral ≠ phantom: it's
    # observed and running, just not manifest-declared.
    for p in pods:
        pmd = p.get("metadata") or {}
        plabels = pmd.get("labels") or {}
        if plabels.get("app") != "jupyterhub" or plabels.get("component") != "singleuser-server":
            continue
        pname = pmd.get("name")
        if not pname or pname in nodes:
            continue
        pst = p.get("status") or {}
        phase = pst.get("phase") or "Unknown"
        cs_list = pst.get("containerStatuses") or []
        ready = bool(cs_list) and all(cs.get("ready") for cs in cs_list)
        if phase == "Running":
            health = "up" if ready else "degraded"
        elif phase == "Pending":
            health = "degraded"
        elif phase == "Failed":
            health = "down"
        else:
            health = "unknown"
        user = plabels.get("hub.jupyter.org/username") or pname
        nodes[pname] = {
            "id": pname,
            "label": pname,
            "subtitle": f"spawned lab · {user}",
            "tier": "compute",
            "zone": zone_for(pname, "compute"),   # → compute band
            "kind": "notebook",
            "declared": False,        # spawned on demand, not a manifest workload
            "observed": True,
            "ephemeral": True,        # dynamically spawned — rendered distinctly
            "health": health,
            "phantom": False,
            "k8s": {"deployment": pname, "ready": "1/1" if ready else "0/1",
                    "namespace": ns, "pod": pname},
        }
        if "jupyterhub" in nodes:
            eid = edge_id("jupyterhub", pname)
            if eid not in edges:
                edges[eid] = {
                    "id": eid, "source": "jupyterhub", "target": pname,
                    "kind": "spawns", "declared": False, "observed": True,
                    "status": "up" if health == "up" else "degraded",
                    "traffic": None,
                }

    return {"nodes": list(nodes.values()), "edges": list(edges.values())}
