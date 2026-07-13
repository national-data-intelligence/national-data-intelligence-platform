/** ws-help-guides — how-to GUIDES for the workshop. Editorial, HTML-artifact
 *  style: a lede, then one titled section per task (create a group, create a
 *  project, link datasets, submit for review) with numbered steps. This is the
 *  FIRST section of the Help page (replaces the retired ws-help-tools analysis
 *  cards). Content is grounded in how the workshop actually works — groups are
 *  invite-only; a project is the home for files/datasets/models/code; datasets
 *  link to projects M:N; the project is the unit of review in graduation.
 *  Static content — no fetch. Reads ctx.theme for ink colours; accents come
 *  from the shell's --navy-* tokens (never hardcoded). */
import type { WidgetDef } from '../../runtime/types';

type Step = { lead: string; body: string };
type Guide = { icon: string; title: string; sub: string; steps: Step[] };

const GUIDES: Guide[] = [
  {
    icon: 'i-user-plus',
    title: 'Create a group',
    sub: 'Invite-only spaces that share work at the shared tier',
    steps: [
      { lead: 'Open the Workspace',
        body: 'Go to the Workspace page and find the groups area — the groups you belong to sit alongside a Discover panel of every other group.' },
      { lead: 'Start a new group',
        body: 'In Discover, click <em>Create a group</em> to open the inline form.' },
      { lead: 'Name it and describe its focus',
        body: 'Give it a clear name (e.g. “Malaria modelling network”) and a one-line description of what it works on, then Create. You become its owner.' },
      { lead: 'Grow membership by approval',
        body: 'Joining is invite-only — there is no instant join. Others <em>request to join</em> from Discover and you, the owner, approve them. Anything shared to the group is then visible to every member.' },
    ],
  },
  {
    icon: 'i-folder',
    title: 'Create a project',
    sub: 'The home for a body of work — files, datasets, models and code',
    steps: [
      { lead: 'Open the Projects page',
        body: 'It lists the projects you own or have been given access to.' },
      { lead: 'Start a new project',
        body: 'Click <em>New project</em> to open the create dialog.' },
      { lead: 'Name it and set visibility',
        body: 'Give it a name (e.g. “Malaria early-warning system”) and an optional description, then choose <strong>Private</strong> (only you) or <strong>Public</strong> (everyone in the workshop). Creating it provisions a private file space and an experiment for its model runs.' },
      { lead: 'Open it and get to work',
        body: 'From the project detail you get a JupyterLab workspace plus the project’s files, datasets, models and artifacts. Share it with a specific group — or the whole workshop — later from the project’s visibility control.' },
    ],
  },
  {
    icon: 'i-database',
    title: 'Link datasets to a project',
    sub: 'Datasets are generated independently, then linked where they are used',
    steps: [
      { lead: 'Generate a dataset',
        body: 'On the Datasets page, use the dataset builder — pick a template or write SQL, and choose a tier (personal, shared or public). Every query runs through the one governed, policy-checked SQL path.' },
      { lead: 'Link it as you create it',
        body: 'The builder lets you pick a project to link the new dataset straight into — or you can leave it unlinked and decide later.' },
      { lead: 'Or link it later from the project',
        body: 'Open a project, click <em>Link datasets</em>, and link any of your datasets into it. Datasets are independent, so one can belong to several projects.' },
      { lead: 'Use it in your workspace',
        body: 'Linked datasets are copied into the project’s files and appear in its JupyterLab, ready to load in a notebook.' },
    ],
  },
  {
    icon: 'i-graduation',
    title: 'Submission & approval',
    sub: 'From project to peer review to a published, public contribution',
    steps: [
      { lead: 'Get the project ready',
        body: 'Aim to include the essentials: an inference script, a model artifact or notebook, a train script when the project has a model, and a README or model card.' },
      { lead: 'Submit for review',
        body: 'From the project detail, click <em>Submit for review</em>. An automated essential-files check runs and shows what it found — you can submit even if some essentials are missing, since the checklist only warns.' },
      { lead: 'A reviewer opens and runs it',
        body: 'The project is the unit of review. A human reviewer opens it, runs its notebooks, and either approves it or requests changes. It shows as <strong>in review</strong> until they decide.' },
      { lead: 'Approved becomes public',
        body: 'On approval the project graduates to the public tier and is visible across the workshop. If changes were requested, address them and re-submit.' },
    ],
  },
];

