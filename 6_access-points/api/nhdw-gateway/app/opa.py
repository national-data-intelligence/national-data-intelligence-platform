"""Single OPA decide call. Advisory mode by default."""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import httpx

from .auth import UserCtx
from .settings import settings

log = logging.getLogger("gateway.opa")


@dataclass
class Decision:
    allow: bool
    reason: str = ""
    degraded: bool = False
    masked_columns: list[str] = field(default_factory=list)
    rule_hits: list[str] = field(default_factory=list)
    obligations: dict[str, Any] = field(default_factory=dict)
    row_filter: dict[str, Any] = field(default_factory=dict)   # {dimension: [allowed values]}

    def __bool__(self) -> bool:
        return self.allow


async def decide(user: UserCtx, *, action: str, resource: str,
                 attributes: dict[str, Any] | None = None,
                 scope: dict[str, list[str]] | None = None,
                 columns: dict[str, str] | None = None) -> Decision:
    """Ask OPA for an authorization decision.

    `scope` = the caller's granted data scope from ops_identity.user_scope,
    {kind: [values]} (kind ∈ geography/programme/facility). It is pushed into the
    OPA context so policies emit a `row_filter` obligation the PEP AND-applies to
    the actual query — this is how granted_scope becomes ROW-level enforcement,
    not just UI filtering.

    `columns` = the queried relation's CLASSIFIED columns as {name: sensitivity}
    (from mart_attrs.columns_for_mart — the denylist store, so unclassified
    columns are never sent and never masked). The policy returns the subset the
    caller may NOT see unmasked in `masked_columns`; the PEP then transforms
    each one per its mask_class (app/masking.py). Omitted ⇒ no column identity
    reaches OPA and nothing is masked — callers reading classified marts MUST
    pass it.
    """
    sc = scope or {}
    # user_scope loads values as sets; OPA input is JSON, and a set is not
    # JSON-serializable. Normalize every scope dimension to a sorted list so the
    # row-level path works regardless of whether the caller passes sets or lists.
    def _lst(v) -> list[str]:
        if v is None:
            return []
        return sorted(v) if isinstance(v, (set, frozenset)) else list(v)
    payload = {
        "input": {
            "user":   {"role": user.primary_role, "name": user.username,
                       "realm": user.realm, "sub": user.kc_sub,
                       # P1.3 trust tier — the OPA trust guard denies sensitive
                       # actions for low-trust federated identities.
                       "idp": user.idp, "idp_trust": user.idp_trust},
            "action": {"verb": action},
            "resource": {"subject": resource, **(attributes or {}),
                         "columns": [{"name": n, "sensitivity": s}
                                     for n, s in sorted((columns or {}).items())]},
            "context": {
                "purpose_of_use": user.purpose_of_use,
                "geographies":    _lst(sc.get("geography")) or _lst(user.geographies),
                "programs":       _lst(sc.get("programme")) or _lst(user.programs),
                "facilities":     _lst(sc.get("facility")),
            },
        }
    }
    try:
        async with httpx.AsyncClient(timeout=settings.OPA_TIMEOUT_S) as c:
            resp = await c.post(f"{settings.OPA_URL}/v1/data/nhdw/authz/decide",
                                json=payload)
        if resp.status_code != 200:
            log.warning("opa http %s — fail %s", resp.status_code,
                        "open" if settings.OPA_FAIL_OPEN else "closed")
            return Decision(allow=settings.OPA_FAIL_OPEN,
                            reason=f"opa http {resp.status_code}", degraded=True)
        body = (resp.json() or {}).get("result", {})
    except (httpx.ConnectError, httpx.ReadTimeout, httpx.RemoteProtocolError,
            httpx.ConnectTimeout, httpx.PoolTimeout) as e:
        # OPA UNREACHABLE → fail closed by default (OPA_FAIL_OPEN=false),
        # independent of OPA_ENFORCE.
        log.warning("opa unreachable (%s) — fail %s", e,
                    "open" if settings.OPA_FAIL_OPEN else "closed")
        return Decision(allow=settings.OPA_FAIL_OPEN,
                        reason=f"opa unreachable: {e}", degraded=True)

    obligations = dict(body.get("obligations") or {})
    d = Decision(
        allow=bool(body.get("allow", False)),
        reason=str(body.get("reason", "")),
        masked_columns=list(body.get("masked_columns") or []),
        rule_hits=list(body.get("rule_hits") or []),
        obligations=obligations,
        row_filter=dict(obligations.get("row_filter") or {}),
    )
    # Advisory mode = explicit DEV opt-out ONLY (OPA_ENFORCE=false): a deny is
    # logged LOUDLY and flipped to allow so local dev isn't blocked. In-cluster
    # OPA_ENFORCE=true, so denials become real 403s.
    if not d.allow and not settings.OPA_ENFORCE:
        log.warning("OPA DENY → ALLOW (advisory; OPA_ENFORCE=false) "
                    "role=%s action=%s resource=%s reason=%s",
                    user.primary_role, action, resource, d.reason)
        d.allow = True
        d.reason = d.reason + " [advisory]"
    return d
