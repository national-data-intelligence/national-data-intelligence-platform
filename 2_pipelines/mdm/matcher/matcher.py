#!/usr/bin/env python3
"""MDM matcher — proposes source-record → master-entity CANDIDATES for stewardship.

Reads source facility records from the vault's resolution view
(`nhdw_vault_business.v_facility_resolution`), runs the match passes, and
upserts scored candidates into `nhdw_ops.ops_governance.mdm_match_candidate`.
It NEVER merges anything itself — conformed keys change only through rows in
mdm_match_decision (steward verdicts via the console, or an explicitly
reviewed batch accept), which the vault resolution views read. An empty
decision log leaves today's conformed keys byte-identical.

Candidate shape (record → master):
  left  = one un-conformed source record: (source_system, hex(hk_source_facility)).
          The hex hub hash is the ONLY stable per-record identity both the
          matcher and the resolution view can derive; source_system must ride
          along because HCMIS/mBrana integer BK spaces overlap (891 identical
          hub hashes live).
  right = the conformed master it may belong to:
          ('NHDW.conformed', conformed_bk) — the FAC- slug entity.

Match passes (facility):
  name_exact         norm_name equals exactly ONE conformed master's name.
                     Grounded: 883/891 mBrana facilities are exact-name twins
                     of FAC facilities (double-counted single_source today).
                     Score 1.0 — still a candidate, because applying it re-keys
                     rows: a deliberate stewarded change, never automatic.
  name_ambiguous     norm_name matches >1 master (29 such names live). One
                     candidate per possible master, geo distance_km in
                     match_features as the steward's tie-break (mBrana sat
                     carries GPS; MFR is the FAC-side coordinate authority).
  name_probabilistic pg_trgm similarity >= MDM_TRGM_THRESHOLD (default 0.85)
                     where no exact twin exists. Real false positives exist at
                     0.89 ("Nejashi II" vs "Nejashi") — never auto-accepted.

Commodity pass (name_probabilistic only): a commodity master IS a vocabulary
concept, and concept_code == the normalised name by the parity rule — so an
EXACT-name commodity conforms implicitly (hash equality) and needs no
candidate. What needs stewardship is the NEAR-name: a source commodity the
crosswalk missed whose norm_name is trigram-close to (but not equal to) a
NHDW-COMMODITY concept ("amoxicilin 500mg" vs "amoxicillin 500mg"). The live
34↔34 sets are fully crosswalked, so this pass emits 0 today — it exists for
the day a new source commodity arrives misspelt. Accepting maps the record
onto the concept in v_commodity_resolution (steward_decision strategy);
curated-bulk mappings stay the vocabulary supplements' job.

Config (env):
  VAULT_DSN            postgres DSN for nhdw_vault  (reads the vault)
  OPS_DSN              postgres DSN for nhdw_ops    (writes candidates)
  MDM_TRGM_THRESHOLD   default 0.85
  MDM_CONTEXT          deployment context, default ET
"""
from __future__ import annotations

import json
import os
import sys
import uuid
from datetime import datetime, timezone

import psycopg

MATCHER_VERSION = "0.1.0"