const def: WidgetDef = {
  id: 'ws-help-guides',
  reactsTo: [],
  render(ctx) {
    const { theme } = ctx;

    const card = (g: Guide): string => `
      <article class="wg-card card">
        <header class="wg-head">
          <span class="wg-badge" aria-hidden="true">
            <svg class="ico"><use href="#${g.icon}"/></svg>
          </span>
          <div>
            <h4 class="wg-title">${g.title}</h4>
            <p class="wg-sub">${g.sub}</p>
          </div>
        </header>
        <ol class="wg-steps">
          ${g.steps.map(s => `
            <li class="wg-step">
              <span class="wg-num" aria-hidden="true"></span>
              <span class="wg-text"><strong>${s.lead}.</strong> ${s.body}</span>
            </li>`).join('')}
        </ol>
      </article>`;

    ctx.el.innerHTML = `
      <style>
        .ws-guides .wg-lede {
          max-width: 76ch; margin: 0 0 1.6rem;
          font-size: 0.95rem; line-height: 1.6; color: ${theme.ink[1]};
        }
        .ws-guides .wg-lede .wg-eyebrow {
          display: block; font-family: var(--font-sans);
          font-size: 0.72rem; font-weight: 700; letter-spacing: 0.09em;
          text-transform: uppercase; color: var(--navy-500); margin: 0 0 0.5rem;
        }
        .ws-guides .wg-lede-h {
          font-family: var(--font-serif); font-weight: 600;
          font-size: 1.55rem; line-height: 1.15; letter-spacing: -0.01em;
          color: ${theme.ink[0]}; margin: 0 0 0.55rem;
        }
        .ws-guides .wg-grid {
          display: grid; gap: 1.1rem;
          grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
        }
        .ws-guides .wg-card { display: flex; flex-direction: column; gap: 0.9rem; }
        .ws-guides .wg-head { display: flex; gap: 0.75rem; align-items: center; }
        .ws-guides .wg-badge {
          flex: none; width: 40px; height: 40px; border-radius: 11px;
          display: inline-grid; place-items: center;
          background: linear-gradient(135deg, var(--navy-800), var(--navy-600));
          color: #fff; box-shadow: 0 4px 12px -4px rgba(15,23,42,.35);
        }
        .ws-guides .wg-badge svg { width: 20px; height: 20px; }
        .ws-guides .wg-title {
          font-family: var(--font-serif); font-weight: 600;
          font-size: 1.16rem; color: ${theme.ink[0]}; margin: 0; line-height: 1.15;
        }
        .ws-guides .wg-sub { font-size: 0.79rem; color: ${theme.ink[2]}; margin: 0.12rem 0 0; }
        .ws-guides .wg-steps {
          list-style: none; margin: 0; padding: 0;
          display: flex; flex-direction: column; gap: 0.7rem;
          counter-reset: wg;
        }
        .ws-guides .wg-step { display: flex; gap: 0.65rem; align-items: flex-start; }
        .ws-guides .wg-num {
          counter-increment: wg; flex: none;
          width: 22px; height: 22px; margin-top: 0.05rem;
          border-radius: 50%; display: inline-grid; place-items: center;
          background: var(--navy-50); color: var(--navy-800);
          font-family: var(--font-sans); font-weight: 700; font-size: 0.72rem;
          font-variant-numeric: tabular-nums;
        }
        .ws-guides .wg-num::before { content: counter(wg); }
        .ws-guides .wg-text {
          font-size: 0.855rem; line-height: 1.55; color: ${theme.ink[1]};
        }
        .ws-guides .wg-text strong { color: ${theme.ink[0]}; font-weight: 700; }
        .ws-guides .wg-text em { font-style: normal; font-weight: 600; color: var(--navy-700); }
      </style>
      <div class="ws-guides">
        <div class="wg-lede">
          <span class="wg-eyebrow">Getting started</span>
          <p class="wg-lede-h">How the workshop works</p>
          The workshop is where teams turn warehouse data into datasets, models
          and published findings. Work flows through <strong>groups</strong> you
          collaborate in, <strong>projects</strong> that hold your files and
          models, and a <strong>review</strong> step that promotes finished work
          to the whole community. These short guides walk through each one.
        </div>
        <div class="wg-grid">
          ${GUIDES.map(card).join('')}
        </div>
      </div>`;
  },
};
export default def;
