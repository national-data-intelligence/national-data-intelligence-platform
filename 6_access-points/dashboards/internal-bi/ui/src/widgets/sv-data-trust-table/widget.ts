/**
 * Facility Data-Trust Signals (Service §3) — lowest DHIS2↔EMR agreement.
 * answers.md Q3-sv-data-trust-table · insight-notes: sv-compliance REPLACE — the headline warehouse
 * capability (reported-vs-recorded). expected = DHIS2 reported; actual = EMR recorded; agreement =
 * min/max*100; severity Alert<75 · Watch 75–89 · Review 90–94 · Agree ≥95. Guardrail G2: EMR-active,
 * framed as a data-trust signal not an accusation. Source: EMR + DHIS2 + MFR.
 * DATA CONTRACT (mock: sv-data-trust-table.json): facility · indicator · agreement_ratio_pct ·
 *   expected_dhis2:int · actual_emr:int · difference:int · severity. reactsTo: geography · programme · period.
 *
 * 2026-07-12 (X5): migrated onto the shared paginatedTable (sticky header, fixed-height scroll,
 * search + click-to-sort). Difference keeps its +/− sign and is coloured red-on-negative via
 * TableColumn.cellClass; Severity is a tone-coloured pill (Alert→alert, Watch→watch, Review→info,
 * Agree→good) — restoring the pre-X5 conditional colours.
 */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';
import type { TableColumn } from '../_shared/charts';
import { paginatedTable } from '../_shared/charts';

const SEV_TONE: Record<string, string> = { Alert: 'alert', Watch: 'watch', Review: 'info', Agree: 'good' };

const def: WidgetDef = {
  id: 'sv-data-trust-table',
  reactsTo: ['geography', 'programme', 'period'],
  async render(ctx: WidgetCtx) {
    const rows = await ctx.fetchData();
    if (!rows || !rows.length) { ctx.empty('No reported-vs-recorded discrepancy rows for the selected filters.'); return; }
    const t = ctx.theme;

    const shaped = rows.map(r => {
      const diff = Number(r.difference ?? 0);
      return {
        facility: r.facility ?? '-',
        indicator: r.indicator ?? '-',
        agreement: Number(r.agreement_ratio_pct ?? 0),
        expected: Number(r.expected_dhis2 ?? 0).toLocaleString(),
        actual: Number(r.actual_emr ?? 0).toLocaleString(),
        difference: `${diff > 0 ? '+' : ''}${diff}`,
        severity: String(r.severity ?? '-'),
      };
    });
    const columns: TableColumn[] = [
      { id: 'facility', label: 'Facility' },
      { id: 'indicator', label: 'Indicator' },
      { id: 'agreement', label: 'Agreement ratio', format: 'pct' },
      { id: 'expected', label: 'Expected (DHIS2)' },
      { id: 'actual', label: 'Actual (EMR)' },
      { id: 'difference', label: 'Difference', cellClass: v => (String(v).trim().startsWith('-') ? `color:${t.status.alert};font-weight:600` : '') },
      { id: 'severity', label: 'Severity', format: 'pill', tone: SEV_TONE },
    ];

    ctx.el.innerHTML = `
      <div class="sv-dt-tbl"></div>`;
    const mount = ctx.el.querySelector<HTMLElement>('.sv-dt-tbl')!;
    return paginatedTable(mount, shaped, columns, ctx.theme, { search: true, sort: true });
  },
};
export default def;