# Set-based candidate generation over the deployed resolution view. The
# coordinate sats are typed (MFR: explicit landing schema; mBrana: typed by
# the staging/bridge layer) — verified live before writing these casts.
SQL_FACILITY_CANDIDATES = """
WITH fac AS (               -- conformed masters (FAC- slug side)
    SELECT DISTINCT conformed_bk, norm_name
    FROM nhdw_vault_business.v_facility_resolution
    WHERE match_strategy = 'facility_id'
),
fac_names AS (              -- how many masters share each normalised name
    SELECT norm_name, count(DISTINCT conformed_bk) AS n_targets
    FROM fac GROUP BY norm_name
),
fac_geo AS (                -- master coordinates: MFR location is the authority
                            -- (sat columns are typed by the landing schema —
                            -- double precision live)
    SELECT r.conformed_bk,
           avg(s.latitude::float8)  AS lat,
           avg(s.longitude::float8) AS lng
    FROM nhdw_vault_business.v_facility_resolution r
    JOIN nhdw_vault_business.v_sat_mfr_facility_current s
      ON s.hk_mfr_facility = r.hk_source_facility
    WHERE r.source_system = 'MFR.location'
      AND r.match_strategy = 'facility_id'
    GROUP BY r.conformed_bk
),
nameonly AS (               -- un-conformed records (no slug anywhere)
    SELECT hk_source_facility, source_system, source_name, norm_name
    FROM nhdw_vault_business.v_facility_resolution
    WHERE match_strategy = 'norm_name'
),
left_geo AS (               -- mBrana master records carry their own GPS and
                            -- admin area (numeric/text live — typed upstream).
                            -- The admin fields ride into match_features: with
                            -- the MFR Location sat empty live (a recorded
                            -- source-data gap), they are the tie-break signal
                            -- a steward actually has today.
    SELECT hk_mbrana_facility AS hk,
           latitude::float8  AS lat,
           longitude::float8 AS lng,
           woreda, zone, town
    FROM nhdw_vault_business.v_sat_mbrana_facility_current
),
exact AS (                  -- name_exact + name_ambiguous
    SELECT n.source_system,
           encode(n.hk_source_facility, 'hex') AS left_key,
           f.conformed_bk                      AS master_bk,
           1.0::numeric                        AS score,
           CASE WHEN fn.n_targets = 1 THEN 'name_exact'
                ELSE 'name_ambiguous' END      AS match_rule,
           jsonb_strip_nulls(jsonb_build_object(
               'source_name',  n.source_name,
               'norm_name',    n.norm_name,
               'n_targets',    fn.n_targets,
               'left_woreda',  lg.woreda,
               'left_zone',    lg.zone,
               'left_town',    lg.town,
               'distance_km',  round((2 * 6371 * asin(sqrt(
                   power(sin(radians((fg.lat - lg.lat) / 2)), 2)
                   + cos(radians(lg.lat)) * cos(radians(fg.lat))
                     * power(sin(radians((fg.lng - lg.lng) / 2)), 2)
               )))::numeric, 2)
           ))                                  AS match_features
    FROM nameonly n
    JOIN fac f        ON f.norm_name = n.norm_name
    JOIN fac_names fn ON fn.norm_name = n.norm_name
    LEFT JOIN left_geo lg ON lg.hk = n.hk_source_facility
    LEFT JOIN fac_geo  fg ON fg.conformed_bk = f.conformed_bk
),
probabilistic AS (          -- trigram, only where NO exact twin exists
    SELECT n.source_system,
           encode(n.hk_source_facility, 'hex')          AS left_key,
           f.conformed_bk                               AS master_bk,
           similarity(n.norm_name, f.norm_name)::numeric AS score,
           'name_probabilistic'                          AS match_rule,
           jsonb_build_object(
               'source_name', n.source_name,
               'norm_name',   n.norm_name,
               'master_name', f.norm_name,
               'similarity',  round(similarity(n.norm_name, f.norm_name)::numeric, 3)
           )                                             AS match_features
    FROM nameonly n
    JOIN fac f ON f.norm_name %% n.norm_name
              AND similarity(n.norm_name, f.norm_name) >= %(threshold)s
    WHERE NOT EXISTS (SELECT 1 FROM fac fx WHERE fx.norm_name = n.norm_name)
)
SELECT source_system AS left_source_system_code,
       left_key      AS left_source_record_key,
       master_bk, score, match_rule, match_features
FROM exact
UNION ALL
SELECT source_system, left_key, master_bk, score, match_rule, match_features
FROM probabilistic
ORDER BY 1, 2, 3
"""

SQL_COMMODITY_CANDIDATES = """
WITH concepts AS (       -- the commodity master universe = the vocabulary
    SELECT c.concept_code
    FROM nhdw_ref.concept c
    WHERE c.vocabulary_id = 'NHDW-COMMODITY'
      AND c.invalid_reason IS NULL
      AND CURRENT_DATE >= c.valid_from AND CURRENT_DATE < c.valid_to
),
unmatched AS (           -- crosswalk misses that also aren't an exact concept
    SELECT r.hk_source_commodity, r.source_system, r.source_name, r.norm_name
    FROM nhdw_vault_business.v_commodity_resolution r
    WHERE r.match_strategy = 'norm_name'
      AND NOT EXISTS (SELECT 1 FROM concepts c WHERE c.concept_code = r.norm_name)
)
SELECT u.source_system                       AS left_source_system_code,
       encode(u.hk_source_commodity, 'hex')  AS left_source_record_key,
       c.concept_code                        AS master_bk,
       similarity(u.norm_name, c.concept_code)::numeric AS score,
       'name_probabilistic'                  AS match_rule,
       jsonb_build_object(
           'source_name', u.source_name,
           'norm_name',   u.norm_name,
           'master_name', c.concept_code,
           'similarity',  round(similarity(u.norm_name, c.concept_code)::numeric, 3)
       )                                     AS match_features
FROM unmatched u
JOIN concepts c ON c.concept_code %% u.norm_name
              AND similarity(u.norm_name, c.concept_code) >= %(threshold)s
ORDER BY 1, 2, 3
"""

