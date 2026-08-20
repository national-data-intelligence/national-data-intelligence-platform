"""/api/chat — dashboard assistant, progressive tool-call protocol.

Two endpoints, both stateless from the SPA's perspective. Sessions live
in process memory (TTL 5 minutes, max 6 tool rounds) — no DB.

  POST /api/chat/start
    body: { dashboard_id, page_id?, question, history?: [...] }
    returns: { session_id, ...next_step }

  POST /api/chat/continue
    body: { session_id, tool_result: { ok, result? | error? } }
    returns: { ...next_step }

Where `next_step` is one of:
  { kind: "tool_call",  tool: { name, args }, executor: "spa" | "gateway" }
  { kind: "answer",     answer: str, tool_calls: [...] }

The gateway:
  - loads the dashboard's chat config (system prompt + intents +
    tool catalogue) from <dashboard_dir>/chat/ on disk
  - computes the user's tool catalogue: the user holds the
    assistant:<tool_group> capability (assistant:read/run_sql/interact)
    AND any tool.requires.widget is in user's role_widget grants on the dashboard
  - drives an Ollama tool-calling loop:
      → tool call → SPA-side (return to client) OR gateway-side
        (gateway executes /api/sql/execute internally, feeds back)
      → loop until model returns plain text
  - audit-logs every turn through ops_db.log_gateway_query
"""
from __future__ import annotations

import json
import logging
import os
import re
import secrets
import time
from pathlib import Path
from typing import Any

import httpx
import yaml
from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field

from ..auth import UserCtx, get_user
from .. import ops_db, opa, permissions

log = logging.getLogger("gateway.chat")
router = APIRouter(prefix="/api/chat", tags=["chat"])

# The LLM is an EXTERNAL component (0_external/llm/) reached via the k3d host route;
# the manifest sets OLLAMA_URL=http://host.k3d.internal:11434. This code default
# matches so a bare `python -m app` outside k8s still points at a host-local ollama.
OLLAMA_URL  = os.environ.get("OLLAMA_URL", "http://host.k3d.internal:11434").rstrip("/")
# The LLM is an EXTERNAL, GPU-backed ollama on the host (moved out of the cluster
# precisely so it gets the host GPU). The agentic assistant REQUIRES qwen2.5:14b —
# the small 3b model cannot reliably chain multi-step tool calls (nav + read_widget
# + answer), which is why it fumbled simple asks. 14b (~25 tok/s on the RTX-5080)
# is the model; there is no in-cluster CPU path to fall back to any more.
MODEL       = os.environ.get("NHDW_LLM_MODEL", "qwen2.5:14b")
NUM_CTX     = int(os.environ.get("NHDW_LLM_NUM_CTX", "8192"))
KEEP_ALIVE  = os.environ.get("NHDW_LLM_KEEP_ALIVE", "30m")
MAX_HISTORY = int(os.environ.get("NHDW_CHAT_MAX_HISTORY", "8"))
MAX_ROUNDS  = int(os.environ.get("NHDW_CHAT_MAX_ROUNDS", "8"))
# 180s (not 60): the external ollama may be COLD on the first request after an
# idle period — loading a 14B model into VRAM before it can generate can exceed
# 60s, which otherwise surfaces to the SPA as a misleading "model unreachable".
LLM_TIMEOUT = float(os.environ.get("NHDW_CHAT_HTTP_TIMEOUT_S", "180"))
SESSION_TTL_S = 300

# Per-dashboard chat config lives next to this endpoint (the gateway is
# the consumer — file-proximity rule). `chat_configs/<dashboard_id>/`
# holds {system-prompt.md, intents.yaml, tool-catalogue.yaml}.
CHAT_CONFIGS_DIR = Path(__file__).parent / "chat_configs"


