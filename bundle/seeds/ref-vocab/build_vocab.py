#!/usr/bin/env python3
"""build_vocab.py — generate the nhdw_ref vocabulary seed CSVs from the entity model.

Single source of truth for the reference vocabulary: this script reads
  * bundle/seeds/entity-model/entity-model.yaml   (programmes, indicators, commodities,
    regions, facility tiers, diseases, EPSS hubs), and
  * the code-mapping dicts inside build_sample.py (TIER_MFR_TYPES, REGION_NAME_TO_ID,
    MFR_OWNERSHIP_NORMALISED) — imported, never copied, so the mappings that get baked
    into seeded ids and the governed crosswalk can never drift apart,
and emits the CSVs that bundle/scripts/seed-ref-vocab.sh loads into nhdw_ref:

    _build/vocabulary.csv            _build/concept.csv
    _build/domain.csv                _build/concept_relationship.csv
    _build/concept_class.csv         _build/source_to_concept_map.csv

Supplements (supplements/*.csv) are merged into source_to_concept_map — this is where
live-derived mappings the entity model cannot know land (e.g. mBrana native commodity
codes, DHIS2 dataElement codes beyond the indicator list, and later the curated
ICD-10 / ATC subsets). Each supplement CSV has the source_to_concept_map column shape
with target given as  target_vocabulary_id,target_concept_code  (resolved to
target_concept_id here, so supplements never hard-code numeric ids).

STABLE IDS — concept_registry.json (committed, append-only) assigns every
(vocabulary_id, concept_code) a permanent concept_id starting at 2_000_000_001 (the
OMOP local-concept range). Regenerating never renumbers an existing concept; new codes
get the next free id. Never edit or delete registry entries.

PARITY RULE (load-bearing): for domains the resolution views consume, concept_code
equals the exact conformed_bk string the view produces today — programme ids verbatim,
commodity norm_name via the same normalisation as the SQL
(LOWER(REGEXP_REPLACE(name,'[^a-zA-Z0-9 ]','','g'))) — so hk_*_conformed stays
byte-identical when a view migrates to the crosswalk JOIN.

Usage:  python3 build_vocab.py          # writes _build/*.csv, updates the registry
        python3 build_vocab.py --check  # regenerate to a temp dir and diff (CI guard)
"""
from __future__ import annotations

import csv
import importlib.util
import json
import re
import sys
from datetime import date
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
ENTITY_DIR = HERE.parent / "entity-model"
BUILD = HERE / "_build"
REGISTRY = HERE / "concept_registry.json"
SUPPLEMENTS = HERE / "supplements"

VALID_FROM = "2026-01-01"          # stable, not "today": regeneration must be idempotent
VALID_TO = "2099-12-31"
ID_BASE = 2_000_000_001            # OMOP local-concept range

# The exact Python twin of the views' normalisation:
#   LOWER(REGEXP_REPLACE(COALESCE(name,''), '[^a-zA-Z0-9 ]', '', 'g'))
def norm_name(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9 ]", "", name or "").lower()


def load_entity_model() -> dict:
    return yaml.safe_load((ENTITY_DIR / "entity-model.yaml").read_text())


def load_build_sample_dicts() -> tuple[dict, dict, dict]:
    """Import the mapping dicts from build_sample.py (single source, never copied)."""
    spec = importlib.util.spec_from_file_location("bs", ENTITY_DIR / "build_sample.py")
    mod = importlib.util.module_from_spec(spec)
    # build_sample has heavyweight main() work, but the dicts are module-level and
    # import must stay side-effect-free; it guards execution behind __main__.
    spec.loader.exec_module(mod)
    return mod.TIER_MFR_TYPES, mod.REGION_NAME_TO_ID, mod.MFR_OWNERSHIP_NORMALISED


class Registry:
    """Append-only (vocabulary_id, concept_code) -> concept_id assignments."""

    def __init__(self, path: Path):
        self.path = path
        self.map: dict[str, int] = {}
        if path.exists():
            self.map = json.loads(path.read_text())["assignments"]
        self._next = max(self.map.values(), default=ID_BASE - 1) + 1
        self._dirty = False

    @staticmethod
    def key(vocabulary_id: str, concept_code: str) -> str:
        return f"{vocabulary_id}|{concept_code}"

    def id_for(self, vocabulary_id: str, concept_code: str) -> int:
        k = self.key(vocabulary_id, concept_code)
        if k not in self.map:
            self.map[k] = self._next
            self._next += 1
            self._dirty = True
        return self.map[k]

    def save(self) -> None:
        if self._dirty:
            self.path.write_text(json.dumps(
                {"comment": "APPEND-ONLY registry of stable concept ids — never edit or delete entries.",
                 "assignments": dict(sorted(self.map.items(), key=lambda kv: kv[1]))},
                indent=1) + "\n")