UPSERT = """
INSERT INTO ops_governance.mdm_match_candidate
      (deployment_context, entity_class_code,
       left_source_system_code, left_source_record_key,
       right_source_system_code, right_source_record_key,
       suggested_master_bk, score, match_rule, match_features,
       matcher_run_uid, matcher_version)
VALUES (%(context)s, %(entity_class)s,
        %(left_sys)s, %(left_key)s,
        %(right_sys)s, %(master_bk)s,
        %(master_bk)s, %(score)s, %(match_rule)s, %(features)s::jsonb,
        %(run_uid)s, %(version)s)
ON CONFLICT (deployment_context, entity_class_code,
             left_source_system_code, left_source_record_key,
             right_source_system_code, right_source_record_key)
DO UPDATE SET
      suggested_master_bk = EXCLUDED.suggested_master_bk,
      score               = EXCLUDED.score,
      match_rule          = EXCLUDED.match_rule,
      match_features      = EXCLUDED.match_features,
      matcher_run_uid     = EXCLUDED.matcher_run_uid,
      matcher_version     = EXCLUDED.matcher_version,
      discovered_at       = now()
WHERE ops_governance.mdm_match_candidate.status = 'pending'
"""


_ENTITY_SQL = {"facility": SQL_FACILITY_CANDIDATES,
               "commodity": SQL_COMMODITY_CANDIDATES}

# right-hand identity per entity class: facilities master onto a conformed
# hub entity; commodities master onto a vocabulary concept.
_RIGHT_SYS = {"facility": "NHDW.conformed", "commodity": "NHDW.vocabulary"}


def generate_candidates(vault_conn, threshold: float, *,
                        entity_class: str = "facility") -> list[dict]:
    """Run one entity class's match passes; returns candidate dicts (pure read)."""
    with vault_conn.cursor() as cur:
        cur.execute(_ENTITY_SQL[entity_class], {"threshold": threshold})
        cols = [d.name for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def store_candidates(ops_conn, pairs: list[dict], *, context: str,
                     run_uid: str, entity_class: str = "facility") -> dict[str, int]:
    """Upsert candidates; pending rows refresh, steward-decided rows are
    never touched (the status guard). Returns counts per match rule."""
    by_rule: dict[str, int] = {}
    with ops_conn.cursor() as cur:
        for p in pairs:
            by_rule[p["match_rule"]] = by_rule.get(p["match_rule"], 0) + 1
            cur.execute(UPSERT, {
                "context": context, "run_uid": run_uid,
                "version": MATCHER_VERSION,
                "entity_class": entity_class,
                "right_sys": _RIGHT_SYS[entity_class],
                "left_sys": p["left_source_system_code"],
                "left_key": p["left_source_record_key"],
                "master_bk": p["master_bk"],
                "score": p["score"], "match_rule": p["match_rule"],
                "features": json.dumps(p["match_features"], default=str),
            })
    ops_conn.commit()
    return by_rule


def run() -> dict:
    threshold = float(os.environ.get("MDM_TRGM_THRESHOLD", "0.85"))
    context = os.environ.get("MDM_CONTEXT", "ET")
    run_uid = str(uuid.uuid4())

    by_entity: dict[str, dict[str, int]] = {}
    total = 0
    with psycopg.connect(os.environ["VAULT_DSN"]) as vault, \
         psycopg.connect(os.environ["OPS_DSN"]) as ops:
        for entity_class in ("facility", "commodity"):
            pairs = generate_candidates(vault, threshold, entity_class=entity_class)
            by_entity[entity_class] = store_candidates(
                ops, pairs, context=context, run_uid=run_uid,
                entity_class=entity_class)
            total += len(pairs)

    summary = {"run_uid": run_uid, "context": context, "threshold": threshold,
               "candidates": total, "by_entity": by_entity,
               "at": datetime.now(timezone.utc).isoformat()}
    print(json.dumps(summary))
    return summary


if __name__ == "__main__":
    sys.exit(0 if run() else 1)
