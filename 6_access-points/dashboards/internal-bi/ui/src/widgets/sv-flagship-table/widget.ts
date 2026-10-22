/**
 * Flagship Attainment with confidence (Service §1).
 * answers.md Q3-sv-flagship-table · insight-notes: KEEP AND EXTEND — keep every official Ministry
 * indicator (G1), add coverage-CONFIDENCE (completeness + timeliness + mapping) + lineage so the
 * warehouse's value is trust context, not the number. Guardrails: only show a target where the
 * indicator really has one (G4); confidence is NOT coverage (G3).
 * Source: DHIS2 + DQ + MFR.
 *
 * DATA CONTRACT (mock: sv-flagship-table.json): indicator · programme · current_pct:int ·
 *   target_pct:int|null · status:'Good'|'Watch'|'Alert' · completeness_pct:int · timeliness_pct:int ·
 *   mapping_status · confidence_status ('High'|'Medium'|'Low'). reactsTo: geography · programme · period.
 *
 * 2026-07-12 (X5): migrated onto the shared paginatedTable (sticky header, fixed-height scroll,
 * search + click-to-sort). Timeliness renders as a plain % (the inline progress bar is dropped).
 * Status + Confidence pills are coloured via TableColumn.tone (Good→good, Watch→watch, Alert→alert;
 * High→good, Medium→watch, Low→alert) — restoring the pre-X5 status pill + confidence-dot colours.
 */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';
import type { TableColumn } from '../_shared/charts';
import { paginatedTable } from '../_shared/charts';

const STATUS_TONE: Record<string, string> = { Good: 'good', Watch: 'watch', Alert: 'alert' };
const CONF_TONE: Record<string, string> = { High: 'good', Medium: 'watch', Low: 'alert' };

const def: WidgetDef = {
  id: 'sv-flagship-table',
  reactsTo: ['geography', 'programme', 'period'],
  async render(ctx: WidgetCtx) {
    const rows = await ctx.fetchData();
    if (!rows || !rows.length) { ctx.empty('No flagship indicators for the selected filters.'); return; }
    const t = ctx.theme;

    const shaped = rows.map(r => ({
      indicator: r.indicator ?? '-',
      programme: r.programme ?? '-',
      current: Number(r.current_pct ?? 0),
      target: r.target_pct == null ? 'No target' : `${r.target_pct}%`,
      status: String(r.status ?? '-'),
      completeness: Number(r.completeness_pct ?? 0),
      timeliness: Number(r.timeliness_pct ?? 0),
      confidence: String(r.confidence_status ?? '-'),
    }));
    const columns: TableColumn[] = [
      { id: 'indicator', label: 'Indicator' },
      { id: 'programme', label: 'Programme' },
      { id: 'current', label: 'Current', format: 'pct' },
      { id: 'target', label: 'Target' },
      { id: 'status', label: 'Status', format: 'pill', tone: STATUS_TONE },
      { id: 'completeness', label: 'Completeness', format: 'pct' },
      { id: 'timeliness', label: 'Timeliness', format: 'pct' },
      { id: 'confidence', label: 'Confidence', format: 'pill', tone: CONF_TONE },
    ];

    ctx.el.innerHTML = `
      <p style="font-size:.82rem;color:${t.ink[2]};margin:0 0 .5rem">Official indicators with confidence and lineage</p>
      <div class="sv-fl-tbl"></div>`;
    const mount = ctx.el.querySelector<HTMLElement>('.sv-fl-tbl')!;
    return paginatedTable(mount, shaped, columns, ctx.theme, { search: true, sort: true });
  },
};
export default def;