# ─── in-memory session store ──────────────────────────────────────────
class _Session:
    __slots__ = ("user_kc_sub", "dashboard_id", "page_id", "messages",
                 "tool_catalogue", "tool_calls", "rounds", "created_at",
                 "seen_calls", "sql_net_fired")

    def __init__(self, user_kc_sub: str, dashboard_id: str, page_id: str | None,
                 messages: list, tool_catalogue: list, created_at: float) -> None:
        self.user_kc_sub    = user_kc_sub
        self.dashboard_id   = dashboard_id
        self.page_id        = page_id
        self.messages       = messages
        self.tool_catalogue = tool_catalogue
        self.tool_calls: list[dict] = []
        self.rounds         = 0
        self.created_at     = created_at
        # signatures (name+args) of tool calls already issued this session — the
        # idempotency guard uses these to short-circuit a repeated identical call.
        self.seen_calls: set[str] = set()
        # the deterministic SQL-editor safety net fires at most once per turn
        self.sql_net_fired  = False


_sessions: dict[str, _Session] = {}


def _prune_sessions() -> None:
    now = time.time()
    expired = [sid for sid, s in _sessions.items()
               if now - s.created_at > SESSION_TTL_S]
    for sid in expired:
        _sessions.pop(sid, None)


# ─── config loading ───────────────────────────────────────────────────
_config_cache: dict[str, dict[str, Any]] = {}


def _load_dashboard_chat_config(dashboard_id: str) -> dict[str, Any]:
    if dashboard_id in _config_cache:
        return _config_cache[dashboard_id]
    root = CHAT_CONFIGS_DIR / dashboard_id
    if not root.exists():
        raise HTTPException(404, f"no chat config for dashboard {dashboard_id!r}")
    cfg: dict[str, Any] = {"dashboard_id": dashboard_id}
    sp = root / "system-prompt.md"
    if sp.exists():
        cfg["system_prompt"] = sp.read_text(encoding="utf-8")
    else:
        cfg["system_prompt"] = "You are the dashboard assistant. Answer in 1-3 sentences."
    intents = root / "intents.yaml"
    if intents.exists():
        cfg["intents"] = yaml.safe_load(intents.read_text(encoding="utf-8")) or {}
    else:
        cfg["intents"] = {}
    catalogue = root / "tool-catalogue.yaml"
    if catalogue.exists():
        cfg["tool_catalogue"] = (yaml.safe_load(catalogue.read_text(encoding="utf-8")) or {}).get("tools", [])
    else:
        cfg["tool_catalogue"] = []
    _config_cache[dashboard_id] = cfg
    return cfg


# ─── tool catalogue computation per request ───────────────────────────
async def _compute_user_tools(dashboard_id: str, user: UserCtx,
                                catalogue: list[dict]) -> tuple[list[dict], list[str]]:
    """Filter the catalogue to the tools the user is allowed to invoke.

    A tool is exposed only if:
      - the user holds the `assistant:<tool_group>` capability
        (assistant:read / assistant:run_sql / assistant:interact)
      - every requires.widget is in user's role_widget grants on this dashboard
      - every requires.capability is in user's role_capability grants

    The assistant tool-gate lives on the role_capability axis (seeded from the
    `capabilities:` block in roles.yaml). This is the Phase-1 re-home of the
    tool groups that previously lived in ops_perm.role_widget_filter
    (widget_id='bi-assistant', filter_id='chatbot-tools'): a role with none of
    the assistant:* capabilities exposes no tools, so the assistant 403s for it —
    exactly as an absent/empty chatbot-tools row did before. role_widget_filter
    still exists (Phase-2 drops it) but chat.py no longer reads it.
    """
    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        role_ids = await permissions._resolve_role_ids(conn, user)
        if not role_ids:
            return [], []
        # 1. user's capabilities — the assistant:<group> tool-gate + requires.capability
        caps = set(await permissions._role_capabilities(conn, role_ids))
        # 2. user's widget grants on this dashboard (for requires.widget checks)
        wrows = await conn.fetch("""
            SELECT widget_id FROM ops_perm.role_widget
             WHERE dashboard_id = $1 AND role_id = ANY($2::int[])
        """, dashboard_id, role_ids)
        user_widgets = {r["widget_id"] for r in wrows}

    exposed: list[dict] = []
    rejected_reasons: list[str] = []
    for t in catalogue:
        group = t.get("tool_group")
        needed_cap = f"assistant:{group}" if group else None
        if needed_cap is None or needed_cap not in caps:
            rejected_reasons.append(
                f"{t['id']}: missing assistant capability {needed_cap!r}")
            continue
        req = t.get("requires") or {}
        req_widget = req.get("widget")
        if req_widget and req_widget not in user_widgets:
            rejected_reasons.append(f"{t['id']}: missing widget grant '{req_widget}'")
            continue
        req_cap = req.get("capability")
        if req_cap and req_cap not in caps:
            rejected_reasons.append(f"{t['id']}: missing capability '{req_cap}'")
            continue
        exposed.append(t)
    return exposed, rejected_reasons


