/**
 * Infra page · live SYSTEM TOPOLOGY.
 *
 * The apps-only node-link graph from GET /gw/topology/graph, rendered as a
 * white architecture-diagram canvas (fixed 2D zones, rectangular nodes,
 * obstacle-avoiding orthogonal edges, animated real-traffic ants) — redesigned
 * 2026-07-06 per task #83 metadata.v2_visual_spec (prior dark-swimlane renderer
 * archived → _archive/2026-07-06/admin-topology-renderer-v1-swimlane/). Replaces
 * the old three-tab table view (Workloads + the retired Pipeline layer) —
 * archived 2026-07-06 → _archive/2026-07-06/admin-topology-frontend-tables/.
 *
 * This component is a THIN wrapper: it resolves design tokens via
 * getComputedStyle, fetches /graph + /traffic (+ /infra for the capacity
 * strip) on a 30s auto-refresh, and owns the health strip (TOP), legend and the
 * RICH node-detail panel (BOTTOM: identity + health/runtime + live CPU/mem from
 * metrics-server + recent k8s events + connections). ALL renderer logic lives
 * in src/topology/renderTopology.ts so it lifts unchanged into a #80 widget.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as topo from '../../api/topology';
import { renderTopology } from '../../topology/renderTopology';
import type { TopoTheme, TopologyHandle, TopoNode, TopoEdge, TopoGraph } from '../../topology/renderTopology';
import TopoSummary from './TopoSummary';

type RefreshInterval = 10 | 30 | 60 | 0;
const REFRESH_LABEL: Record<RefreshInterval, string> = { 10: '10s', 30: '30s', 60: '60s', 0: 'off' };

function fmtAgo(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  if (ms < 60_000)    return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

function fmtBytes(b: number | undefined): string {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0; let n = b;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${Math.round(n * 10) / 10} ${u[i]}`;
}

function buildTheme(): TopoTheme {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    paper: v('--paper'), paper2: v('--paper-2'), bg: v('--bg'), bg2: v('--bg-2'),
    border: v('--border'), border2: v('--border-2'),
    ink: v('--ink'), ink2: v('--ink-2'), ink3: v('--ink-3'), ink4: v('--ink-4'),
    good: v('--good'), watch: v('--watch'), alert: v('--alert'), info: v('--info'),
    navy700: v('--navy-700'), navy50: v('--navy-50'),
    fontSans: v('--font-sans'), fontMono: v('--font-mono'),
  };
}

// ── formatters for the rich per-node resource cards ──
function fmtCpu(mc: number | null | undefined): string {
  if (mc == null) return '—';
  return mc >= 1000 ? `${(mc / 1000).toFixed(mc % 1000 ? 2 : 0)} vCPU` : `${mc}m`;
}
function fmtMem(b: number | null | undefined): string {
  if (b == null) return '—';
  const u = ['B', 'KiB', 'MiB', 'GiB']; let i = 0; let n = b;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${Math.round(n * 10) / 10} ${u[i]}`;
}
function fmtEvtAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return '';
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}

// level-tint for a raw log line (best-effort keyword scan → colour class)
function logLevelClass(line: string): string {
  const s = line.toUpperCase();
  if (/\b(ERROR|ERR|FATAL|CRITICAL|EXCEPTION|TRACEBACK|PANIC)\b/.test(s)) return 'lv-error';
  if (/\bWARN(?:ING)?\b/.test(s)) return 'lv-warn';
  if (/\bINFO\b/.test(s)) return 'lv-info';
  if (/\b(DEBUG|TRACE)\b/.test(s)) return 'lv-debug';
  return '';
}

// small inline SVG icon from the app's offline sprite (#i-*, fetched into
// #icon-sprite at boot — NO CDN / icon-font). Used to key the node-detail rows.
function Ico({ n, className = 'ico ico-sm topo-dl-ico' }: { n: string; className?: string }) {
  return <svg className={className} aria-hidden="true"><use href={`#i-${n}`} /></svg>;
}

// tiny self-contained inline-SVG sparkline (no chart lib in this file). Draws a
// real series (e.g. per-bucket req/s from ops_audit.gateway_log) left→right.
function Sparkline({ data, color = 'var(--good)', w = 132, h = 30 }:
  { data: number[]; color?: string; w?: number; h?: number }) {
  const n = data.length;
  if (!n) return null;
  const max = Math.max(...data, 1e-9);
  const pad = 2;
  const xs = (i: number) => n <= 1 ? w / 2 : pad + (i * (w - pad * 2)) / (n - 1);
  const ys = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const line = data.map((v, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(' ');
  const area = `${line} L${xs(n - 1).toFixed(1)},${h - pad} L${xs(0).toFixed(1)},${h - pad} Z`;
  return (
    <svg className="topo-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={area} fill={color} opacity={0.14} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// the node-detail tabs (owner request #83.5 — group the sections instead of one
// long vertical dump). Which tabs actually show is decided per-node below.
type TabId = 'overview' | 'resources' | 'storage' | 'logs' | 'config' | 'connections';
interface TabDef { id: TabId; label: string; icon: string; }

type Selection =
  | { type: 'node'; node: TopoNode }
  | { type: 'edge'; edge: TopoEdge }
  | null;

function Infra() {
  const [graph, setGraph]   = useState<TopoGraph | null>(null);
  const [infra, setInfra]   = useState<topo.InfraResp | null>(null);
  const [cluster, setCluster] = useState<topo.ClusterResp | null>(null);
  const [err, setErr]       = useState<string | null>(null);
  const [refresh, setRefresh] = useState<RefreshInterval>(30);
  const [sel, setSel]       = useState<Selection>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDL] = useState(false);
  const [logs, setLogs]     = useState<topo.NodeLogs | null>(null);
  const [nodeErrors, setNodeErrors] = useState<topo.NodeErrors | null>(null);
  const [errLoading, setErrLoading] = useState(false);
  const [logContainer, setLogContainer] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [tab, setTab]       = useState<TabId>('overview');   // node-detail active tab
  const [, setTick]         = useState(0);   // 5s ticker so "N s ago" stays live

  const boxRef    = useRef<HTMLDivElement>(null);
  const handleRef = useRef<TopologyHandle | null>(null);
  const graphRef  = useRef<TopoGraph | null>(null);
  const tabBtns   = useRef<Record<string, HTMLButtonElement | null>>({});

  // ── data load: /graph (+ /traffic merged) and /infra (best-effort) ──
  const load = async () => {
    try {
      const [g, t] = await Promise.all([topo.getGraph(), topo.getTraffic().catch(() => null)]);
      if (t?.edges) {
        for (const e of g.edges) {
          const blk = t.edges[e.id];
          if (blk) e.traffic = blk;
        }
      }
      graphRef.current = g;
      setGraph(g);
      setErr(null);
    } catch (e: any) {
      setErr(e.message || String(e));
    }
    topo.getInfra().then(setInfra).catch(() => {});
    topo.getCluster().then(setCluster).catch(() => {});
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => {
    if (refresh === 0) return;
    const id = setInterval(load, refresh * 1000);
    return () => clearInterval(id);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [refresh]);
  useEffect(() => {
    const id = setInterval(() => setTick(x => x + 1), 5000);
    return () => clearInterval(id);
  }, []);

  // ── mount Cytoscape once, then update in place on each refresh ──
  useEffect(() => {
    if (!graph || !boxRef.current) return;
    if (!handleRef.current) {
      handleRef.current = renderTopology(boxRef.current, graph, buildTheme(), {
        onNodeSelect: (n) => setSel({ type: 'node', node: n }),
        onEdgeSelect: (e) => setSel({ type: 'edge', edge: e }),
        onBackgroundTap: () => setSel(null),
      });
    } else {
      handleRef.current.update(graph);
    }
  }, [graph]);
  useEffect(() => () => { handleRef.current?.(); handleRef.current = null; }, []);

  // ── enrich a selected node via /node ──
  useEffect(() => {
    if (sel?.type !== 'node') { setDetail(null); return; }
    const id = sel.node.id;
    setDL(true); setDetail(null);
    topo.getNodeDetail(id)
      .then(setDetail)
      .catch((e: any) => setDetail({ error: e.message || String(e) }))
      .finally(() => setDL(false));
  }, [sel]);

  // ── reset the node-detail panel to its first tab on every new selection ──
  useEffect(() => { setTab('overview'); setNodeErrors(null); }, [sel]);

  // ── tail the selected node's container log via /logs (kubelet-now view) ──
  useEffect(() => {
    if (sel?.type !== 'node' || sel.node.phantom || sel.node.kind === 'external') {
      setLogs(null); setLogContainer(null); return;
    }
    const id = sel.node.id;
    setLogsLoading(true); setLogs(null); setLogContainer(null);
    topo.getNodeLogs(id)
      .then(l => { setLogs(l); setLogContainer(l.container); })
      .catch((e: any) => setLogs({ id, pod: null, containers: [], container: null, tail: 150, lines: [], note: e.message || String(e) }))
      .finally(() => setLogsLoading(false));
  }, [sel]);

  const pickContainer = (id: string, c: string) => {
    setLogContainer(c); setLogsLoading(true);
    topo.getNodeLogs(id, c)
      .then(setLogs)
      .catch((e: any) => setLogs({ id, pod: null, containers: [], container: c, tail: 150, lines: [], note: e.message || String(e) }))
      .finally(() => setLogsLoading(false));
  };

  const selectFromPanel = (id: string) => {
    const n = graphRef.current?.nodes.find(x => x.id === id);
    if (!n) return;
    setSel({ type: 'node', node: n });
    handleRef.current?.select(id);
  };

  // ── derived: health summary + connections ──
  const summary = useMemo(() => {
    const s = { healthy: 0, degraded: 0, down: 0, notDeployed: 0, unknown: 0, external: 0 };
    for (const n of graph?.nodes ?? []) {
      if (n.phantom) s.notDeployed++;
      else if (n.tier === 'external' || n.kind === 'external') s.external++;
      else if (n.health === 'up') s.healthy++;
      else if (n.health === 'degraded') s.degraded++;
      else if (n.health === 'down') s.down++;
      else s.unknown++;
    }
    return s;
  }, [graph]);

  const conns = useMemo(() => {
    if (sel?.type !== 'node' || !graph) return { inc: [] as TopoEdge[], out: [] as TopoEdge[] };
    const id = sel.node.id;
    return {
      out: graph.edges.filter(e => e.source === id),
      inc: graph.edges.filter(e => e.target === id),
    };
  }, [sel, graph]);

  const asOf = graph?.as_of ?? null;

  return (
    <section>
      <p className="page-lede">
        Live <strong>system topology</strong> — every deployed application workload and the wiring
        between them, auto-derived from the cluster. Nodes are coloured by health; edges that carry
        real gateway traffic animate (speed ∝ request rate). Click a node or edge for detail. The{' '}
        <a href="/oauth2gate/login?realm=privileged-ops&rd=/k8s/" target="_blank" rel="noreferrer"><strong>Cluster console</strong></a> (Headlamp,
        SSO-gated) is the raw-Kubernetes escape hatch — edit, scale and exec where this page reads.
      </p>

      {/* ── rich summary: cluster-health donut, host gauges, tier, traffic, live cluster capacity ── */}
      <TopoSummary graph={graph} infra={infra} health={summary} cluster={cluster} />

      <div className="page-section">
        <div className="ps-hdr">
          <h4 className="topo-map-title">Topology map</h4>
          <span className="ps-meta" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span className="topo-live"><span className="topo-live-dot" /> live · {fmtAgo(asOf)}</span>
            <span>refresh:</span>
            <select value={refresh} onChange={e => setRefresh(Number(e.target.value) as RefreshInterval)}>
              {[10, 30, 60, 0].map(n => <option key={n} value={n}>{REFRESH_LABEL[n as RefreshInterval]}</option>)}
            </select>
            <button className="btn btn-sm btn-ghost" onClick={load}>
              <svg className="ico ico-sm"><use href="#i-refresh" /></svg> Refresh
            </button>
            {/* Observability-plane launchers — the metrics + alerting UIs this
                page reads from. All ops roles (incl. R-OPS-SEC) may open them, so
                no role gate here: the tool-gate's ALLOWED_ROLES already covers
                every operator, and this page is itself only visible to ops. */}
            <a className="btn btn-sm btn-ghost"
               href="https://prometheus.127.0.0.1.nip.io/oauth2gate/login?realm=privileged-ops&rd=/"
               target="_blank" rel="noreferrer" data-testid="prometheus-btn"
               title="Prometheus — metrics store & query UI (SSO-gated)">
              <svg className="ico ico-sm"><use href="#i-pulse" /></svg> Prometheus ↗
            </a>
            <a className="btn btn-sm btn-ghost"
               href="https://alertmanager.127.0.0.1.nip.io/oauth2gate/login?realm=privileged-ops&rd=/"
               target="_blank" rel="noreferrer" data-testid="alertmanager-btn"
               title="Alertmanager — alert routing & silences (SSO-gated)">
              <svg className="ico ico-sm"><use href="#i-bell" /></svg> Alertmanager ↗
            </a>
            {/* #57: the raw-Kubernetes escape hatch — SSO-gated Headlamp */}
            <a className="btn btn-sm"
               href="/oauth2gate/login?realm=privileged-ops&rd=/k8s/"
               target="_blank" rel="noreferrer" data-testid="cluster-console-btn"
               title="Headlamp — edit/scale/exec on nhdw workloads (SSO-gated)">
              <svg className="ico ico-sm"><use href="#i-tools" /></svg> Cluster console ↗
            </a>
          </span>
        </div>

        {err && (
          <div className="card card-elev" style={{ borderLeft: '3px solid var(--alert)', margin: '0.8rem 0' }}>
            <strong>Topology feed error:</strong> {err}
          </div>
        )}

        {/* ── the graph canvas ── */}
        <div className="topo-canvas-wrap">
          <div ref={boxRef} className="topo-canvas" />
          {!graph && !err && <div className="topo-canvas-loading">Deriving live topology…</div>}
          <div className="topo-toolbar">
            <button className="topo-tool-btn" title="Zoom in"     onClick={() => handleRef.current?.zoomIn()}>+</button>
            <button className="topo-tool-btn" title="Zoom out"    onClick={() => handleRef.current?.zoomOut()}>−</button>
            <button className="topo-tool-btn" title="Fit"         onClick={() => handleRef.current?.fit()}>⤢</button>
            <button className="topo-tool-btn" title="Reset layout" onClick={() => handleRef.current?.resetLayout()}>⟳</button>
          </div>
        </div>

        {/* ── legend ── */}
        <div className="topo-legend">
          <span className="topo-legend-grp">
            <span className="topo-legend-item"><i className="topo-le topo-le-traffic" /> live traffic (animated)</span>
            <span className="topo-legend-item"><i className="topo-le topo-le-struct" /> structural</span>
            <span className="topo-legend-item"><i className="topo-le topo-le-dashed" /> unhealthy · not deployed</span>
          </span>
          <span className="topo-legend-grp">
            <span className="topo-legend-item"><i className="topo-dot" style={{ background: 'var(--good)' }} /> up</span>
            <span className="topo-legend-item"><i className="topo-dot" style={{ background: 'var(--watch)' }} /> degraded</span>
            <span className="topo-legend-item"><i className="topo-dot" style={{ background: 'var(--alert)' }} /> down</span>
            <span className="topo-legend-item"><i className="topo-dot topo-dot-ghost" /> not deployed</span>
          </span>
          <span className="topo-legend-grp topo-legend-hint">
            <span className="topo-legend-item">→ edges anchor on a node port; arrow marks the callee</span>
          </span>
        </div>

        {/* ── detail panel ── */}
        <div className="topo-detail">
          {!sel && (
            <p className="muted" style={{ margin: 0 }}>
              Select a node to inspect its identity, health and connections — or an edge to see its traffic.
            </p>
          )}

          {sel?.type === 'node' && (() => {
            const n = sel.node;
            const [ready, desired] = (n.k8s?.ready ?? '').split('/');
            const healthTone = n.phantom ? 'muted' : n.health === 'up' ? 'good' : n.health === 'degraded' ? 'watch' : n.health === 'down' ? 'alert' : 'muted';
            const isLive = !n.phantom && n.kind !== 'external';
            const hasConfig = !!(detail?.config && (detail.config.secrets.length > 0 || detail.config.configMaps.length > 0));
            const bar = (pct: number, tone: string) => (
              <div className="topo-bar"><div className="topo-bar-fill" style={{ width: `${pct}%`, background: `var(--${tone})` }} /></div>
            );

            // which detail sections apply to THIS node → its tab set
            const tabs: TabDef[] = [{ id: 'overview', label: 'Overview', icon: 'info' }];
            if (isLive) {
              tabs.push({ id: 'resources', label: 'Resources', icon: 'cpu' });
              tabs.push({ id: 'storage',   label: 'Storage',   icon: 'disk' });
              tabs.push({ id: 'logs',      label: 'Logs',      icon: 'list' });
            }
            if (hasConfig) tabs.push({ id: 'config', label: 'Config & secrets', icon: 'key' });
            tabs.push({ id: 'connections', label: 'Connections', icon: 'link' });
            const ids = tabs.map(t => t.id);
            const activeTab: TabId = ids.includes(tab) ? tab : 'overview';

            return (
              <div className="topo-node-detail">
                <div className="topo-nd-head">
                  <div style={{ minWidth: 0 }}>
                    <h5>{n.label}{n.ephemeral && <span className="pill info" style={{ marginLeft: '0.5rem', fontSize: '0.62rem', verticalAlign: 'middle' }}>spawned</span>}</h5>
                    {n.subtitle && <div className="topo-detail-sub">{n.subtitle}</div>}
                  </div>
                  <button className="btn btn-sm btn-ghost" onClick={() => setSel(null)} aria-label="Close node detail">✕</button>
                </div>

                {/* keyboard-accessible tabs (roving tabindex + arrow / home / end) */}
                <div
                  className="topo-tabbar" role="tablist" aria-label="Node detail sections"
                  onKeyDown={(e) => {
                    const i = ids.indexOf(activeTab);
                    let ni = -1;
                    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') ni = (i + 1) % ids.length;
                    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ni = (i - 1 + ids.length) % ids.length;
                    else if (e.key === 'Home') ni = 0;
                    else if (e.key === 'End') ni = ids.length - 1;
                    if (ni >= 0) { e.preventDefault(); const nid = ids[ni]; setTab(nid); requestAnimationFrame(() => tabBtns.current[nid]?.focus()); }
                  }}
                >
                  {tabs.map(t => (
                    <button
                      key={t.id}
                      ref={(el) => { tabBtns.current[t.id] = el; }}
                      role="tab" id={`topotab-${t.id}`}
                      aria-selected={activeTab === t.id}
                      aria-controls={`topopanel-${t.id}`}
                      tabIndex={activeTab === t.id ? 0 : -1}
                      className="topo-tab" onClick={() => setTab(t.id)}
                    >
                      <Ico n={t.icon} className="ico ico-sm" /> {t.label}
                    </button>
                  ))}
                </div>

                <div className="topo-tabpanel" role="tabpanel" id={`topopanel-${activeTab}`}
                     aria-labelledby={`topotab-${activeTab}`} tabIndex={0}>

                  {activeTab === 'overview' && (<>
                    <div className="topo-nd-sect">
                      <div className="topo-nd-sect-hd"><Ico n="grid" className="ico ico-sm" /> Identity</div>
                      <dl className="topo-dl">
                        <dt><Ico n="grid" />Kind</dt><dd>{n.kind}</dd>
                        <dt><Ico n="server" />Tier</dt><dd>{n.tier}</dd>
                        <dt><Ico n="package" />Deployment</dt><dd><code>{n.k8s?.deployment ?? '—'}</code></dd>
                        <dt><Ico n="folder" />Namespace</dt><dd>{n.k8s?.namespace ?? '—'}</dd>
                        <dt><Ico n="check-circle" />Declared</dt><dd>{n.declared ? 'yes' : 'no'}</dd>
                        <dt><Ico n="eye" />Observed</dt><dd>{n.observed ? 'yes' : 'no'}</dd>
                      </dl>
                    </div>
                    <div className="topo-nd-sect">
                      <div className="topo-nd-sect-hd"><Ico n="pulse" className="ico ico-sm" /> Health &amp; runtime
                        {detailLoading && <span className="topo-nd-meta">loading…</span>}
                      </div>
                      <div style={{ padding: '0.1rem 0 0.4rem' }}>
                        <span className={`pill ${healthTone}`}>{n.phantom ? 'not deployed' : n.health}</span>
                        <span className="muted" style={{ marginLeft: '0.6rem' }}>
                          ready {detail?.replicas ? `${detail.replicas.ready}/${detail.replicas.desired}` : `${ready ?? '?'}/${desired ?? '?'}`}
                        </span>
                      </div>
                      {n.phantom && <p className="muted" style={{ margin: 0, fontSize: '0.78rem' }}>Declared in the manifests but no live pod was found — the workload is not currently deployed.</p>}
                      {detail && !detail.error && !n.phantom && (
                        <dl className="topo-dl" style={{ marginTop: '0.2rem' }}>
                          <dt><Ico n="refresh" />Restarts</dt><dd className={detail.restarts > 0 ? 'watch' : ''}>{detail.restarts ?? '—'}</dd>
                          <dt><Ico n="shield" />QoS class</dt><dd>{detail.qosClass ?? '—'}</dd>
                          <dt><Ico n="server" />Pods</dt><dd>{detail.pods ? detail.pods.length : '—'}</dd>
                          {detail.workloadKind && <><dt><Ico n="package" />Workload</dt><dd>{detail.workloadKind}</dd></>}
                          {Array.isArray(detail.images) && detail.images.length > 0 &&
                            <><dt><Ico n="disk" />Image</dt><dd style={{ wordBreak: 'break-all' }}>{detail.images.map((im: string) => <code key={im} style={{ display: 'block', fontSize: '0.72rem' }}>{im}</code>)}</dd></>}
                        </dl>
                      )}
                      {detail?.note && <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.78rem' }}>{detail.note}</p>}
                      {detail?.error && <p className="alert" style={{ margin: '0.4rem 0 0', fontSize: '0.78rem' }}>{detail.error}</p>}
                    </div>
                    {/* v2 (#55): distress signals — restarts/OOM from the live pod scan,
                        error-log pressure from Loki. Click-through loads recent lines. */}
                    {(() => {
                      const sig: any = (n as any).signals;
                      if (!sig || (!sig.errLogs15m && !sig.restarts && !sig.oomKilled)) return null;
                      return (
                        <div className="topo-nd-sect" data-testid="node-signals">
                          <div className="topo-nd-sect-hd"><Ico n="pulse" className="ico ico-sm" /> Signals
                            <span className="topo-nd-meta">k8s scan + Loki</span>
                          </div>
                          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', padding: '0.2rem 0' }}>
                            {sig.oomKilled && <span className="pill alert">OOM-killed</span>}
                            {sig.restarts > 0 && <span className="pill watch">{sig.restarts} restart{sig.restarts > 1 ? 's' : ''}</span>}
                            {sig.errLogs15m > 0 && (
                              <button className="pill watch" style={{ cursor: 'pointer', border: 'none' }}
                                      data-testid="err-badge"
                                      title="Recent error-ish log lines (Loki, 15m). Click for details."
                                      onClick={async () => {
                                        setErrLoading(true);
                                        try { setNodeErrors(await topo.getNodeErrors(n.id)); }
                                        catch { /* panel shows nothing — honest */ }
                                        finally { setErrLoading(false); }
                                      }}>
                                {sig.errLogs15m} error line{sig.errLogs15m > 1 ? 's' : ''} · 15m {errLoading ? '…' : '▸'}
                              </button>
                            )}
                          </div>
                          {nodeErrors && (
                            <div className="topo-events" data-testid="err-panel" style={{ maxHeight: '14rem', overflowY: 'auto' }}>
                              {nodeErrors.lines.length === 0 && <p className="muted" style={{ fontSize: '0.75rem' }}>{nodeErrors.note ?? 'No error lines in the window.'}</p>}
                              {nodeErrors.lines.map((l, i) => (
                                <div key={i} className="topo-event warn">
                                  <span className="topo-event-reason">{new Date(l.ts).toLocaleTimeString()}</span>
                                  <span className="topo-event-msg" style={{ fontFamily: 'monospace', fontSize: '0.7rem', wordBreak: 'break-all' }}>{l.line}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {detail?.events && detail.events.length > 0 && (
                      <div className="topo-nd-sect">
                        <div className="topo-nd-sect-hd"><Ico n="clock" className="ico ico-sm" /> Recent events
                          <span className="topo-nd-meta">k8s Events API</span>
                        </div>
                        <div className="topo-events">
                          {detail.events.map((ev: any, i: number) => (
                            <div key={i} className={`topo-event ${ev.type === 'Warning' ? 'warn' : ''}`}>
                              <span className="topo-event-reason">{ev.reason}{ev.count > 1 ? ` ×${ev.count}` : ''}</span>
                              <span className="topo-event-msg">{ev.message}</span>
                              <span className="topo-event-ago muted">{fmtEvtAgo(ev.lastTimestamp)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>)}

                  {activeTab === 'resources' && (() => {
                    const r = detail?.resources;
                    if (!r) return <p className="muted" style={{ margin: '0.2rem 0 0', fontSize: '0.8rem' }}>{detailLoading ? 'Loading…' : 'No usage data.'}</p>;
                    const cpu = r.cpu || {}, mem = r.memory || {};
                    const cpuMax = cpu.limitMillicores || cpu.requestMillicores || (cpu.usageMillicores ? cpu.usageMillicores * 2 : 0);
                    const memMax = mem.limitBytes || mem.requestBytes || (mem.usageBytes ? mem.usageBytes * 2 : 0);
                    const cpuPct = cpuMax ? Math.min(100, Math.round((cpu.usageMillicores || 0) / cpuMax * 100)) : 0;
                    const memPct = memMax ? Math.min(100, Math.round((mem.usageBytes || 0) / memMax * 100)) : 0;
                    return (
                      <div className="topo-nd-sect">
                        <div className="topo-nd-sect-hd"><Ico n="cpu" className="ico ico-sm" /> Resource usage
                          {r.source && <span className="topo-nd-meta">{r.source}</span>}
                        </div>
                        <div className="topo-metric">
                          <div className="topo-metric-hd"><span><Ico n="cpu" className="ico ico-sm topo-metric-ico" />CPU</span><strong>{fmtCpu(cpu.usageMillicores)}</strong></div>
                          {r.haveMetrics ? bar(cpuPct, cpuPct > 85 ? 'alert' : cpuPct > 60 ? 'watch' : 'good') : <span className="muted" style={{ fontSize: '0.74rem' }}>metrics-server unavailable</span>}
                          <div className="topo-metric-sub muted">req {fmtCpu(cpu.requestMillicores)} · lim {fmtCpu(cpu.limitMillicores)}</div>
                        </div>
                        <div className="topo-metric">
                          <div className="topo-metric-hd"><span><Ico n="server" className="ico ico-sm topo-metric-ico" />Memory</span><strong>{fmtMem(mem.usageBytes)}</strong></div>
                          {r.haveMetrics ? bar(memPct, memPct > 85 ? 'alert' : memPct > 60 ? 'watch' : 'good') : <span className="muted" style={{ fontSize: '0.74rem' }}>metrics-server unavailable</span>}
                          <div className="topo-metric-sub muted">req {fmtMem(mem.requestBytes)} · lim {fmtMem(mem.limitBytes)}</div>
                        </div>
                        <div className="topo-red-slot">
                          <div className="topo-metric-hd"><span>Per-service request rate (RED)</span><span className="pill muted" style={{ fontSize: '0.66rem' }}>pending #26</span></div>
                          <div className="topo-metric-sub muted">{detail?.redNote ?? 'Per-service request rate needs the gateway /metrics scrape (#26). CPU/memory above are real (metrics-server); gateway-centric edge req/s is real too (see the Traffic card / an edge’s detail).'}</div>
                        </div>
                      </div>
                    );
                  })()}

                  {activeTab === 'storage' && (() => {
                    const st = detail?.storage;
                    const stUsed = st?.volumes?.length
                      ? st.volumes.reduce((a: number, v: any) => a + (v.usedBytes || 0), 0)
                      : st?.ephemeral?.usedBytes ?? null;
                    return (
                      <div className="topo-nd-sect">
                        <div className="topo-nd-sect-hd"><Ico n="disk" className="ico ico-sm" /> Storage
                          {stUsed != null && <span className="topo-nd-meta">{fmtBytes(stUsed)} used</span>}
                        </div>
                        {!st || !st.haveStats ? (
                          <p className="muted" style={{ margin: '0.2rem 0 0', fontSize: '0.8rem' }}>{detailLoading ? 'Loading…' : 'kubelet stats unavailable'}</p>
                        ) : (st.volumes.length === 0 && !st.ephemeral) ? (
                          <p className="muted" style={{ margin: '0.2rem 0 0', fontSize: '0.8rem' }}>No persistent volumes on this workload.</p>
                        ) : (
                          <>
                            {st.volumes.map((v: any) => {
                              const p = v.capacityBytes ? Math.min(100, Math.round((v.usedBytes / v.capacityBytes) * 100)) : 0;
                              return (
                                <div key={v.pvc} className="topo-storage-vol">
                                  <div className="topo-storage-vhd"><span className="topo-storage-name" title={v.pvc}>pvc · {v.pvc}</span><span>{fmtBytes(v.usedBytes)} / {fmtBytes(v.capacityBytes)}</span></div>
                                  {bar(p, p > 85 ? 'alert' : p > 60 ? 'watch' : 'good')}
                                </div>
                              );
                            })}
                            {st.ephemeral && <div className="topo-metric-sub muted">ephemeral (writable layer) {fmtBytes(st.ephemeral.usedBytes)}</div>}
                          </>
                        )}
                      </div>
                    );
                  })()}

                  {activeTab === 'logs' && (
                    <div className="topo-nd-sect">
                      <div className="topo-nd-sect-hd"><Ico n="list" className="ico ico-sm" /> Logs
                        <span className="topo-nd-meta">{logs?.pod ? logs.pod : 'kubelet · tail 150'}</span>
                      </div>
                      {logs && logs.containers.length > 1 && (
                        <div className="topo-log-tabs">
                          {logs.containers.map(cn => (
                            <button key={cn} className={`topo-log-tab ${cn === logContainer ? 'on' : ''}`} onClick={() => pickContainer(n.id, cn)}>{cn}</button>
                          ))}
                        </div>
                      )}
                      {logsLoading ? (
                        <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>Loading log tail…</p>
                      ) : logs && logs.lines.length > 0 ? (
                        <div className="topo-logs">
                          {logs.lines.map((ln, i) => (
                            <div key={i} className={`topo-logline ${logLevelClass(ln)}`}>{ln || ' '}</div>
                          ))}
                        </div>
                      ) : (
                        <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>{logs?.note ?? 'No recent log lines.'}</p>
                      )}
                    </div>
                  )}

                  {activeTab === 'config' && hasConfig && (
                    <div className="topo-nd-sect">
                      <div className="topo-nd-sect-hd"><Ico n="key" className="ico ico-sm" /> Config &amp; secrets
                        <span className="topo-nd-meta">{detail.config.secrets.length} secret · {detail.config.configMaps.length} cm</span>
                      </div>
                      <div className="topo-config">
                        {detail.config.secrets.length > 0 && (
                          <div className="topo-config-grp">
                            <div className="topo-config-lbl"><Ico n="key" className="ico ico-sm topo-cfg-ico" />Secrets</div>
                            <div className="topo-chips">
                              {detail.config.secrets.map((s: string) => (
                                <span key={s} className="topo-chip secret" title={s}>{s}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {detail.config.configMaps.length > 0 && (
                          <div className="topo-config-grp">
                            <div className="topo-config-lbl"><Ico n="settings" className="ico ico-sm topo-cfg-ico" />ConfigMaps</div>
                            <div className="topo-chips">
                              {detail.config.configMaps.map((cm: string) => (
                                <span key={cm} className="topo-chip cm" title={cm}>{cm}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {activeTab === 'connections' && (
                    <div className="topo-nd-sect">
                      <div className="topo-nd-sect-hd"><Ico n="link" className="ico ico-sm" /> Connections
                        <span className="topo-nd-meta">{conns.inc.length} in · {conns.out.length} out</span>
                      </div>
                      <div className="topo-conns">
                        {conns.out.length > 0 && <>
                          <div className="topo-conns-lbl">calls →</div>
                          {conns.out.map(e => (
                            <button key={e.id} className="topo-conn" onClick={() => selectFromPanel(e.target)}>
                              <span><Ico n="arrow-right" className="ico ico-sm topo-conn-ico" />{e.target}</span>
                              <span className="muted">{e.kind}{e.traffic ? ` · ${e.traffic.reqRate.toFixed(2)}/s` : ''}</span>
                            </button>
                          ))}
                        </>}
                        {conns.inc.length > 0 && <>
                          <div className="topo-conns-lbl">← called by</div>
                          {conns.inc.map(e => (
                            <button key={e.id} className="topo-conn" onClick={() => selectFromPanel(e.source)}>
                              <span><Ico n="arrow-right" className="ico ico-sm topo-conn-ico" />{e.source}</span>
                              <span className="muted">{e.kind}{e.traffic ? ` · ${e.traffic.reqRate.toFixed(2)}/s` : ''}</span>
                            </button>
                          ))}
                        </>}
                        {conns.inc.length === 0 && conns.out.length === 0 && <p className="muted" style={{ margin: 0 }}>No wired connections.</p>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {sel?.type === 'edge' && (() => {
            const e = sel.edge;
            const t = e.traffic;
            return (
              <div className="card topo-detail-card topo-edge-card">
                <div className="card-hdr">
                  <h5 style={{ margin: 0 }}>
                    <button className="topo-conn topo-conn-inline" onClick={() => selectFromPanel(e.source)}>{e.source}</button>
                    {' → '}
                    <button className="topo-conn topo-conn-inline" onClick={() => selectFromPanel(e.target)}>{e.target}</button>
                  </h5>
                  <button className="btn btn-sm btn-ghost" onClick={() => setSel(null)}>✕</button>
                </div>
                <div style={{ padding: '0.2rem 0' }}>
                  <span className="muted">{e.kind}</span>{' · '}
                  <span className={`pill ${e.status === 'up' ? 'good' : e.status === 'degraded' ? 'watch' : e.status === 'down' ? 'alert' : 'muted'}`}>{e.status}</span>
                </div>
                {t ? (
                  <>
                    <div className="grid grid-4" style={{ marginTop: '0.4rem' }}>
                      <div className="ops-kpi info"><div className="lbl">Req rate</div><div className="v">{t.reqRate.toFixed(2)}<small>/s</small></div><div className="sub">window {t.window}</div></div>
                      <div className="ops-kpi info"><div className="lbl">Error rate</div><div className="v">{(t.errRate * 100).toFixed(1)}%</div><div className="sub">5xx / deny</div></div>
                      <div className="ops-kpi info"><div className="lbl">p95 latency</div><div className="v">{t.p95Ms ?? '—'}<small>ms</small></div><div className="sub">{t.samples} samples</div></div>
                      <div className="ops-kpi info"><div className="lbl">{t.source === 'hubble' && !t.bytes ? 'Flow rate' : 'Volume'}</div><div className="v">{t.source === 'hubble' && !t.bytes ? `${((t as any).flowRate ?? 0).toFixed(2)}` : fmtBytes(t.bytes)}{t.source === 'hubble' && !t.bytes ? <small>/s</small> : null}</div><div className="sub">src: {t.source}</div></div>
                    </div>
                    {(t as any).dropReasons && (
                      <div className="topo-nd-sect" data-testid="edge-drops">
                        <div className="topo-nd-sect-hd"><Ico n="shield" className="ico ico-sm" /> Packet drops by reason
                          <span className="topo-nd-meta">Hubble verdicts</span>
                        </div>
                        <dl className="topo-dl">
                          {Object.entries((t as any).dropReasons as Record<string, number>).map(([r, v]) => (
                            <><dt key={r}><Ico n="shield" />{r}</dt><dd className="watch">{v.toFixed(3)}/s</dd></>
                          ))}
                        </dl>
                      </div>
                    )}
                    <div className="topo-spark-row">
                      <span className="topo-spark-lbl">req/s · {t.window}</span>
                      {t.series && t.series.some(v => v > 0)
                        ? <Sparkline data={t.series} color={t.errRate > 0.01 ? 'var(--watch)' : 'var(--good)'} />
                        : <span className="muted" style={{ fontSize: '0.72rem' }}>no per-bucket samples yet</span>}
                    </div>
                  </>
                ) : (
                  <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.82rem' }}>
                    Structural edge — declared wiring with no measured flows in this window.
                    Traffic sources: <code>gateway_log</code> (HTTP RED on gateway edges) and
                    <code>hubble</code> (CNI-level flows on everything else, incl. lab pods).
                  </p>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </section>
  );
}

/* ── widget-module registration (admin catalog runtime) ─────────────────
   Catalog-collapse (owner 2026-07-07): one organism = ONE grantable widget; this page's single catalog widget id is this module. */
import type { AdminWidget } from '../../runtime/types';
const widget: AdminWidget = {
  id: 'adm-topology',
  Component: Infra,
};
export default widget;