def build() -> dict[str, list[list]]:
    em = load_entity_model()
    tier_mfr, region_name_to_id, ownership_norm = load_build_sample_dicts()
    reg = Registry(REGISTRY)

    vocabularies = [
        # internal canonical sets
        ["NHDW-PROGRAMME",  "NHDW canonical programmes",        "entity-model.yaml", "1", "false"],
        ["NHDW-INDICATOR",  "NHDW canonical HMIS indicators",   "entity-model.yaml", "1", "false"],
        ["NHDW-COMMODITY",  "NHDW canonical commodities",       "entity-model.yaml", "1", "false"],
        ["NHDW-REGION",     "NHDW canonical regions",           "entity-model.yaml", "1", "false"],
        ["NHDW-TIER",       "NHDW canonical facility tiers",    "entity-model.yaml", "1", "false"],
        ["NHDW-OWNERSHIP",  "NHDW canonical ownership classes", "entity-model.yaml", "1", "false"],
        ["NHDW-DISEASE",    "NHDW canonical IDSR diseases",     "entity-model.yaml", "1", "false"],
        # source code spaces the crosswalk maps FROM
        ["DHIS2.dataElement", "DHIS2 data-element codes",          "source: DHIS2",  "1", "true"],
        ["MFR.facilityType",  "MFR facility-type display names",   "source: MFR",    "1", "true"],
        ["MFR.regionName",    "MFR region display names",          "source: MFR",    "1", "true"],
        ["MFR.ownership",     "MFR ownership display values",      "source: MFR",    "1", "true"],
        ["HCMIS.commodityId", "HCMIS native commodity ids",        "source: HCMIS",  "1", "true"],
        ["MBRANA.commodityCode", "mBrana native commodity codes",  "source: mBrana", "1", "true"],
        ["NHDW.commodityId",  "Entity-model commodity ids",        "entity-model.yaml", "1", "true"],
        # standard vocabularies — registered now, curated subsets loaded by their own
        # supplements when the curation lands (see supplements/README.md)
        ["ICD10", "WHO ICD-10 (curated NHDW subset)", "https://icd.who.int/browse10", "pending", "false"],
        ["ATC",   "WHO ATC (curated NHDW subset)",    "https://atcddd.fhi.no/atc_ddd_index/", "pending", "false"],
    ]

    domains = [["programme", "Health programme"], ["indicator", "HMIS indicator"],
               ["commodity", "Health commodity"], ["geography", "Administrative geography"],
               ["facility_type", "Facility tier/type"], ["ownership", "Facility ownership"],
               ["disease", "IDSR disease"]]
    classes = [["Programme", "Programme"], ["Indicator", "Indicator"], ["Commodity", "Commodity"],
               ["Region", "Region"], ["Facility Tier", "Facility tier"],
               ["Ownership", "Ownership class"], ["Disease", "Disease"]]

    concepts: list[list] = []
    # Crosswalk rows keyed on the load PK so SUPPLEMENTS OVERRIDE derived rows —
    # e.g. the parity supplement pins codes the deployed CASE sends to OTHER even
    # where the entity model knows a richer programme (byte-identical keys first;
    # richer mappings land later as stewarded vocabulary changes).
    s2c_map: dict[tuple[str, str], list] = {}
    rels: list[list] = []
    cid: dict[tuple[str, str], int] = {}

    def add_concept(vocab: str, code: str, name: str, domain: str, cls: str, standard="S"):
        i = reg.id_for(vocab, code)
        cid[(vocab, code)] = i
        concepts.append([i, name, domain, vocab, cls, standard, code, VALID_FROM, VALID_TO, ""])
        return i

    def add_s2c(src_code: str, src_vocab: str, desc: str, target_id: int, loaded_by="build_vocab.py"):
        s2c_map[(src_code, src_vocab)] = [src_code, src_vocab, desc, target_id,
                                          VALID_FROM, VALID_TO, "", "seed", loaded_by]

    # ── canonical concepts ───────────────────────────────────────────────────
    # Programmes = the declared list + ids referenced by indicators/commodities but
    # not declared (the entity model uses GENERAL for essential medicines) + the
    # OTHER fallback the resolution view emits for unmapped codes.
    implicit_names = {"GENERAL": "General / essential medicines",
                      "OTHER": "Other / unassigned"}
    declared = {p["id"] for p in em["programmes"]}
    referenced = ({i["programme"] for i in em["indicators"]}
                  | {c["programme"] for c in em["commodities"]})
    extras = sorted(referenced - declared) + ["OTHER"]
    prog_ids = {}
    for p in em["programmes"] + [{"id": x, "name": implicit_names.get(x, x.capitalize())}
                                 for x in extras]:
        prog_ids[p["id"]] = add_concept("NHDW-PROGRAMME", p["id"], p["name"], "programme", "Programme")
    for ind in em["indicators"]:
        i = add_concept("NHDW-INDICATOR", ind["id"], ind["name"], "indicator", "Indicator")
        rels.append([i, prog_ids[ind["programme"]], "Has programme", VALID_FROM, VALID_TO, ""])
    comm_ids = {}
    for c in em["commodities"]:
        # PARITY: concept_code = the view's norm_name of the display name
        code = norm_name(c["name"])
        i = add_concept("NHDW-COMMODITY", code, c["name"], "commodity", "Commodity")
        comm_ids[c["id"]] = i
        rels.append([i, prog_ids[c["programme"]], "Has programme", VALID_FROM, VALID_TO, ""])
        add_s2c(c["id"], "NHDW.commodityId", c["name"], i)
        # HCMIS embeds the entity-model commodity id as its native code
        add_s2c(c["id"], "HCMIS.commodityId", c["name"], i)
    for r in em["regions"]:
        add_concept("NHDW-REGION", r["id"], r["name"], "geography", "Region")
    for t in em["facility_tiers"]:
        add_concept("NHDW-TIER", t["id"], t["name"], "facility_type", "Facility Tier")
    for o in sorted(set(ownership_norm.values())):
        add_concept("NHDW-OWNERSHIP", o, o.capitalize(), "ownership", "Ownership")
    disease_ids = {}
    for d in sorted({row["disease"] for row in em["disease_response"]}):
        disease_ids[d] = add_concept("NHDW-DISEASE", d, d, "disease", "Disease")
    for row in em["disease_response"]:
        if row["commodity"] in comm_ids:
            rels.append([disease_ids[row["disease"]], comm_ids[row["commodity"]],
                         "Outbreak response commodity", VALID_FROM, VALID_TO, ""])

    # ── crosswalks from the code-mapping dicts (the lifted build_sample logic) ──
    for tier, mfr_types in tier_mfr.items():
        for mfr_type in sorted(mfr_types):
            add_s2c(mfr_type, "MFR.facilityType", f"MFR type → tier {tier}",
                    cid[("NHDW-TIER", tier)])
    for mfr_region, region_id in sorted(region_name_to_id.items()):
        add_s2c(mfr_region, "MFR.regionName", f"MFR region → {region_id}",
                cid[("NHDW-REGION", region_id)])
    for raw, normed in sorted(ownership_norm.items()):
        add_s2c(raw, "MFR.ownership", f"MFR ownership → {normed}",
                cid[("NHDW-OWNERSHIP", normed)])
    # DHIS2 dataElement → programme: the entity model is authoritative (each
    # indicator carries its programme — this also encodes the HTN-→NCD / NUT-→
    # NUTRITION renames the old view CASE handled by prefix). Codes the entity
    # model cannot know land in supplements/ and merge below.
    for ind in em["indicators"]:
        add_s2c(ind["id"], "DHIS2.dataElement", ind["name"], prog_ids[ind["programme"]])

    # ── supplements (live-derived + future ICD10/ATC curated subsets) ─────────
    for f in sorted(SUPPLEMENTS.glob("*.csv")):
        with open(f, newline="") as fh:
            for row in csv.DictReader(fh):
                key = (row["target_vocabulary_id"], row["target_concept_code"])
                if key not in cid:
                    raise SystemExit(
                        f"{f.name}: target {key} is not a known concept — add it to the "
                        f"entity model (or as a concept supplement) first")
                add_s2c(row["source_code"], row["source_vocabulary_id"],
                        row.get("source_code_description", ""), cid[key],
                        loaded_by=f"supplement:{f.name}")

    reg.save()
    return {
        "vocabulary.csv": [["vocabulary_id", "vocabulary_name", "vocabulary_reference",
                            "vocabulary_version", "is_source_vocabulary"]] + vocabularies,
        "domain.csv": [["domain_id", "domain_name"]] + domains,
        "concept_class.csv": [["concept_class_id", "concept_class_name"]] + classes,
        "concept.csv": [["concept_id", "concept_name", "domain_id", "vocabulary_id",
                         "concept_class_id", "standard_concept", "concept_code",
                         "valid_from", "valid_to", "invalid_reason"]] + concepts,
        "concept_relationship.csv": [["concept_id_1", "concept_id_2", "relationship_id",
                                      "valid_from", "valid_to", "invalid_reason"]] + rels,
        "source_to_concept_map.csv": [["source_code", "source_vocabulary_id",
                                       "source_code_description", "target_concept_id",
                                       "valid_from", "valid_to", "invalid_reason",
                                       "change_source", "loaded_by"]] + list(s2c_map.values()),
    }


def write(files: dict[str, list[list]], out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, rows in files.items():
        with open(out_dir / name, "w", newline="") as fh:
            csv.writer(fh).writerows(rows)


def main() -> int:
    files = build()
    if "--check" in sys.argv:
        import filecmp, tempfile
        with tempfile.TemporaryDirectory() as tmp:
            write(files, Path(tmp))
            bad = [n for n in files
                   if not (BUILD / n).exists()
                   or not filecmp.cmp(BUILD / n, Path(tmp) / n, shallow=False)]
        if bad:
            print(f"STALE: {', '.join(bad)} — rerun build_vocab.py and commit"); return 1
        print("vocab CSVs up to date"); return 0
    write(files, BUILD)
    n = {k: len(v) - 1 for k, v in files.items()}
    print("wrote", BUILD, "—", ", ".join(f"{k.split('.')[0]}={v}" for k, v in n.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