def _to_ollama_tools(catalogue: list[dict]) -> list[dict]:
    """Convert our tool catalogue entries to Ollama's tool format."""
    return [
        {
            "type": "function",
            "function": {
                "name":        t["id"],
                "description": t.get("description", ""),
                "parameters":  t.get("parameters") or {"type": "object", "properties": {}},
            },
        }
        for t in catalogue
    ]


# ─── Ollama wrapper ───────────────────────────────────────────────────
async def _ollama_chat(messages: list[dict], tools: list | None) -> dict:
    body = {
        "model":      MODEL,
        "messages":   messages,
        "stream":     False,
        "keep_alive": KEEP_ALIVE,
        "options":    {"temperature": 0.1, "num_ctx": NUM_CTX},
    }
    if tools:
        body["tools"] = tools
    try:
        async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as c:
            r = await c.post(f"{OLLAMA_URL}/api/chat", json=body)
        if r.status_code != 200:
            raise HTTPException(502, f"local model error: {r.text[:300]}")
        return r.json()
    except httpx.RequestError as exc:
        raise HTTPException(503, f"local model unreachable: {exc}") from exc


def _tool_args(call: dict) -> dict:
    args = call.get("function", {}).get("arguments", {})
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except Exception:                                   # noqa: BLE001
            args = {}
    return args or {}


# ─── gateway-executor tools (only run_sql so far) ────────────────────
async def _exec_run_sql(args: dict, user: UserCtx) -> dict:
    """Internal delegate to /api/sql/execute — same auth chain, in-process call."""
    from .sql_lab import execute, ExecuteRequest      # type: ignore
    sql = (args or {}).get("sql", "").strip()
    if not sql:
        return {"ok": False, "error": "empty sql"}
    try:
        result = await execute(body=ExecuteRequest(sql=sql), user=user)
    except HTTPException as exc:
        return {"ok": False, "error": exc.detail, "status": exc.status_code}
    return {"ok": True, "result": result}


