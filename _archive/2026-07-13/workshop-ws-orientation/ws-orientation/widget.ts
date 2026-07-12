/** ws-orientation — a compact 3-step onboarding strip (horizontal). Static,
 *  honest copy; no fetch. Full-width band under the sandbox so it reads as a
 *  quick "how this works" rather than a tall sidebar list. */
import type { WidgetDef } from '../../runtime/types';

const STEPS = [
  ['i-database', 'Authorised marts',
   `Notebooks read the warehouse marts your role grants — enforced by the gateway
    and OPA, scoped to your geography and programmes.`],
  ['i-upload', 'Submit for review',
   `Models and notebooks live inside a project; submit one and reviewers peer-review
    it before it graduates to the shared or public tier.`],
  ['i-users', 'Share & collaborate',
   `Join a group, connect datasets to projects, and send files straight into a
    colleague's project.`, 'ws-groups'],
] as const;

const def: WidgetDef = {
  id: 'ws-orientation',
  reactsTo: [],
  render(ctx) {
    ctx.el.innerHTML = `
      <div class="ws-orient-strip">
        ${STEPS.map(([icon, title, body], i) => `
          <div class="ws-orient">
            <div class="ws-orient-top">
              <span class="ws-orient-num">${i + 1}</span>
              <svg class="ico ico-sm"><use href="#${icon}"/></svg>
              <h4>${title}</h4>
            </div>
            <p>${body}${STEPS[i][3] ? ` <a href="#" data-act="groups">Browse groups →</a>` : ''}</p>
          </div>`).join('')}
      </div>`;
    ctx.el.querySelector<HTMLAnchorElement>('a[data-act="groups"]')
      ?.addEventListener('click', (e) => { e.preventDefault(); ctx.host.focusWidget('ws-groups'); });
  },
};
export default def;
