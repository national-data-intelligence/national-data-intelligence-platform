"""HCMIS WDM table allowlist — populated by 0_external/sources/HCMISWDM/scripts/synthesize.py.

Three logical layers:

    Commodity.*  — master data (catalog, manufacturer, supplier)
    Dim.*        — analytics dimensions (Mode, Program, Item, Environment, Date)
    Fact.*       — analytics facts (DailyRecord, Inventory)
    Vaccine.*    — operational vaccine module (the primary ingestion target per
                   the requirements doc; rest is value-add)

Per primer guidance, the **`Fact.DailyRecord`** table is the canonical
ingestion target for stock-on-hand reporting. Other Fact/Dim/Vaccine tables
provide context for analysis.
"""
from __future__ import annotations

from typing import NamedTuple


class TableSpec(NamedTuple):
    schema: str
    table: str
    cursor: str | None = None

    @property
    def dlt_name(self) -> str:
        return f"{self.schema}_{self.table}".lower()


TABLES: list[TableSpec] = [
    # ── Commodity master ────────────────────────────────────────────────────
    TableSpec("Commodity", "CommodityType"),
    TableSpec("Commodity", "Country"),
    TableSpec("Commodity", "SupplierType"),
    TableSpec("Commodity", "Category"),
    TableSpec("Commodity", "UnitOfIssue"),
    TableSpec("Commodity", "DosageForm"),
    TableSpec("Commodity", "Program"),
    TableSpec("Commodity", "Manufacturer"),
    TableSpec("Commodity", "Supplier"),
    TableSpec("Commodity", "Product"),

    # ── Dim — analytics dimensions ──────────────────────────────────────────
    TableSpec("Dim", "Mode"),
    TableSpec("Dim", "Program"),
    TableSpec("Dim", "Environment"),
    TableSpec("Dim", "Item"),
    TableSpec("Dim", "Date"),

    # ── Fact — analytics facts (canonical ingestion target) ─────────────────
    TableSpec("Fact", "DailyRecord"),
    TableSpec("Fact", "Inventory"),

    # ── Vaccine — operational vaccine module ────────────────────────────────
    TableSpec("Vaccine", "Environment"),
    TableSpec("Vaccine", "Unit"),
    TableSpec("Vaccine", "Item"),
    TableSpec("Vaccine", "Institution"),
    TableSpec("Vaccine", "DailyRecord"),
    TableSpec("Vaccine", "Received"),
    TableSpec("Vaccine", "Issued"),
    TableSpec("Vaccine", "Expired"),
    TableSpec("Vaccine", "PurchaseOrder"),   # procurement pipeline (open POs)
]