async def _exec_list_marts(args: dict, user: UserCtx) -> dict:
    """Step 1 of the query narrowing-loop: list the governed data marts (schema
    .table + subject + granularity + one-line description) so the model can pick
    the right one BEFORE asking for columns. Catalog metadata only — no rows;
    actual data access is enforced per-query by run_sql's OPA gate."""
    pool = await ops_db.ensure_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT schema_name, table_name, subject, granularity,
                   default_sensitivity, description
              FROM ops_perm.mart_attrs
             ORDER BY schema_name, table_name
        """)
    return {
        "ok": True, "count": len(rows),
        "marts": [{
            "mart":        f'{r["schema_name"]}.{r["table_name"]}',
            "subject":     r["subject"],
            "granularity": r["granularity"],
            "sensitivity": r["default_sensitivity"],
            "description": (r["description"] or "")[:80],
        } for r in rows],
    }


async def _exec_describe_mart(args: dict, user: UserCtx) -> dict:
    """Step 2 of the narrowing-loop: return the columns (name + type) of ONE
    cataloged mart, so the model writes run_sql against columns it has actually
    seen. Runs DESCRIBE through the same OPA-gated sql path (row-scope guarded)."""
    from .. import mart_attrs                          # type: ignore
    from .sql_lab import execute, ExecuteRequest       # type: ignore
    mart = str((args or {}).get("mart") or "").strip()
    if "." not in mart:
        return {"ok": False, "error": "mart must be 'schema.table' (see list_marts)"}
    schema, table = mart.split(".", 1)
    try:
        await mart_attrs.lookup(schema, table)         # cataloged? else raises
    except Exception:                                  # noqa: BLE001
        return {"ok": False, "error": f"not a cataloged mart: {mart} — call list_marts"}
    try:
        result = await execute(body=ExecuteRequest(sql=f"DESCRIBE {schema}.{table}"),
                               user=user)
    except HTTPException as exc:
        return {"ok": False, "error": exc.detail, "status": exc.status_code}
    return {"ok": True, "mart": mart,
            "columns": result.get("rows") or result.get("columns") or []}


GATEWAY_EXECUTORS = {
    "run_sql":       _exec_run_sql,
    "list_marts":    _exec_list_marts,
    "describe_mart": _exec_describe_mart,
}


# ─── SPA-executor argument validation (server-side scope guard) ───────
# Interact tools that set a FILTER value must never apply a value outside the
# user's authorized scope — the SPA/LLM is NOT trusted to pick a valid one
# (defense in depth at the interaction layer). read_*, navigate, scroll and
# write_widget_input carry no cross-scope data risk: SQL typed into the editor
# still executes through the OPA-gated run_sql path.
_FILTER_APPLY_TOOLS = {"apply_global_filter", "apply_widget_filter"}


async def _validate_spa_tool_scope(session: "_Session", user: UserCtx,
                                   tool_name: str, args: dict) -> str | None:
    """Return None if the tool's arguments are within the user's scope, else a
    human-readable reason the action is refused (fed back to the model so it
    re-plans instead of applying an out-of-scope value)."""
    if tool_name not in _FILTER_APPLY_TOOLS:
        return None
    filter_id = str(args.get("name") or args.get("filter") or "").strip()
    value = args.get("value")
    if not filter_id or value is None:
        return None
    pool = await ops_db.ensure_pool()
    if tool_name == "apply_widget_filter":
        widget_id = str(args.get("widget_id") or "").strip() or None
        allowed = await permissions.filter_values(
            filter_id, user, pool,
            dashboard_id=session.dashboard_id, widget_id=widget_id)
    else:  # apply_global_filter → page-scoped
        allowed = await permissions.filter_values(
            filter_id, user, pool, page_id=session.page_id)
    if allowed.get("denied"):
        return f"you are not authorized to use the '{filter_id}' filter here"
    if allowed.get("wildcard"):
        return None
    permitted = {str(v) for v in (allowed.get("values") or [])}
    requested = value if isinstance(value, list) else [value]
    bad = [str(v) for v in requested if str(v) not in permitted]
    if bad:
        return (f"value(s) {bad} are outside your allowed scope for "
                f"'{filter_id}'. You may only use: {sorted(permitted)[:20]}")
    return None


# ─── request / response models ───────────────────────────────────────
class Message(BaseModel):
    role:    str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=4000)


class StartRequest(BaseModel):
    dashboard_id: str = Field(min_length=1, max_length=64)
    page_id:      str | None = None
    question:     str = Field(min_length=1, max_length=2000)
    history:      list[Message] = Field(default_factory=list)


class ContinueRequest(BaseModel):
    session_id:  str
    tool_result: dict[str, Any]


# ─── answer sanitization ─────────────────────────────────────────────
# Qwen-class models can, on a degenerate generation (typically after exhausting the
# tool-call budget), leak their raw chat template into `content` — special tokens plus
# a HALLUCINATED <tool_response> block carrying a fabricated number. That output is never
# trustworthy and must NEVER reach the UI: detect the leak and let the caller substitute a
# safe fallback rather than salvaging prose (or a fabricated figure) from it.
_DEGENERATE_MARKERS = ("<|", "<tool_call>", "</tool_call>",
                       "<tool_response>", "</tool_response>")


def _sanitize_answer(raw: str | None) -> tuple[str, bool]:
    """Return (clean_text, trustworthy). trustworthy=False when the model's answer is
    empty or shows chat-template / tool-response leakage — a degenerate, untrustworthy
    generation that may embed a fabricated number. The caller then emits a safe fallback."""
    text = (raw or "").strip()
    if not text:
        return "", False
    if any(m in text for m in _DEGENERATE_MARKERS):
        return "", False
    return text, True


def _sql_editor_safety_net(session: _Session, answer: str) -> dict[str, Any] | None:
    """Deterministic guarantee for the SQL editor. qwen2.5:14b frequently writes the
    query as a ```sql block in prose (or CLAIMS it "placed" it) WITHOUT calling
    write_widget_input — including after the user says "you didn't actually do it".
    If the model's final answer carries a SELECT/WITH and the editor tool was NOT
    invoked this turn, emit a write_widget_input call so the SQL actually lands in
    ex-sql-editor. It RUNS the query (and_run) only when the user's own message asked
    to run/execute — honouring place-vs-run rather than always injecting. Fires at
    most once per turn; if the model already called the editor tool, we respect that
    and do nothing."""
    if session.sql_net_fired:
        return None
    if not any(t.get("id") == "write_widget_input" for t in session.tool_catalogue):
        return None                       # user lacks the interact capability
    if any(c.get("kind") == "write_widget_input" for c in session.tool_calls):
        return None                       # the model already did it — respect it
    m = re.search(r"```(?:sql)?\s*(.*?)```", answer or "", re.S | re.I)
    sql = (m.group(1).strip() if m else "")
    if not re.match(r"^\s*(with|select)\b", sql, re.I):
        return None                       # no runnable query in the answer
    q = next((mm.get("content", "") for mm in reversed(session.messages)
              if mm.get("role") == "user"), "")
    run = bool(re.search(r"\b(run|execute)\b", q or "", re.I))
    session.sql_net_fired = True
    args = {"widget_id": "ex-sql-editor", "value": sql, "and_run": run}
    # Append a well-formed assistant turn carrying this tool call so /continue reads
    # it back from messages[-1] and can feed the SPA's result to the model.
    session.messages.append({
        "role": "assistant", "content": "",
        "tool_calls": [{"type": "function",
                        "function": {"name": "write_widget_input", "arguments": args}}],
    })
    return {"kind": "tool_call",
            "tool": {"name": "write_widget_input", "args": args},
            "executor": "spa"}


# ─── orchestration ───────────────────────────────────────────────────
async def _drive_one_round(session: _Session, user: UserCtx) -> dict[str, Any]:
    """Run one Ollama turn. Returns either {kind:'tool_call'} or {kind:'answer'}."""
    if session.rounds >= MAX_ROUNDS:
        # Force a final answer with no tools — model has had its chances.
        resp = await _ollama_chat(session.messages, tools=None)
        msg = resp.get("message", {}) or {}
        clean, ok = _sanitize_answer(msg.get("content"))
        answer = clean if ok else \
            "I've hit my tool-call budget for this question — try asking more narrowly."
        step = _sql_editor_safety_net(session, answer)
        return step if step is not None else {"kind": "answer", "answer": answer,
                                              "tool_calls": session.tool_calls}

    session.rounds += 1
    ollama_tools = _to_ollama_tools(session.tool_catalogue)
    resp = await _ollama_chat(session.messages, tools=ollama_tools)
    msg = resp.get("message", {}) or {}
    calls = msg.get("tool_calls") or []
    if not calls:
        # Model returned a plain answer. Sanitize it — a degenerate generation that
        # leaked its chat template (and possibly a fabricated number) must not surface.
        clean, ok = _sanitize_answer(msg.get("content"))
        answer = clean if ok else \
            "I don't have a grounded answer for that — try asking more narrowly, or " \
            "open the relevant widget from the dashboard."
        step = _sql_editor_safety_net(session, answer)
        return step if step is not None else {"kind": "answer", "answer": answer,
                                              "tool_calls": session.tool_calls}

    # Take the first call; later we could batch multiple in one round.
    call = calls[0]
    tool_name = (call.get("function") or {}).get("name", "")
    args      = _tool_args(call)
    # Find the tool in the user's exposed catalogue.
    spec = next((t for t in session.tool_catalogue if t["id"] == tool_name), None)
    if not spec:
        # Model hallucinated a tool. Tell it so and let it retry.
        session.messages.append(msg)
        session.messages.append({"role": "tool",
                                  "content": json.dumps({"ok": False,
                                                          "error": f"unknown tool {tool_name!r}"})})
        return await _drive_one_round(session, user)

    # Idempotency guard: if the model re-issues a tool call identical to one it
    # already made this session (same name + args), don't re-run it — feed back a
    # short note and let it move on. This breaks the degenerate loop where the
    # model repeats a call and re-announces success without progressing toward an
    # answer. The recursion below re-enters _drive_one_round (a spent round), so
    # it is bounded by MAX_ROUNDS like every other feed-back path.
    sig = tool_name + ":" + json.dumps(args, sort_keys=True, default=str)
    if sig in session.seen_calls:
        session.messages.append(msg)
        session.messages.append({"role": "tool", "content": json.dumps(
            {"ok": True, "note": (f"{tool_name} was already called with these "
             "arguments earlier in this conversation; its effect stands. Do not "
             "repeat it — use the prior result and give your final answer.")})})
        return await _drive_one_round(session, user)
    session.seen_calls.add(sig)

    if spec.get("executor") == "gateway":
        executor = GATEWAY_EXECUTORS.get(tool_name)
        if executor is None:
            tool_result = {"ok": False, "error": f"no gateway executor for {tool_name!r}"}
        else:
            tool_result = await executor(args, user)
        session.tool_calls.append({"kind": tool_name, "args": args, "result": tool_result})
        session.messages.append(msg)
        session.messages.append({"role": "tool",
                                  "content": json.dumps(tool_result, default=str)[:12000]})
        return await _drive_one_round(session, user)

    # SPA-executor: validate any scope-bearing argument server-side BEFORE
    # handing the action to the client. If the value is outside the user's
    # authorized scope, feed the model an error and let it re-plan rather than
    # emitting an out-of-scope filter application.
    scope_err = await _validate_spa_tool_scope(session, user, tool_name, args)
    if scope_err is not None:
        session.messages.append(msg)
        session.messages.append({"role": "tool",
                                  "content": json.dumps({"ok": False, "error": scope_err})})
        return await _drive_one_round(session, user)
    # stash the model message + return the call to the client.
    session.messages.append(msg)
    return {"kind": "tool_call", "tool": {"name": tool_name, "args": args},
            "executor": "spa"}


# ─── endpoints ────────────────────────────────────────────────────────
@router.get("/health")
async def health() -> dict:
    ready = False
    try:
        async with httpx.AsyncClient(timeout=3) as c:
            r = await c.get(f"{OLLAMA_URL}/api/tags")
        tags = (r.json() or {}).get("models", []) if r.status_code == 200 else []
        ready = any((m.get("name") or "").startswith(MODEL.split(":")[0]) for m in tags)
    except Exception:                                       # noqa: BLE001
        pass
    return {"model": MODEL, "ready": ready, "sessions": len(_sessions)}


@router.get("/intro")
async def intro(dashboard_id: str,
                user: UserCtx = Depends(get_user)) -> dict:
    """Suggested prompts shown when the chat panel opens. Picks the
    per-role list from the dashboard's intents.yaml. Returns 403 if
    the user doesn't have the bi-assistant widget on this dashboard
    (so SPAs can avoid rendering the chat FAB for ungranted roles)."""
    cfg = _load_dashboard_chat_config(dashboard_id)
    catalogue, _ = await _compute_user_tools(dashboard_id, user,
                                              cfg["tool_catalogue"])
    if not catalogue:
        raise HTTPException(403,
            "chatbot not granted for your role on this dashboard")
    intents = cfg.get("intents") or {}
    suggestions = intents.get(user.primary_role) or intents.get("default") or []
    return {
        "model":       MODEL,
        "dashboard":   dashboard_id,
        "user_role":   user.primary_role,
        "suggestions": suggestions,
    }


async def _build_site_map(dashboard_id: str, user: UserCtx) -> str:
    """A compact per-user map of the pages the caller can open and the widgets on
    each — so the model knows WHERE a metric lives (read_page only sees the
    CURRENT page). This is what lets it answer 'that widget is on the X page' and
    then navigate + highlight it, instead of hallucinating a mart. Grant-scoped:
    resolve_dashboard already filters to the user's role_widget/page grants."""
    try:
        pool = await ops_db.ensure_pool()
        dash = await permissions.resolve_dashboard(dashboard_id, user, pool)
    except Exception as exc:                                   # noqa: BLE001
        log.warning("site map resolve failed: %s", exc)
        return ""
    if not dash or not dash.pages:
        return ""
    lines = [
        "SITE MAP — the pages you can open on this dashboard and the widgets on each.",
        "Match the user's question to a widget/page BELOW. Use the EXACT page_id with",
        "navigate_to_page, and the EXACT widget id (in [brackets]) with read_widget /",
        "scroll_to_widget. If nothing here matches, say you don't have that widget — do",
        "NOT invent a page, widget, or mart name.",
    ]
    for p in dash.pages:
        if not p.widgets:
            continue
        widget_str = "; ".join(f"{w.title} [{w.id}]" for w in p.widgets[:24])
        lines.append(f"- page_id={p.id} — {p.title}: {widget_str}")
    return "\n".join(lines)


@router.post("/start")
async def start(body: StartRequest = Body(...),
                user: UserCtx = Depends(get_user)) -> dict:
    # Access gate = the assistant:* capabilities on the user's role(s).
    # A role with none of assistant:read/run_sql/interact exposes no tools →
    # 403 here (same effect as an absent chatbot-tools scope pre-Phase-1).
    cfg = _load_dashboard_chat_config(body.dashboard_id)
    catalogue, _ = await _compute_user_tools(body.dashboard_id, user, cfg["tool_catalogue"])
    if not catalogue:
        raise HTTPException(403,
            "chatbot not granted for your role on this dashboard, "
            "or no tools enabled by your assistant capabilities")

    _prune_sessions()
    history = [{"role": m.role, "content": m.content} for m in body.history[-MAX_HISTORY:]]
    grounding = (f"DASHBOARD: {body.dashboard_id}"
                 + (f" · PAGE: {body.page_id}" if body.page_id else ""))
    site_map = await _build_site_map(body.dashboard_id, user)
    system_content = cfg["system_prompt"] + "\n\n" + grounding
    if site_map:
        system_content += "\n\n" + site_map
    messages: list[dict] = [
        {"role": "system",  "content": system_content},
        *history,
        {"role": "user",    "content": body.question},
    ]
    sid = secrets.token_urlsafe(16)
    session = _Session(
        user_kc_sub=user.kc_sub, dashboard_id=body.dashboard_id,
        page_id=body.page_id, messages=messages,
        tool_catalogue=catalogue, created_at=time.time(),
    )
    _sessions[sid] = session
    step = await _drive_one_round(session, user)
    return {"session_id": sid, **step}


@router.post("/continue")
async def continue_(body: ContinueRequest = Body(...),
                     user: UserCtx = Depends(get_user)) -> dict:
    _prune_sessions()
    session = _sessions.get(body.session_id)
    if session is None:
        raise HTTPException(404, "session not found or expired")
    if session.user_kc_sub != user.kc_sub:
        raise HTTPException(403, "session belongs to a different user")
    # Pull the tool name from the last assistant message's tool_calls.
    last = session.messages[-1]
    pending_calls = (last.get("tool_calls") or []) if isinstance(last, dict) else []
    if not pending_calls:
        raise HTTPException(400, "no pending tool call to continue")
    pending = pending_calls[0]
    tool_name = (pending.get("function") or {}).get("name", "")
    args      = _tool_args(pending)
    # Record the call + result for the final response shape.
    session.tool_calls.append({"kind": tool_name, "args": args,
                                "result": body.tool_result})
    # Feed the result back to the model.
    session.messages.append({"role": "tool",
                              "content": json.dumps(body.tool_result, default=str)[:12000]})
    step = await _drive_one_round(session, user)
    # If we returned a final answer, audit + drop the session.
    if step.get("kind") == "answer":
        ts = int((time.time() - session.created_at) * 1000)
        await ops_db.log_gateway_query(
            user=user, method="POST", path="/api/chat",
            mart_scope=[f"chat:{session.dashboard_id}"],
            filters={"page_id": session.page_id or ""},
            row_count=len(session.tool_calls), byte_count=len(step["answer"]),
            latency_ms=ts, http_status=200, policy_decision="allow")
        _sessions.pop(body.session_id, None)
    return step
