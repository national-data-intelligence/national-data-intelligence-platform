"""Generates docs/diagrams/nhdw-architecture.drawio.

Every node placed on a grid; every edge declares exact exit/entry
coordinates so draw.io routes orthogonally without crossing nodes.
"""
from __future__ import annotations

import html
import textwrap
import xml.sax.saxutils as su
from dataclasses import dataclass, field

# ──────────────────────────────────────────────────────────────────────
# Styles — palette aligned with the NHDW navy / gold / Ethiopian tricolor
# ──────────────────────────────────────────────────────────────────────
STY_TITLE   = "text;html=1;align=center;verticalAlign=middle;whiteSpace=wrap;fontSize=22;fontStyle=1;fontColor=#0F1F3C;"
STY_SUB     = "text;html=1;align=center;fontSize=11;fontColor=#64748B;"
STY_LANE    = "text;html=1;align=left;fontSize=10;fontStyle=1;fontColor=#475569;letterSpacing=2;"

STY_USER    = "rounded=1;arcSize=18;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#0F1F3C;strokeWidth=2;fontSize=11;fontStyle=1;align=center;verticalAlign=middle;"
STY_PORTAL  = "rounded=0;whiteSpace=wrap;html=1;fillColor=#E6ECF6;strokeColor=#1A3057;strokeWidth=1.5;fontSize=11;align=center;verticalAlign=middle;"
STY_API     = "rounded=0;whiteSpace=wrap;html=1;fillColor=#E3F4EC;strokeColor=#078930;strokeWidth=1.5;fontSize=11;align=center;verticalAlign=middle;"
STY_ADMIN   = "rounded=0;whiteSpace=wrap;html=1;fillColor=#FDF1E2;strokeColor=#8B4A17;strokeWidth=1.5;fontSize=11;align=center;verticalAlign=middle;"
STY_MON     = "rounded=0;whiteSpace=wrap;html=1;fillColor=#F1F5F9;strokeColor=#475569;strokeWidth=1.5;fontSize=11;align=center;verticalAlign=middle;"
STY_SEC     = "rounded=0;whiteSpace=wrap;html=1;fillColor=#FFF1F2;strokeColor=#9F1239;strokeWidth=1.5;fontSize=11;fontStyle=1;align=center;verticalAlign=middle;"
STY_ORCH    = "rounded=0;whiteSpace=wrap;html=1;fillColor=#FEF3C7;strokeColor=#92400E;strokeWidth=1.5;fontSize=11;fontStyle=1;align=center;verticalAlign=middle;"
STY_DAG     = "rounded=0;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#92400E;strokeWidth=1;fontSize=10;align=center;verticalAlign=middle;"
STY_PROC    = "rounded=0;whiteSpace=wrap;html=1;fillColor=#EDE9FE;strokeColor=#5B21B6;strokeWidth=1.5;fontSize=11;align=center;verticalAlign=middle;"
STY_STORE   = "shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=14;fillColor=#FEF7E7;strokeColor=#8B4A17;strokeWidth=1.5;fontSize=11;fontStyle=1;align=center;verticalAlign=middle;"
STY_SOURCE  = "rounded=0;whiteSpace=wrap;html=1;fillColor=#EEF1F5;strokeColor=#475569;strokeWidth=1;fontSize=11;align=center;verticalAlign=middle;"
STY_GROUP   = "rounded=0;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#CBD5E1;strokeWidth=1;dashed=1;fontSize=10;fontColor=#64748B;align=left;verticalAlign=top;spacingLeft=8;spacingTop=4;"
STY_NOTE    = "rounded=0;whiteSpace=wrap;html=1;fillColor=#FEF9C3;strokeColor=#CA8A04;strokeWidth=1;fontSize=10;align=left;verticalAlign=top;spacingLeft=8;spacingTop=4;spacingRight=8;"

# Edge variants — orthogonal routing + explicit exit/entry are added per call.
E_SYNC  = "endArrow=classic;html=1;rounded=0;edgeStyle=orthogonalEdgeStyle;jettySize=auto;orthogonalLoop=1;strokeColor=#1A3057;strokeWidth=1.5;fontSize=9;fontColor=#1A3057;"
E_DATA  = "endArrow=classic;html=1;rounded=0;edgeStyle=orthogonalEdgeStyle;jettySize=auto;orthogonalLoop=1;strokeColor=#047857;strokeWidth=2;fontSize=9;fontColor=#065F46;"
E_AUDIT = "endArrow=classic;html=1;rounded=0;edgeStyle=orthogonalEdgeStyle;jettySize=auto;orthogonalLoop=1;strokeColor=#C9A04D;strokeWidth=1;fontSize=9;dashed=1;fontColor=#854D0E;"
E_CRED  = "endArrow=classic;html=1;rounded=0;edgeStyle=orthogonalEdgeStyle;jettySize=auto;orthogonalLoop=1;strokeColor=#9F1239;strokeWidth=1;fontSize=9;dashed=1;fontColor=#9F1239;"
E_FAINT = "endArrow=classic;html=1;rounded=0;edgeStyle=orthogonalEdgeStyle;jettySize=auto;orthogonalLoop=1;strokeColor=#94A3B8;strokeWidth=1;fontSize=9;fontColor=#64748B;"


