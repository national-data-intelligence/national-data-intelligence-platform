/** ws-help-reference — reference & data-use guidance. The community Code of
 *  Conduct and the FMoH Data Use Agreement live HERE as real page content
 *  (folded up from the former ConductStrip); the footer keeps the one-line
 *  short version. Static content — no fetch. */
import type { WidgetDef } from '../../runtime/types';

const def: WidgetDef = {
  id: 'ws-help-reference',
  reactsTo: [],
  render(ctx) {
    const { theme } = ctx;
    const h = (t: string) => `<h4 style="margin:0 0 .4rem;display:flex;align-items:center;gap:.45rem">
      <svg class="ico" style="width:16px;height:16px"><use href="#i-policy"/></svg>${t}</h4>`;
    ctx.el.innerHTML = `
      <div style="display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
        <div class="card" style="display:flex;flex-direction:column;gap:.5rem">
          ${h('Community code of conduct')}
          <p style="font-size:.86rem;line-height:1.55;color:${theme.ink[1]};margin:0">
            This portal is for collaborative learning and constructive
            contribution. We expect courtesy across all backgrounds and
            disciplines — researchers, developers, students and programme
            staff work here side by side.</p>
          <ul style="margin:.2rem 0 0;padding-left:1.1rem;font-size:.84rem;line-height:1.6;color:${theme.ink[1]}">
            <li><strong>Be constructive in review.</strong> Peer review decides what
              reaches the shared and public tiers; critique the work, never the
              person, and say what would make a submission acceptable.</li>
            <li><strong>Attribute and cite.</strong> Datasets and models carry
              licenses and citations — honour them when you fork, extend or
              publish derived work.</li>
            <li><strong>Share honestly.</strong> Describe your data's provenance and
              limitations; do not present synthetic or exploratory results as
              validated findings.</li>
            <li><strong>Respect the tiers.</strong> Personal work stays personal
              until it passes review; do not redistribute shared-tier artifacts
              outside their group.</li>
          </ul>
        </div>
        <div class="card" style="display:flex;flex-direction:column;gap:.5rem">
          ${h('FMoH data use agreement')}
          <p style="font-size:.86rem;line-height:1.55;color:${theme.ink[1]};margin:0">
            Access to warehouse marts is granted for public-health research and
            practice under your role's scopes, and every query is policy-checked
            and audited. By using this workshop you agree to:</p>
          <ul style="margin:.2rem 0 0;padding-left:1.1rem;font-size:.84rem;line-height:1.6;color:${theme.ink[1]}">
            <li><strong>No re-identification.</strong> Personal data — even when
              k-anonymised — must be handled with care and never combined with
              other sources to re-identify individuals. This is the hard line.</li>
            <li><strong>Purpose limitation.</strong> Use data only for the research
              purpose your access was granted for; new purposes need a new
              request through governance.</li>
            <li><strong>No exfiltration.</strong> Take data out only through the
              governed export and download paths — they record provenance and
              enforce your scopes.</li>
            <li><strong>Report incidents.</strong> Suspected leaks, mis-scoped
              access or re-identification risks go to the data-governance team
              immediately.</li>
          </ul>
          <p style="font-size:.78rem;color:${theme.ink[2]};margin:.3rem 0 0">
            Enforcement is technical as well as procedural: the gateway, OPA
            policies and row-level scopes apply these rules on every request,
            and violations are visible in the audit trail.</p>
        </div>
      </div>`;
  },
};
export default def;
