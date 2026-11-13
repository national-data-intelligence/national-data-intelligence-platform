/**
 * Hotspot Action Queue — highest-burden woredas with response context (Disease §4).
 * answers.md Q3-dz-woreda-table · insight-notes: KEEP AND EXTEND — a hotspot list by signal alone
 * is a source-system view; add readiness + reliability so it IS the action queue (signal meets
 * thin response capacity). Guardrail: sort logic visible; NOT a "worst-managed" ranking.
 * Source: bi_idsr.mart_idsr_disease_weekly (+ml) + Supply (readiness) + DQ (reliability) + MFR.
 *
 * DATA CONTRACT (mock: dz-woreda-table.json) — one row per hotspot woreda:
 *   rank:int · woreda:str · region:str · cases_12w:int · incidence_100k:num · cfr_pct:num ·
 *   p_alarm:int(%) · readiness:'Ready'|'Partial'|'Limited' · reliability:'High'|'Medium'|'Low'
 * reactsTo: geography · programme.
 *
 * 2026-07-12 (X5): migrated onto the shared paginatedTable (sticky header, fixed-height
 * scroll, search + click-to-sort). Region codes render as full names; the "#" column carries the
 * pre-computed burden rank (rows arrive ranked worst-first). Readiness + Reliability pills are
 * coloured via TableColumn.tone (Ready/High→good, Partial/Medium→watch, Limited/Low→alert).
 */
import type { WidgetDef, WidgetCtx } from '../../runtime/types';
import type { TableColumn } from '../_shared/charts';
import { paginatedTable } from '../_shared/charts';
import { regionName, levelName } from '../_shared/reference';

// Value → pill token. Both cases covered so tone stays case-robust like the pre-X5 lookup.
const READY_TONE: Record<string, string> = {
  Ready: 'good', ready: 'good', Partial: 'watch', partial: 'watch', Limited: 'alert', limited: 'alert',
};
const RELIA_TONE: Record<string, string> = {
  High: 'good', high: 'good', Medium: 'watch', medium: 'watch', Low: 'alert', low: 'alert',
};

const def: WidgetDef = {
  id: 'dz-woreda-table',
  reactsTo: ['geography', 'programme'],
  async render(ctx: WidgetCtx) {
    const rows = await ctx.fetchData();
    if (!rows || !rows.length) { ctx.empty('No hotspot woredas for the selected filters.'); return; }
    const t = ctx.theme;

    const shaped = rows.map(r => ({
      rank: r.rank ?? '',
      woreda: r.woreda ?? '-',
      region: regionName(String(r.region ?? '')),
      cases: Number(r.cases_12w ?? 0).toLocaleString(),
      incidence: Number(r.incidence_100k ?? 0),
      cfr: `${Number(r.cfr_pct ?? 0).toFixed(1)}%`,
      p_alarm: Math.round(Number(r.p_alarm ?? 0) * 100),   // fetcher: 0–1 probability
      readiness: String(r.readiness ?? '-'),
      reliability: String(r.reliability ?? '-'),
    }));
    const columns: TableColumn[] = [
      { id: 'rank', label: '#' },
      { id: 'woreda', label: levelName('admin3') },
      { id: 'region', label: levelName('admin1') },
      { id: 'cases', label: 'Cases (12w)' },
      { id: 'incidence', label: 'Incidence /100k' },
      { id: 'cfr', label: 'CFR %' },
      { id: 'p_alarm', label: 'P(alarm)', format: 'pct' },
      { id: 'readiness', label: 'Readiness', format: 'pill', tone: READY_TONE },
      { id: 'reliability', label: 'Reliability', format: 'pill', tone: RELIA_TONE },
    ];

    ctx.el.innerHTML = `
      <div class="dz-wt-tbl"></div>`;
    const mount = ctx.el.querySelector<HTMLElement>('.dz-wt-tbl')!;
    return paginatedTable(mount, shaped, columns, ctx.theme, { search: true, sort: true });
  },
};
export default def;