# ──────────────────────────────────────────────────────────────────────
# Helpers — Diagram + Node + Edge model
# ──────────────────────────────────────────────────────────────────────
@dataclass
class Diagram:
    name: str
    page_w: int = 1700
    page_h: int = 1200
    _cells: list[str] = field(default_factory=list)

    def add(self, snippet: str):
        self._cells.append(snippet)

    def node(self, nid: str, label: str, style: str, x: int, y: int, w: int, h: int):
        v = su.escape(label).replace("\n", "&#10;")
        self.add(f'<mxCell id="{nid}" value="{v}" style="{style}" vertex="1" parent="1">'
                 f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>')

    def group(self, nid: str, label: str, x: int, y: int, w: int, h: int):
        self.node(nid, label, STY_GROUP, x, y, w, h)

    def title(self, nid: str, label: str, x: int, y: int, w: int = 600, h: int = 36):
        self.node(nid, label, STY_TITLE, x, y, w, h)

    def sub(self, nid: str, label: str, x: int, y: int, w: int = 600, h: int = 22):
        self.node(nid, label, STY_SUB, x, y, w, h)

    def lane(self, nid: str, label: str, x: int, y: int, w: int = 200, h: int = 22):
        self.node(nid, label, STY_LANE, x, y, w, h)

    def note(self, nid: str, text: str, x: int, y: int, w: int, h: int):
        self.node(nid, text, STY_NOTE, x, y, w, h)

    def edge(self, eid: str, src: str, tgt: str, style: str,
             label: str = "", exitX: float = 0.5, exitY: float = 1,
             entryX: float = 0.5, entryY: float = 0):
        st = (f"{style}exitX={exitX};exitY={exitY};exitDx=0;exitDy=0;"
              f"entryX={entryX};entryY={entryY};entryDx=0;entryDy=0;")
        v = su.escape(label).replace("\n", "&#10;")
        self.add(f'<mxCell id="{eid}" value="{v}" style="{st}" edge="1" parent="1" '
                 f'source="{src}" target="{tgt}"><mxGeometry relative="1" as="geometry"/></mxCell>')

    def render(self) -> str:
        body = "\n".join(self._cells)
        slug = "".join(c if c.isalnum() else "_" for c in self.name.lower())
        return f'''<diagram id="{slug}" name="{html.escape(self.name)}">
  <mxGraphModel dx="{self.page_w + 200}" dy="{self.page_h + 200}" grid="1" gridSize="10"
                guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1"
                pageWidth="{self.page_w}" pageHeight="{self.page_h}" math="0" shadow="0">
    <root>
      <mxCell id="0"/>
      <mxCell id="1" parent="0"/>
{textwrap.indent(body, "      ")}
    </root>
  </mxGraphModel>
</diagram>'''


def legend(d: Diagram, prefix: str, x: int, y: int):
    """4-line color legend, top-left of any diagram."""
    d.node(f"{prefix}_lg_bg", "Legend", STY_GROUP, x, y, 300, 110)
    d.node(f"{prefix}_lg_sync", "▬ sync request (HTTP / RPC)",
           "text;html=1;fontSize=10;fontColor=#1A3057;align=left;",
           x + 12, y + 22, 280, 16)
    d.node(f"{prefix}_lg_data", "▬ data flow (read / write)",
           "text;html=1;fontSize=10;fontColor=#047857;align=left;",
           x + 12, y + 42, 280, 16)
    d.node(f"{prefix}_lg_creds", "▬ credential / token mint",
           "text;html=1;fontSize=10;fontColor=#9F1239;align=left;",
           x + 12, y + 62, 280, 16)
    d.node(f"{prefix}_lg_audit", "▬ audit event (Loki push)",
           "text;html=1;fontSize=10;fontColor=#854D0E;align=left;",
           x + 12, y + 82, 280, 16)


# ──────────────────────────────────────────────────────────────────────
# Diagram 1 — System Overview
# ──────────────────────────────────────────────────────────────────────
def make_overview() -> Diagram:
    d = Diagram("01 · System Overview", page_w=1800, page_h=1700)
    d.title("o_title", "NHDW · System Overview", 600, 20)
    d.sub("o_sub", "Federal Ministry of Health, Ethiopia — every tier, every flow", 600, 56)

    # Row 1: PERSONAS
    d.lane("o_lane1", "USERS",                                40, 110)
    d.node("u_pub",    "Public Citizens\n(anonymous · Fayda)",      STY_USER,  60, 140, 200, 60)
    d.node("u_staff",  "MoH Staff\nR-DEC · R-CONS-* · R-STEW · R-PROD-SUBMIT", STY_USER, 320, 140, 360, 60)
    d.node("u_ops",    "Privileged Operators\nR-OPS-ENG · R-OPS-ADM · R-OPS-SEC", STY_USER, 740, 140, 320, 60)
    d.node("u_ext",    "External producers\nDHIS2 · HMIS clerks · partners",     STY_USER, 1120, 140, 280, 60)

    # Row 2: PORTAL / ENTRY
    d.lane("o_lane2", "ENTRY",                                40, 240)
    d.node("ap_portal","Public Portal\n:8088 (anonymous)",                       STY_PORTAL, 60,  270, 200, 56)
    d.node("ap_data",  "Public Data\n:8088/data (k-anon tiles)",                 STY_PORTAL, 290, 270, 200, 56)
    d.node("ap_surf",  "Access-points registry\n:8088/surfaces",                 STY_PORTAL, 520, 270, 200, 56)

    # Row 3: ACCESS POINTS (OIDC-gated)
    d.lane("o_lane3", "ACCESS POINTS · moh-staff realm",      40, 350)
    d.node("ap_ibi",   "Internal BI\n:8087 (manifest-driven)",   STY_PORTAL, 60,   380, 200, 60)
    d.node("ap_sub",   "Submission Portal\n:8089",               STY_PORTAL, 290,  380, 200, 60)
    d.node("ap_dbt",   "dbt Docs\n:8097",                        STY_PORTAL, 520,  380, 200, 60)
    d.node("ap_ml",    "ML Inference\n:8098 (Bearer)",           STY_API,    750,  380, 200, 60)
    d.node("ap_jh",    "Jupyter Workspace\n:8096",               STY_PORTAL, 980,  380, 200, 60)
    d.node("ap_fhir",  "FHIR R4 API\n:8093 (HAPI)",              STY_API,    1210, 380, 200, 60)

    d.lane("o_lane4", "ACCESS POINTS · privileged-ops realm",   40, 460)
    d.node("ap_ops",   "Operator Hub\n:8085",                    STY_ADMIN, 60,    490, 200, 60)
    d.node("ap_cb",    "CloudBeaver\n:8086",                     STY_ADMIN, 290,   490, 200, 60)
    d.node("ap_graf",  "Grafana\n:3000",                         STY_MON,   520,   490, 200, 60)
    d.node("ap_prom",  "Prometheus\n:9090",                      STY_MON,   750,   490, 200, 60)
    d.node("ap_oh",    "OpenHIM Console\n:8095",                 STY_ADMIN, 980,   490, 200, 60)
    d.node("ap_af",    "Airflow UI\n:8084",                      STY_ADMIN, 1210,  490, 200, 60)
    d.node("ap_minio", "MinIO Console\n:9101",                   STY_ADMIN, 1440,  490, 200, 60)

    # Row 4: IDENTITY + AUTHZ + AUDIT
    d.lane("o_lane5", "IDENTITY · AUTHZ · AUDIT",            40, 580)
    d.node("s_fayda", "Fake Fayda\n:8092 (Citizen IdP)",        STY_SEC,  60,  610, 200, 60)
    d.node("s_kc",    "Keycloak :8090\nmoh-staff · privileged-ops\n+ nhdw-flat-roles scope", STY_SEC,  290, 600, 320, 90)
    d.node("s_bao",   "OpenBao :8200\nKV · DB engine · PKI · JWT auth",          STY_SEC,  640, 600, 280, 90)
    d.node("s_opa",   "OPA :8181\n(Policy decision)",                            STY_SEC,  950, 610, 200, 70)
    d.node("s_loki",  "Loki :3100\n(Audit + log stream)",                        STY_SEC,  1180,610, 200, 70)

    # Row 5: ORCHESTRATOR
    d.lane("o_lane6", "ORCHESTRATION",                       40, 730)
    d.node("o_af",   "Apache Airflow\n(LocalExecutor + Postgres metadata)", STY_ORCH, 60,  760, 280, 70)
    d.node("dag_st",  "DAG · staging_daily",       STY_DAG,  360, 760, 200, 30)
    d.node("dag_vl",  "DAG · vault_daily",         STY_DAG,  360, 800, 200, 30)
    d.node("dag_mr",  "DAG · marts_daily",         STY_DAG,  580, 760, 200, 30)
    d.node("dag_pr",  "DAG · marts_promote",       STY_DAG,  580, 800, 200, 30)
    d.node("dag_co",  "DAG · consent_extract",     STY_DAG,  800, 760, 200, 30)
    d.node("dag_ml",  "DAG · ml_promote_to_staging",STY_DAG, 800, 800, 240, 30)

    # Row 6: PROCESSING
    d.lane("o_lane7", "PROCESSING",                          40, 870)
    d.node("p_dbt",   "dbt-marts project\n(2_pipelines/marts)",            STY_PROC, 60,  900, 240, 60)
    d.node("p_med",   "FHIR Mediator\n(OpenHIM · CSV→FHIR transform)",      STY_PROC, 340, 900, 280, 60)
    d.node("p_mlpipe","ML training pipeline\nfacility-activity-classifier",STY_PROC, 660, 900, 280, 60)
    d.node("p_oh",    "OpenHIM core\n(channels: HMIS, EPI, Stock)",         STY_PROC, 980, 900, 280, 60)

    # Row 7: STORAGE
    d.lane("o_lane8", "STORAGE",                             40, 1000)
    d.node("st_pg",   "postgres-vault :5432\nschemas: nhdw_landing · nhdw_vault_raw · nhdw_vault_business · bi_facility · bi_programme · bi_public · bi_staging · fhir_resources · keycloak_metadata · mlflow_metadata",
           STY_STORE, 60, 1040, 480, 110)
    d.node("st_ch",   "ClickHouse :8123\nnhdw_staging",                                   STY_STORE, 580, 1040, 220, 80)
    d.node("st_mi",   "MinIO :9000/9001\nbuckets: nhdw-landing · nhdw-data-lake · nhdw-ml-artifacts", STY_STORE, 840, 1040, 320, 80)
    d.node("st_mlf",  "MLflow :5000\ntracking + registry",                                STY_STORE, 1200, 1040, 240, 80)

    # Row 8: SOURCES
    d.lane("o_lane9", "SOURCE SYSTEMS",                      40, 1190)
    d.node("src_ee",  "EthioEMR\n(Postgres replica)",           STY_SOURCE, 60,  1220, 220, 60)
    d.node("src_mb",  "mBrana\n(MySQL replica)",                STY_SOURCE, 300, 1220, 220, 60)
    d.node("src_hc",  "HCMIS-WDM\n(MSSQL replica)",             STY_SOURCE, 540, 1220, 220, 60)
    d.node("src_d2",  "DHIS2\n(REST API + Postgres analytics)", STY_SOURCE, 780, 1220, 220, 60)

    legend(d, "o", 1450, 130)

    # ── EDGES — sync (user → access) ─────────────────────────────────
    d.edge("e1",  "u_pub",   "ap_portal", E_SYNC, "browse")
    d.edge("e2",  "u_staff", "ap_ibi",    E_SYNC, "OIDC", exitX=0.3, entryX=0.5)
    d.edge("e3",  "u_staff", "ap_sub",    E_SYNC, "",      exitX=0.5, entryX=0.5)
    d.edge("e4",  "u_staff", "ap_dbt",    E_SYNC, "",      exitX=0.7, entryX=0.5)
    d.edge("e5",  "u_staff", "ap_jh",     E_SYNC, "",      exitX=0.9, entryX=0.3)
    d.edge("e6",  "u_ops",   "ap_ops",    E_SYNC, "OIDC",  exitX=0.2, entryX=0.5)
    d.edge("e7",  "u_ops",   "ap_graf",   E_SYNC, "",      exitX=0.4, entryX=0.5)
    d.edge("e8",  "u_ops",   "ap_af",     E_SYNC, "",      exitX=0.7, entryX=0.5)
    d.edge("e9",  "u_ext",   "ap_sub",    E_SYNC, "POST CSV/FHIR", exitX=0.1, entryX=0.7)
    d.edge("e10", "u_ext",   "ap_fhir",   E_SYNC, "POST Bundle",   exitX=0.5, entryX=0.5)

    # access → KC (OIDC)
    d.edge("e20", "ap_ibi",  "s_kc", E_SYNC, "OIDC", exitX=0.5, entryX=0.1)
    d.edge("e21", "ap_sub",  "s_kc", E_SYNC, "",      exitX=0.5, entryX=0.3)
    d.edge("e22", "ap_dbt",  "s_kc", E_SYNC, "",      exitX=0.5, entryX=0.4)
    d.edge("e23", "ap_jh",   "s_kc", E_SYNC, "",      exitX=0.5, entryX=0.7)
    d.edge("e24", "ap_ml",   "s_kc", E_SYNC, "Bearer", exitX=0.5, entryX=0.6)
    d.edge("e25", "ap_ops",  "s_kc", E_SYNC, "OIDC",  exitX=0.2, entryX=0.2)
    d.edge("e26", "ap_graf", "s_kc", E_SYNC, "",      exitX=0.5, entryX=0.5)
    d.edge("e27", "u_pub",   "s_fayda", E_SYNC, "(if Fayda login)", exitX=0.4, entryX=0.5)

    # fayda → KC (federated IdP)
    d.edge("e28", "s_fayda", "s_kc", E_SYNC, "federated IdP", exitX=1, exitY=0.5, entryX=0, entryY=0.5)

    # access → OpenBao (mint short-TTL DB cred)
    d.edge("e30", "ap_ibi",  "s_bao", E_CRED, "JWT → pg cred", exitX=0.7, entryX=0.1)
    d.edge("e31", "ap_data", "s_bao", E_CRED, "pg cred (bi-reader)", exitX=0.5, entryX=0.2)
    d.edge("e32", "ap_jh",   "s_bao", E_CRED, "JWT → pg cred",  exitX=0.7, entryX=0.5)
    d.edge("e33", "ap_cb",   "s_bao", E_CRED, "pg/ch cred",     exitX=0.5, entryX=0.4)

    # access → OPA (policy decide)
    d.edge("e40", "ap_ibi",  "s_opa", E_SYNC, "decide", exitX=0.85, entryX=0.5)
    d.edge("e41", "ap_sub",  "s_opa", E_SYNC, "",        exitX=0.85, entryX=0.3)
    d.edge("e42", "ap_ml",   "s_opa", E_SYNC, "",        exitX=0.85, entryX=0.7)

    # access → Loki audit
    d.edge("e50", "ap_ibi",  "s_loki", E_AUDIT, "AuditEvent", exitX=1, entryX=0.1)
    d.edge("e51", "ap_data", "s_loki", E_AUDIT, "",            exitX=0.9, entryX=0.2)
    d.edge("e52", "ap_sub",  "s_loki", E_AUDIT, "",            exitX=1, entryX=0.3)
    d.edge("e53", "ap_ml",   "s_loki", E_AUDIT, "",            exitX=1, entryX=0.6)
    d.edge("e54", "ap_dbt",  "s_loki", E_AUDIT, "",            exitX=1, entryX=0.4)
    d.edge("e55", "ap_fhir", "s_loki", E_AUDIT, "",            exitX=0.5, entryX=0.9)
    d.edge("e56", "ap_oh",   "s_loki", E_AUDIT, "",            exitX=0.5, entryX=0.7)

    # access → storage (reads)
    d.edge("e60", "ap_ibi",  "st_pg",  E_DATA, "SELECT marts", exitX=0.4, entryX=0.1)
    d.edge("e61", "ap_data", "st_pg",  E_DATA, "SELECT bi_public", exitX=0.5, entryX=0.05)
    d.edge("e62", "ap_fhir", "st_pg",  E_DATA, "Resource read/write", exitX=0.5, entryX=0.7)
    d.edge("e63", "ap_jh",   "st_pg",  E_DATA, "",                    exitX=0.4, entryX=0.4)
    d.edge("e64", "ap_jh",   "st_ch",  E_DATA, "",                    exitX=0.6, entryX=0.4)
    d.edge("e65", "ap_ml",   "st_mlf", E_DATA, "load model",          exitX=0.5, entryX=0.5)
    d.edge("e66", "ap_ml",   "st_mi",  E_DATA, "model artifacts",     exitX=0.5, entryX=0.5)
    d.edge("e67", "ap_cb",   "st_pg",  E_DATA, "ad-hoc SQL",          exitX=0.5, entryX=0.2)
    d.edge("e68", "ap_cb",   "st_ch",  E_DATA, "",                    exitX=0.5, entryX=0.2)
    d.edge("e69", "ap_minio","st_mi",  E_DATA, "",                    exitX=0.5, entryX=0.7)

    # submission flow
    d.edge("e70", "ap_sub",  "p_oh",   E_DATA, "POST channel", exitX=0.5, entryX=0.2)
    d.edge("e71", "p_oh",    "p_med",  E_DATA, "route /validate", exitX=0, exitY=0.5, entryX=1, entryY=0.5)
    d.edge("e72", "p_med",   "ap_fhir",E_DATA, "transaction Bundle", exitX=0.5, exitY=0, entryX=0.5, entryY=1)

    # Airflow → DAGs (group)
    d.edge("e80", "o_af", "dag_st", E_FAINT, "", exitX=1, exitY=0.2, entryX=0, entryY=0.5)
    d.edge("e81", "o_af", "dag_vl", E_FAINT, "", exitX=1, exitY=0.4, entryX=0, entryY=0.5)
    d.edge("e82", "o_af", "dag_mr", E_FAINT, "", exitX=1, exitY=0.5, entryX=0, entryY=0.5)
    d.edge("e83", "o_af", "dag_pr", E_FAINT, "", exitX=1, exitY=0.6, entryX=0, entryY=0.5)
    d.edge("e84", "o_af", "dag_co", E_FAINT, "", exitX=1, exitY=0.7, entryX=0, entryY=0.5)
    d.edge("e85", "o_af", "dag_ml", E_FAINT, "", exitX=1, exitY=0.85,entryX=0, entryY=0.5)

    # DAGs → processing → storage
    d.edge("e90",  "dag_st", "p_dbt",   E_DATA, "",          exitX=0.2, entryX=0.6)
    d.edge("e91",  "dag_vl", "p_dbt",   E_DATA, "dbt build",  exitX=0.4, entryX=0.4)
    d.edge("e92",  "dag_mr", "p_dbt",   E_DATA, "",           exitX=0.6, entryX=0.7)
    d.edge("e93",  "dag_ml", "p_mlpipe",E_DATA, "train + log",exitX=0.5, entryX=0.5)
    d.edge("e94",  "dag_co", "ap_fhir", E_DATA, "pull Consent",exitX=0.5, exitY=0, entryX=0.5, entryY=1)

    d.edge("e100", "p_dbt", "st_pg",    E_DATA, "ALTER VIEW", exitX=0.5, entryX=0.1)
    d.edge("e101", "p_dbt", "st_ch",    E_DATA, "",            exitX=0.7, entryX=0.3)
    d.edge("e102", "p_mlpipe","st_mlf", E_DATA, "log model",  exitX=0.5, entryX=0.5)
    d.edge("e103", "p_mlpipe","st_mi",  E_DATA, "artifacts",   exitX=0.3, entryX=0.7)

    # sources → DAGs (pull) — keep as ingestion edges
    d.edge("e110", "src_ee", "p_dbt",   E_DATA, "EHR pull", exitX=0.5, exitY=0, entryX=0.2, entryY=1)
    d.edge("e111", "src_mb", "p_dbt",   E_DATA, "mBrana",    exitX=0.5, exitY=0, entryX=0.4, entryY=1)
    d.edge("e112", "src_hc", "p_dbt",   E_DATA, "HCMIS",     exitX=0.5, exitY=0, entryX=0.6, entryY=1)
    d.edge("e113", "src_d2", "p_dbt",   E_DATA, "DHIS2",     exitX=0.5, exitY=0, entryX=0.8, entryY=1)

    # Prometheus scrapes
    d.edge("e120", "ap_prom", "ap_ml",   E_AUDIT, "scrape /metrics", exitX=0.4, entryX=0.7)
    d.edge("e121", "ap_prom", "s_kc",    E_AUDIT, "",                 exitX=0.6, entryX=0.7)
    d.edge("e122", "ap_prom", "st_ch",   E_AUDIT, "",                 exitX=0.8, entryX=0.5)
    d.edge("e123", "ap_graf", "ap_prom", E_DATA, "PromQL",  exitX=0.5, entryX=0.5)
    d.edge("e124", "ap_graf", "s_loki",  E_DATA, "LogQL",   exitX=0.7, entryX=0.7)

    return d


# ──────────────────────────────────────────────────────────────────────
# Diagram 2 — OIDC sign-in + OpenBao token exchange
# ──────────────────────────────────────────────────────────────────────
def make_authflow() -> Diagram:
    d = Diagram("02 · Identity & Token Exchange", page_w=1500, page_h=900)
    d.title("a_title", "Sign-in & OpenBao token exchange", 450, 20)
    d.sub("a_sub", "OIDC against Keycloak → flat 'roles' claim → JWT-keycloak login → short-TTL Postgres credential", 200, 56, w=1100)

    # Actors (left → right columns, vertical sequence)
    d.node("user",   "Browser\n(Staff user)",            STY_USER,    60, 120, 160, 60)
    d.node("ibi",    "Internal BI :8087",                STY_PORTAL,  280, 120, 200, 60)
    d.node("kc",     "Keycloak :8090\nmoh-staff realm",  STY_SEC,     560, 120, 240, 60)
    d.node("bao",    "OpenBao :8200\njwt-keycloak auth", STY_SEC,     860, 120, 240, 60)
    d.node("pg",     "postgres-vault :5432",             STY_STORE,   1160, 120, 240, 60)
    d.node("loki",   "Loki :3100",                       STY_SEC,     1160, 220, 240, 50)

    # Sequence numbers — visible as labels on edges
    d.edge("a_e1",  "user", "ibi",  E_SYNC, "1. GET / (no session)",  exitX=1, exitY=0.5, entryX=0, entryY=0.5)
    # The 307 redirect
    d.node("a_n1",  "2. 307 → /login",                   STY_NOTE,    230, 200, 320, 30)
    d.edge("a_e2",  "ibi",  "user", E_SYNC, "3. 307 redirect to KC",  exitX=0, exitY=0.7, entryX=1, entryY=0.7)
    d.edge("a_e3",  "user", "kc",   E_SYNC, "4. GET /auth?response_type=code", exitX=1, exitY=0.3, entryX=0, entryY=0.3)
    d.edge("a_e4",  "kc",   "user", E_SYNC, "5. login form + 302 ?code=...",   exitX=0, exitY=0.7, entryX=1, entryY=0.3)
    d.edge("a_e5",  "user", "ibi",  E_SYNC, "6. /callback?code=...",  exitX=1, exitY=0.5, entryX=0, entryY=0.5)
    d.edge("a_e6",  "ibi",  "kc",   E_SYNC, "7. token-endpoint exchange (code → JWT)", exitX=1, exitY=0.3, entryX=0, entryY=0.5)
    d.edge("a_e7",  "kc",   "ibi",  E_SYNC, "8. access_token w/ roles · geographies · programs", exitX=0, exitY=0.7, entryX=1, entryY=0.5)
    d.edge("a_e8",  "ibi",  "user", E_SYNC, "9. Set-Cookie session + 302 /", exitX=0.2, exitY=0, entryX=0.7, entryY=0)

    # token exchange
    d.node("a_box",  "▸ At first data request:",
           "text;html=1;fontSize=11;fontStyle=2;fontColor=#0F1F3C;align=left;",
           50, 320, 400, 24)

    d.edge("a_e10", "ibi",  "bao", E_CRED, "10. POST /v1/auth/jwt-keycloak/login\nbody = {role: r-cons-ana, jwt: <KC access_token>}",
           exitX=1, exitY=0.7, entryX=0, entryY=0.3)
    d.edge("a_e11", "bao",  "kc",  E_SYNC, "11. verify JWT (JWKS)", exitX=0.5, exitY=0, entryX=1, entryY=0.8)
    d.edge("a_e12", "bao",  "ibi", E_CRED, "12. child token + lease", exitX=0, exitY=0.7, entryX=1, entryY=0.7)
    d.edge("a_e13", "ibi",  "bao", E_CRED, "13. GET /v1/database/creds/postgres-vault-bi-reader", exitX=0.7, exitY=0, entryX=0.3, entryY=1)
    d.edge("a_e14", "bao",  "ibi", E_CRED, "14. {username,password,ttl=10m}", exitX=0.3, exitY=1, entryX=0.7, entryY=0)
    d.edge("a_e15", "ibi",  "pg",  E_DATA, "15. CREATE pool · SELECT bi_facility.*", exitX=1, exitY=0.5, entryX=0, entryY=0.5)

    # audit out
    d.edge("a_e20", "ibi",  "loki", E_AUDIT, "AuditEvent { user, role, resource, outcome }", exitX=1, exitY=0.8, entryX=0, entryY=0.5)

    # Notes
    d.note("a_note1", "OpenBao verifies the KC JWT against its JWKS.\n"
                     "bound_claims = { roles: ['R-CONS-ANA'] } — that's why P5.1.1 needed a FLAT 'roles' claim.",
           450, 320, 600, 70)

    legend(d, "a", 50, 60)
    return d


# ──────────────────────────────────────────────────────────────────────
# Diagram 3 — Data ingestion: sources → vault → marts
# ──────────────────────────────────────────────────────────────────────
def make_pipeline() -> Diagram:
    d = Diagram("03 · Data Pipeline", page_w=1700, page_h=1000)
    d.title("p_t", "Data pipeline · Sources → Landing → Vault → Marts → Surfaces", 450, 20)

    # Top row — sources
    d.node("p_ee", "EthioEMR\nPG replica",  STY_SOURCE, 60,  100, 180, 60)
    d.node("p_mb", "mBrana\nMySQL replica", STY_SOURCE, 280, 100, 180, 60)
    d.node("p_hc", "HCMIS-WDM\nMSSQL",      STY_SOURCE, 500, 100, 180, 60)
    d.node("p_d2", "DHIS2\nREST",           STY_SOURCE, 720, 100, 180, 60)
    d.node("p_oh", "OpenHIM mediator\nCSV/FHIR uploads", STY_PROC, 980, 100, 280, 60)

    # Airflow orchestrator on the right
    d.node("p_af", "Airflow\nLocalExecutor", STY_ORCH, 1380, 100, 220, 60)

    # Ingestion DAGs
    d.node("p_dag1", "staging_daily DAG\nextract → CH staging", STY_DAG, 60,  230, 380, 50)
    d.node("p_dag2", "vault_daily DAG\nload → vault_raw → vault_business", STY_DAG, 480, 230, 380, 50)
    d.node("p_dag3", "marts_daily DAG\ndbt build → bi_facility / bi_programme / bi_public", STY_DAG, 900, 230, 460, 50)

    # Storage row 1: staging
    d.node("p_ch",  "ClickHouse\nnhdw_staging",        STY_STORE, 60,  330, 280, 70)
    d.node("p_mi",  "MinIO\nnhdw-landing bucket",      STY_STORE, 370, 330, 280, 70)

    # Storage row 2: vault
    d.node("p_pgL", "postgres-vault\nnhdw_landing",              STY_STORE, 60,  440, 260, 70)
    d.node("p_pgR", "postgres-vault\nnhdw_vault_raw",            STY_STORE, 340, 440, 260, 70)
    d.node("p_pgB", "postgres-vault\nnhdw_vault_business",       STY_STORE, 620, 440, 260, 70)
    d.node("p_pgF", "postgres-vault\nbi_facility · bi_programme",STY_STORE, 900, 440, 320, 70)
    d.node("p_pgP", "postgres-vault\nbi_public (k≥5 only)",      STY_STORE, 1240,440, 280, 70)

    # Storage row 3: ML side
    d.node("p_mlf",   "MLflow tracking + registry",   STY_STORE, 60,  560, 280, 60)
    d.node("p_miML",  "MinIO\nnhdw-ml-artifacts",      STY_STORE, 370, 560, 280, 60)

    # Consumers
    d.node("p_ibi",   "Internal BI :8087",      STY_PORTAL, 60,   680, 200, 50)
    d.node("p_pub",   "Public Dashboard :8088", STY_PORTAL, 280,  680, 200, 50)
    d.node("p_mls",   "ML Serving :8098",       STY_API,    500,  680, 200, 50)
    d.node("p_jh",    "Jupyter :8096",          STY_PORTAL, 720,  680, 200, 50)

    # secondary: consent extractor + mediator → fhir resources
    d.node("p_co",   "consent_extract DAG\n(every 5 min)", STY_DAG, 980, 680, 280, 50)
    d.node("p_fr",   "postgres-vault\nfhir_resources (HAPI)", STY_STORE, 1280, 680, 280, 60)
    d.node("p_cr",   "postgres-vault.consent_revocations", STY_STORE, 1280, 560, 280, 50)

    legend(d, "p", 1370, 30)

    # Airflow → DAGs
    d.edge("p_e1", "p_af", "p_dag1", E_FAINT, "trigger", exitX=0.1, exitY=1, entryX=0.9, entryY=0.5)
    d.edge("p_e2", "p_af", "p_dag2", E_FAINT, "",        exitX=0.3, exitY=1, entryX=0.9, entryY=0.5)
    d.edge("p_e3", "p_af", "p_dag3", E_FAINT, "",        exitX=0.5, exitY=1, entryX=0.9, entryY=0.5)
    d.edge("p_e4", "p_af", "p_co",   E_FAINT, "",        exitX=0.7, exitY=1, entryX=1, entryY=0.5)

    # sources → staging
    d.edge("p_e10", "p_ee", "p_dag1", E_DATA, "",       exitX=0.3, entryX=0.05)
    d.edge("p_e11", "p_mb", "p_dag1", E_DATA, "",       exitX=0.3, entryX=0.2)
    d.edge("p_e12", "p_hc", "p_dag1", E_DATA, "",       exitX=0.3, entryX=0.4)
    d.edge("p_e13", "p_d2", "p_dag1", E_DATA, "",       exitX=0.3, entryX=0.6)
    d.edge("p_e14", "p_oh", "p_pgL",  E_DATA, "Bundle", exitX=0.5, entryX=0.5)

    # staging → CH/MinIO
    d.edge("p_e20", "p_dag1", "p_ch", E_DATA, "raw load",   exitX=0.3, entryX=0.5)
    d.edge("p_e21", "p_dag1", "p_mi", E_DATA, "raw archive",exitX=0.7, entryX=0.5)

    # CH → vault
    d.edge("p_e30", "p_ch", "p_pgL", E_DATA, "promote", exitX=0.5, entryX=0.5)
    d.edge("p_e31", "p_dag2", "p_pgR", E_DATA, "dbt build raw",      exitX=0.5, entryX=0.5)
    d.edge("p_e32", "p_pgR", "p_pgB", E_DATA, "vault_business",      exitX=1, exitY=0.5, entryX=0, entryY=0.5)
    d.edge("p_e33", "p_dag3", "p_pgF", E_DATA, "dbt → bi marts",     exitX=0.5, entryX=0.5)
    d.edge("p_e34", "p_pgF", "p_pgP",  E_DATA, "promote (k≥5)",      exitX=1, exitY=0.5, entryX=0, entryY=0.5)

    # Consent flow
    d.edge("p_e40", "p_co", "p_fr",   E_DATA, "GET Consent", exitX=1, exitY=0.5, entryX=0, entryY=0.5)
    d.edge("p_e41", "p_co", "p_cr",   E_DATA, "INSERT revocations", exitX=0.5, exitY=0, entryX=0.5, entryY=1)
    d.edge("p_e42", "p_cr", "p_pgB",  E_DATA, "consent_gate()", exitX=0, exitY=0.5, entryX=1, entryY=0.5)

    # Consumers ← marts
    d.edge("p_e50", "p_pgF", "p_ibi", E_DATA, "bi_facility.*", exitX=0.1, exitY=1, entryX=0.5, entryY=0)
    d.edge("p_e51", "p_pgP", "p_pub", E_DATA, "bi_public.*",   exitX=0.2, exitY=1, entryX=0.5, entryY=0)
    d.edge("p_e52", "p_pgB", "p_jh",  E_DATA, "ad-hoc query",  exitX=0.7, exitY=1, entryX=0.5, entryY=0)

    # ML pipeline subgraph
    d.edge("p_e60", "p_pgB", "p_mlf", E_DATA, "training data", exitX=0.2, exitY=1, entryX=0.7, entryY=0)
    d.edge("p_e61", "p_mlf", "p_miML",E_DATA, "log artifacts", exitX=0.7, exitY=0.5, entryX=0, entryY=0.5)
    d.edge("p_e62", "p_mlf", "p_mls", E_DATA, "load model",    exitX=0.4, exitY=1, entryX=0.5, entryY=0)
    d.edge("p_e63", "p_miML","p_mls", E_DATA, "artifacts",     exitX=0.5, exitY=1, entryX=0.3, entryY=0)

    return d


# ──────────────────────────────────────────────────────────────────────
# Diagram 4 — Submission flow (CSV / FHIR upload)
# ──────────────────────────────────────────────────────────────────────
def make_submission() -> Diagram:
    d = Diagram("04 · Submission Flow", page_w=1500, page_h=800)
    d.title("s_t", "Submission flow — CSV / FHIR Bundle → HAPI", 400, 20)
    d.sub("s_sub", "Producer uploads → OpenHIM channel → FHIR mediator validates + transforms → HAPI persists", 200, 56, w=1100)

    # Lane labels
    d.node("s_p1", "PRODUCER",     STY_LANE, 60, 100, 180, 20)
    d.node("s_p2", "ACCESS POINT", STY_LANE, 280,100, 180, 20)
    d.node("s_p3", "MEDIATION",    STY_LANE, 540,100, 280, 20)
    d.node("s_p4", "STORAGE",      STY_LANE, 1080,100,180, 20)
    d.node("s_p5", "AUDIT",        STY_LANE, 1290,100,180, 20)

    # Sequence vertical
    d.node("s_u",     "submit.dev\nR-PROD-SUBMIT",         STY_USER,   60,  140, 160, 60)
    d.node("s_sp",    "Submission Portal :8089",            STY_PORTAL, 280, 140, 220, 60)
    d.node("s_oh",    "OpenHIM core :5000\n3 channels",     STY_PROC,   540, 140, 240, 60)
    d.node("s_med",   "FHIR Mediator\n/validate/{slug}",     STY_PROC,   540, 250, 240, 60)
    d.node("s_hapi",  "HAPI FHIR :8093",                     STY_API,    540, 360, 240, 60)
    d.node("s_pg",    "postgres-vault\nfhir_resources",      STY_STORE,  1080,360, 220, 60)
    d.node("s_inbox", "postgres-vault\nnhdw_landing.submission_inbox", STY_STORE, 1080, 140, 220, 70)
    d.node("s_loki",  "Loki :3100",                          STY_SEC,    1290,250, 180, 50)
    d.node("s_oh_db", "OpenHIM mongo\n(transactions)",       STY_STORE,  790, 250, 240, 60)

    # ─── flow ────────
    d.edge("s_e1", "s_u",   "s_sp",   E_SYNC, "1. drop CSV / Bundle (OIDC session)", exitX=1, entryX=0)
    d.edge("s_e2", "s_sp",  "s_inbox",E_DATA, "2. INSERT row (pending)", exitX=1, exitY=0.3, entryX=0, entryY=0.5)
    d.edge("s_e3", "s_sp",  "s_oh",   E_SYNC, "3. POST /hmis | /epi | /stock\n   header: Authorization: Custom <channel-token>", exitX=1, exitY=0.7, entryX=0, entryY=0.5)
    d.edge("s_e4", "s_oh",  "s_oh_db",E_AUDIT,"4. log transaction",      exitX=1, exitY=0.5, entryX=0, entryY=0.5)
    d.edge("s_e5", "s_oh",  "s_med",  E_DATA, "5. route /validate/<slug>", exitX=0.5, exitY=1, entryX=0.5, entryY=0)
    d.edge("s_e6", "s_med", "s_hapi", E_DATA, "6. transaction Bundle", exitX=0.5, exitY=1, entryX=0.5, entryY=0)
    d.edge("s_e7", "s_hapi","s_pg",   E_DATA, "7. persist Resources",  exitX=1, exitY=0.5, entryX=0, entryY=0.5)
    d.edge("s_e8", "s_hapi","s_med",  E_DATA, "8. 201 + Bundle response", exitX=0.3, exitY=0, entryX=0.3, entryY=1)
    d.edge("s_e9", "s_med", "s_oh",   E_DATA, "9. response relay",     exitX=0.3, exitY=0, entryX=0.3, entryY=1)
    d.edge("s_e10","s_oh",  "s_sp",   E_DATA, "10. OpenHIM transaction id",exitX=0, exitY=0.7, entryX=1, entryY=0.7)
    d.edge("s_e11","s_sp",  "s_inbox",E_DATA, "11. UPDATE row (accepted + txn_id)", exitX=1, exitY=0.5, entryX=0, entryY=0.7)
    d.edge("s_e12","s_sp",  "s_u",    E_SYNC, "12. UI: 'submission accepted'", exitX=0, exitY=0.5, entryX=1, entryY=0.5)

    # audit
    d.edge("s_e20","s_sp",  "s_loki", E_AUDIT, "AuditEvent (submit)", exitX=0.9, exitY=0, entryX=0.4, entryY=0)
    d.edge("s_e21","s_med", "s_loki", E_AUDIT, "AuditEvent (validate)", exitX=1, exitY=0.5, entryX=0, entryY=0.5)
    d.edge("s_e22","s_hapi","s_loki", E_AUDIT, "AuditEvent (resource write)", exitX=1, exitY=0.5, entryX=0, entryY=0.9)

    legend(d, "s", 40, 30)
    return d


# ──────────────────────────────────────────────────────────────────────
# Diagram 5 — Internal BI request lifecycle (per-component permission)
# ──────────────────────────────────────────────────────────────────────
def make_ibi() -> Diagram:
    d = Diagram("05 · Internal BI Request Lifecycle", page_w=1600, page_h=950)
    d.title("i_t", "Internal BI — page render + per-component permission", 400, 20)
    d.sub("i_sub", "Manifest-driven: each component declares allowed_roles + program_code + OPA requires{}", 200, 56, w=1100)

    d.node("i_u",   "dec.dev or analyst.dev or stew.dev",        STY_USER,    60,  110, 240, 50)
    d.node("i_app", "Internal BI app :8087\n(FastAPI)",          STY_PORTAL,  60,  200, 240, 60)
    d.node("i_res", "resolver (shared package)\nrender_page() + fetch_component()", STY_PROC, 340, 200, 320, 60)
    d.node("i_reg", "Registry (YAML)\n_shared/registry/{components,pages,landings}", STY_PROC, 700, 200, 320, 60)
    d.node("i_opa", "OPA :8181",                                 STY_SEC,     1060,200, 200, 60)
    d.node("i_loki","Loki :3100",                                STY_SEC,     1300,200, 200, 60)

    d.node("i_bao", "OpenBao :8200",                              STY_SEC,     1060,310, 200, 60)
    d.node("i_pg",  "postgres-vault\nbi_facility · bi_programme", STY_STORE,   1300,310, 280, 70)

    # The data-source handlers
    d.node("i_h1",  "handler: postgres-marts\n(build_pg_select)",   STY_PROC,  60,  340, 240, 70)
    d.node("i_h2",  "handler: dataset-catalog",                     STY_PROC,  340, 340, 240, 70)
    d.node("i_h3",  "handler: loki-audit",                          STY_PROC,  620, 340, 240, 70)
    d.node("i_h4",  "handler: mlflow-models",                       STY_PROC,  900, 340, 240, 70)
    d.node("i_h5",  "handler: synthetic",                           STY_PROC,  1180,340, 200, 70)

    # render output
    d.node("i_br",  "Browser",                                      STY_USER,  60,  480, 240, 50)
    d.node("i_html","Page shell HTML\n(Alpine.js + ECharts)",       STY_PORTAL,60,  560, 240, 60)
    d.node("i_api", "/api/page → manifest\n/api/component/{id}/data → ECharts payload", STY_PORTAL, 340, 560, 380, 70)

    legend(d, "i", 1390, 30)

    # ── flows ──
    d.edge("i_e1",  "i_u",   "i_app", E_SYNC,  "1. GET /  (session cookie)", exitX=0.5, exitY=1, entryX=0.5, entryY=0)
    d.edge("i_e2",  "i_app", "i_res", E_SYNC,  "2. render_page(page_id, user)", exitX=1, exitY=0.5, entryX=0, entryY=0.5)
    d.edge("i_e3",  "i_res", "i_reg", E_SYNC,  "3. load page + sections + components", exitX=1, exitY=0.5, entryX=0, entryY=0.5)
    d.edge("i_e4",  "i_res", "i_opa", E_SYNC,  "4. opa_allow(req) per component", exitX=0.7, exitY=0, entryX=0.5, entryY=0)
    d.edge("i_e5",  "i_opa", "i_res", E_SYNC,  "5. {allow, reason, masked_columns}", exitX=0.5, exitY=1, entryX=0.7, entryY=0)

    # Resolver returns rendered manifest to app, then app returns to browser
    d.edge("i_e6",  "i_res", "i_app", E_SYNC,  "6. ResolvedPage", exitX=0, exitY=0.5, entryX=1, entryY=0.5)
    d.edge("i_e7",  "i_app", "i_html",E_SYNC,  "7. send HTML shell", exitX=0, exitY=1, entryX=0.5, entryY=0)
    d.edge("i_e8",  "i_html","i_br",  E_SYNC,  "8. render shell + bootstrap Alpine", exitX=0, exitY=0.5, entryX=1, entryY=0.5)

    # Per-component data fetch (after shell loaded)
    d.edge("i_e10", "i_br",  "i_api", E_SYNC,  "9. for each component: GET /api/component/{id}/data?region=…", exitX=1, exitY=0.7, entryX=0, entryY=0.5)
    d.edge("i_e11", "i_api", "i_res", E_SYNC,  "10. fetch_component()", exitX=0, exitY=0.5, entryX=0.2, entryY=1)
    d.edge("i_e12", "i_res", "i_opa", E_SYNC,  "11. opa_allow(req) — 2nd check", exitX=0.8, exitY=0, entryX=0.7, entryY=0)

    # source dispatch
    d.edge("i_e20", "i_res", "i_h1",  E_FAINT, "data.source=postgres-marts", exitX=0.1, exitY=1, entryX=0.5, entryY=0)
    d.edge("i_e21", "i_res", "i_h2",  E_FAINT, "dataset-catalog",            exitX=0.3, exitY=1, entryX=0.5, entryY=0)
    d.edge("i_e22", "i_res", "i_h3",  E_FAINT, "loki-audit",                 exitX=0.5, exitY=1, entryX=0.5, entryY=0)
    d.edge("i_e23", "i_res", "i_h4",  E_FAINT, "mlflow-models",              exitX=0.7, exitY=1, entryX=0.5, entryY=0)
    d.edge("i_e24", "i_res", "i_h5",  E_FAINT, "synthetic",                  exitX=0.9, exitY=1, entryX=0.5, entryY=0)

    d.edge("i_e30", "i_h1",  "i_bao", E_CRED,  "12. mint pg cred",           exitX=1, exitY=0.5, entryX=0.2, entryY=0)
    d.edge("i_e31", "i_h1",  "i_pg",  E_DATA,  "13. SELECT view WHERE region = ANY(scope ∩ filter)", exitX=1, exitY=0.7, entryX=0.5, entryY=0)
    d.edge("i_e32", "i_h1",  "i_api", E_DATA,  "14. {rows, columns}",        exitX=0.5, exitY=0, entryX=0, entryY=1)

    # Audit each fetch
    d.edge("i_e40", "i_app", "i_loki",E_AUDIT, "AuditEvent on every /api/component", exitX=1, exitY=0.3, entryX=0.5, entryY=0)

    # Notes
    d.note("i_note", "Each component declares: allowed_roles · program_code · requires{subject,verb,granularity,sensitivity} · scopes[geography,program] · data{source,view,scope_columns}.\nThe resolver drops a component from the manifest if the user's role isn't allowed, the programme code doesn't match, or OPA denies. Empty sections collapse.\nA second OPA check fires at /api/component/{id}/data so a tampered front-end can't fetch what wasn't rendered.",
           60, 700, 1500, 100)

    return d


# ──────────────────────────────────────────────────────────────────────
# Diagram 6 — Audit & Monitoring
# ──────────────────────────────────────────────────────────────────────
def make_audit() -> Diagram:
    d = Diagram("06 · Audit & Monitoring", page_w=1500, page_h=800)
    d.title("au_t", "Audit & monitoring · Loki + Prometheus + Grafana", 400, 20)

    # Sources of events (left)
    d.node("au_ibi", "Internal BI",      STY_PORTAL, 60,  120, 160, 50)
    d.node("au_sp",  "Submission Portal",STY_PORTAL, 60,  190, 160, 50)
    d.node("au_dbt", "dbt Docs",         STY_PORTAL, 60,  260, 160, 50)
    d.node("au_ml",  "ML Serving",       STY_API,    60,  330, 160, 50)
    d.node("au_fhir","FHIR API",         STY_API,    60,  400, 160, 50)
    d.node("au_oh",  "OpenHIM mediator", STY_PROC,   60,  470, 160, 50)
    d.node("au_kc",  "Keycloak",         STY_SEC,    60,  540, 160, 50)
    d.node("au_af",  "Airflow tasks",    STY_ORCH,   60,  610, 160, 50)

    # Aggregators (middle)
    d.node("au_loki", "Loki :3100\nAudit + log stream", STY_SEC,   320, 270, 240, 80)
    d.node("au_prom", "Prometheus :9090\nMetrics scrape", STY_MON, 320, 400, 240, 80)

    # Sources scraped by Prometheus
    d.node("au_ml2",  "nhdw-gateway /metrics", STY_API, 60,  720, 160, 40)
    d.node("au_ch",   "ClickHouse :9363",    STY_STORE, 320, 720, 160, 40)
    d.node("au_kc2",  "Keycloak /metrics",   STY_SEC, 580, 720, 160, 40)

    # Grafana + dashboards
    d.node("au_graf", "Grafana :3000",                           STY_MON,   700, 270, 240, 80)
    d.node("au_db1",  "Dashboard · Audit Events",                STY_PORTAL,1000, 230, 280, 50)
    d.node("au_db2",  "Dashboard · EWARS Pilot",                 STY_PORTAL,1000, 290, 280, 50)
    d.node("au_db3",  "Dashboard · Infra Health",                STY_PORTAL,1000, 350, 280, 50)

    # Users
    d.node("au_ops",  "ops-sec.dev\nR-OPS-SEC", STY_USER, 1300, 260, 180, 50)
    d.node("au_stew", "stew.dev\nR-STEW",        STY_USER, 1300, 330, 180, 50)
    d.node("au_audb", "Internal BI · Governance\n→ audit-event-timeline component", STY_PORTAL, 700, 470, 280, 60)

    legend(d, "au", 1280, 60)

    # Each access point pushes audit
    for i, src in enumerate(("au_ibi","au_sp","au_dbt","au_ml","au_fhir","au_oh","au_kc","au_af")):
        d.edge(f"au_pu_{i}", src, "au_loki", E_AUDIT, "", exitX=1, exitY=0.5, entryX=0, entryY=(0.15 + 0.1*i))

    # Prom scrapes
    d.edge("au_p1", "au_prom", "au_ml2", E_AUDIT, "scrape", exitX=0.3, exitY=1, entryX=0.5, entryY=0)
    d.edge("au_p2", "au_prom", "au_ch",  E_AUDIT, "",        exitX=0.5, exitY=1, entryX=0.5, entryY=0)
    d.edge("au_p3", "au_prom", "au_kc2", E_AUDIT, "",        exitX=0.7, exitY=1, entryX=0.5, entryY=0)

    # Grafana reads
    d.edge("au_g1", "au_graf", "au_loki", E_DATA, "LogQL", exitX=0, exitY=0.5, entryX=1, entryY=0.5)
    d.edge("au_g2", "au_graf", "au_prom", E_DATA, "PromQL", exitX=0, exitY=0.7, entryX=1, entryY=0.7)

    # Grafana → dashboards
    d.edge("au_d1", "au_graf", "au_db1", E_FAINT, "", exitX=1, exitY=0.3, entryX=0, entryY=0.5)
    d.edge("au_d2", "au_graf", "au_db2", E_FAINT, "", exitX=1, exitY=0.5, entryX=0, entryY=0.5)
    d.edge("au_d3", "au_graf", "au_db3", E_FAINT, "", exitX=1, exitY=0.8, entryX=0, entryY=0.5)

    # Users → dashboards
    d.edge("au_u1", "au_ops",  "au_db1", E_SYNC, "OIDC", exitX=0, exitY=0.5, entryX=1, entryY=0.5)
    d.edge("au_u2", "au_stew", "au_audb",E_SYNC, "Governance tab", exitX=0, exitY=0.5, entryX=1, entryY=0.5)
    d.edge("au_u3", "au_audb", "au_loki",E_DATA, "tail recent", exitX=0, exitY=0.5, entryX=0.7, entryY=1)

    return d


# ──────────────────────────────────────────────────────────────────────
# Diagram 7 — ML pipeline
# ──────────────────────────────────────────────────────────────────────
def make_ml() -> Diagram:
    d = Diagram("07 · ML Pipeline", page_w=1500, page_h=900)
    d.title("m_t", "ML pipeline · package → runner train Job → @champion → predict → widgets", 400, 20)

    # Train leg (top)
    d.node("m_pkg", "Model packages\nbundle/seeds/ml/<name> + uploads\nmanifest · feature_spec · train.py", STY_SOURCE, 60, 110, 300, 80)
    d.node("m_mart","postgres-vault\nbi_idsr.mart_ml_disease_input", STY_STORE, 60,  230, 300, 70)
    d.node("m_tr",  "runner Job · train\nnhdw/ml-runner (ephemeral)",  STY_PROC, 440, 150, 280, 80)
    d.node("m_mlf", "MLflow tracking + registry :5000",  STY_STORE,  800, 150, 280, 80)
    d.node("m_mi",  "MinIO nhdw-artifacts/mlflow",       STY_STORE, 1160, 150, 260, 80)
    d.node("m_reg", "Registered: ears · outbreak · seasonal · ewars_lite · stockout_forecast\naliases: @champion (serving) · @challenger (graduation shadow)", STY_PROC, 440, 280, 640, 70)

    # Batch leg (middle)
    d.node("m_af",  "Airflow ml_batch_predict\nweekly · iterates ops_ml.model_deployment", STY_ORCH, 60, 400, 320, 70)
    d.node("m_pb",  "runner Job · predict-batch\nresolves models:/<name>@champion", STY_PROC, 440, 400, 300, 70)
    d.node("m_ops", "ops_ml.ml_predictions\nflat forecast schema + ml_run", STY_STORE, 800, 400, 300, 70)

    # Ad-hoc leg + gateway (bottom)
    d.node("m_gw",  "nhdw-gateway /api/ml\nOPA-gated · audit-logged", STY_API, 440, 540, 300, 70)
    d.node("m_ad",  "runner Job · predict-adhoc",          STY_PROC,  800, 540, 240, 70)
    d.node("m_st",  "MinIO ml-adhoc staging\ninput.csv → output.csv", STY_STORE, 1100, 540, 280, 70)
    d.node("m_user","dashboard widgets · admin retrain/promote", STY_USER, 60, 560, 300, 60)

    legend(d, "m", 60, 30)

    # ── flows ──
    # Training
    d.edge("m_e1", "m_pkg", "m_tr",  E_DATA, "1. fetch package",     exitX=1, exitY=0.5, entryX=0, entryY=0.3)
    d.edge("m_e2", "m_mart","m_tr",  E_DATA, "2. feature_spec query", exitX=1, exitY=0.5, entryX=0, entryY=0.7)
    d.edge("m_e3", "m_tr",  "m_mlf", E_DATA, "3. log + register",    exitX=1, exitY=0.5, entryX=0, entryY=0.5)
    d.edge("m_e4", "m_mlf", "m_mi",  E_DATA, "artifacts + ref profile", exitX=1, exitY=0.5, entryX=0, entryY=0.5)
    d.edge("m_e5", "m_mlf", "m_reg", E_DATA, "4. set alias",         exitX=0.3, exitY=1, entryX=0.5, entryY=0)

    # Batch predictions
    d.edge("m_e10","m_af",  "m_pb",  E_SYNC, "5. weekly per enabled row", exitX=1, exitY=0.5, entryX=0, entryY=0.5)
    d.edge("m_e11","m_reg", "m_pb",  E_DATA, "resolve @champion",    exitX=0.3, exitY=1, entryX=0.3, entryY=0)
    d.edge("m_e12","m_pb",  "m_ops", E_DATA, "6. DELETE+INSERT by run_id", exitX=1, exitY=0.5, entryX=0, entryY=0.5)

    # Gateway reads + ad-hoc
    d.edge("m_e20","m_user","m_gw",  E_SYNC, "GET predictions · POST predict", exitX=1, exitY=0.5, entryX=0, entryY=0.5)
    d.edge("m_e21","m_gw",  "m_ops", E_DATA, "read flat rows",       exitX=0.7, exitY=0, entryX=0.3, entryY=1)
    d.edge("m_e22","m_gw",  "m_ad",  E_SYNC, "7. spawn Job · poll /api/ml/jobs/{id}", exitX=1, exitY=0.5, entryX=0, entryY=0.5)
    d.edge("m_e23","m_ad",  "m_st",  E_DATA, "CSV in / out",         exitX=1, exitY=0.5, entryX=0, entryY=0.5)
    d.edge("m_e24","m_gw",  "m_reg", E_SYNC, "retrain · promote @champion", exitX=0.3, exitY=0, entryX=0.1, entryY=1)

    return d


# ──────────────────────────────────────────────────────────────────────
# Compose the whole drawio file
# ──────────────────────────────────────────────────────────────────────
def main():
    diagrams = [
        make_overview(),
        make_authflow(),
        make_pipeline(),
        make_submission(),
        make_ibi(),
        make_audit(),
        make_ml(),
    ]
    body = "\n".join(d.render() for d in diagrams)
    out = f'''<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" agent="nhdw-build/1.0" version="24.0.0" type="device">
{body}
</mxfile>
'''
    import os
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "nhdw-architecture.drawio")
    with open(path, "w") as f:
        f.write(out)
    print(f"wrote {path} ({len(out):,} bytes)")
    print(f"  diagrams: {len(diagrams)}")


if __name__ == "__main__":
    main()
