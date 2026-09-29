/* Futures Quant Platform dashboard.
 *
 * Deliberately dependency-free: everything (candlesticks, equity curve, live
 * stream) is rendered from scratch so the UI has no CDN, no third-party script
 * and no external failure mode. Live data arrives over a websocket; if that
 * drops, polling takes over transparently and the header says so.
 */
'use strict';

const TOKEN_KEY = 'quant.dashboard.token';
let TOKEN = localStorage.getItem(TOKEN_KEY) || '';
let WS = null;
let WS_STATE = 'connecting';
let LAST = null;
let CHART_SYMBOL = null;
let CANDLES = [];
let LOG_LEVEL = 'INFO';
let POLL_TIMER = null;
let CHART_META = {};
let HOVER = null;

/* ------------------------------------------------------------------ utils */
const $ = (id) => document.getElementById(id);

function fmtNum(v, d = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return '–';
  const n = Number(v);
  if (!Number.isFinite(n)) return '–';
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtPrice(v) {
  if (v === null || v === undefined) return '–';
  const n = Number(v);
  if (!Number.isFinite(n)) return '–';
  const a = Math.abs(n);
  if (a >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (a >= 1) return n.toFixed(4);
  if (a >= 0.01) return n.toFixed(5);
  return n.toPrecision(6);
}
function fmtUsd(v, d = 2) {
  if (v === null || v === undefined) return '–';
  const n = Number(v);
  if (!Number.isFinite(n)) return '–';
  const sign = n < 0 ? '-' : '';
  return sign + '$' + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}
function signed(v) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '–';
  const n = Number(v);
  return (n > 0 ? '+' : '') + fmtUsd(n);
}
function cls(v) { const n = Number(v); return Number.isFinite(n) ? (n > 0 ? 'pos' : n < 0 ? 'neg' : '') : ''; }
function pct(v) { return (v === null || v === undefined) ? '–' : fmtNum(v, 2) + '%'; }
function fmtDuration(sec) {
  const s = Number(sec);
  if (!Number.isFinite(s) || s < 0) return '–';
  if (s < 60) return s.toFixed(0) + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm ' + Math.round(s % 60) + 's';
  if (s < 86400) return Math.floor(s / 3600) + 'h ' + Math.round((s % 3600) / 60) + 'm';
  return Math.floor(s / 86400) + 'd ' + Math.round((s % 86400) / 3600) + 'h';
}
function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function ago(ts) {
  if (!ts) return '–';
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return s.toFixed(0) + 's';
  if (s < 3600) return (s / 60).toFixed(1) + 'm';
  if (s < 86400) return (s / 3600).toFixed(1) + 'h';
  return (s / 86400).toFixed(1) + 'd';
}

/* ------------------------------------------------------------ api client */
async function api(path, opts = {}) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(path + sep + 'token=' + encodeURIComponent(TOKEN), {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 || res.status === 403) {
    lock('Token rejected. Check data/dashboard_token.txt.');
    throw new Error('unauthorized');
  }
  if (!res.ok) throw new Error(path + ' -> ' + res.status);
  return res.json();
}

/* --------------------------------------------------------------- gate */
function lock(msg) {
  $('token-gate').classList.remove('hidden');
  $('token-msg').textContent = msg || '';
  if (WS) { try { WS.close(); } catch (e) {} WS = null; }
}
function unlock() {
  $('token-gate').classList.add('hidden');
  connect();
}

$('token-save').onclick = () => {
  const v = $('token-input').value.trim();
  if (!v) { $('token-msg').textContent = 'Token required.'; return; }
  TOKEN = v;
  localStorage.setItem(TOKEN_KEY, v);
  unlock();
};
$('token-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('token-save').click(); });

/* ------------------------------------------------------------ ws stream */
function connect() {
  if (POLL_TIMER) { clearInterval(POLL_TIMER); POLL_TIMER = null; }
  if (WS) { try { WS.close(); } catch (e) {} }
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  const url = proto + location.host + '/ws?token=' + encodeURIComponent(TOKEN);
  WS_STATE = 'connecting';
  paintHeader();
  try {
    WS = new WebSocket(url);
  } catch (e) {
    WS_STATE = 'error'; startPolling(); return;
  }
  WS.onopen = () => { WS_STATE = 'open'; paintHeader(); };
  WS.onmessage = (ev) => {
    try { onSnapshot(JSON.parse(ev.data)); } catch (e) { /* ignore malformed frame */ }
  };
  WS.onerror = () => { WS_STATE = 'error'; };
  WS.onclose = () => {
    WS_STATE = 'closed';
    paintHeader();
    startPolling();
    setTimeout(() => { if (WS_STATE !== 'open') connect(); }, 4000);
  };
}

/* Polling fallback so the dashboard still works if websockets are blocked. */
function startPolling() {
  if (POLL_TIMER) return;
  const tick = async () => {
    if (WS_STATE === 'open') return;
    try { onSnapshot(await api('/api/state')); } catch (e) { /* keep trying */ }
  };
  tick();
  POLL_TIMER = setInterval(tick, 5000);
}

/* ------------------------------------------------------------- snapshot */
function onSnapshot(s) {
  LAST = s;
  paintHeader();
  paintBanners();
  paintControl();
  paintPositions();
  paintSymbols();
  paintCosts();
  paintHealth();
  paintParams();
  paintOrdersAndTrades();
  paintEquity();
  maybeLoadCandles();
  loadLogs();
}

function paintHeader() {
  if (!LAST) {
    $('hd-sub').textContent = 'connecting…';
    return;
  }
  const p = LAST.portfolio, r = LAST.risk;
  const e = LAST.engine, f = LAST.feed;
  const live = LAST.mode === 'live';

  $('hd-sub').textContent = (LAST.symbols ? LAST.symbols.length + ' symbols · ' + LAST.interval : '')
    + (LAST.venue ? ' · ' + String(LAST.venue).toUpperCase() + ' ' + (LAST.market_type || '') : '');

  const mode = $('hd-mode');
  mode.textContent = live ? 'LIVE TRADING' : 'PAPER (real data)';
  mode.className = 'pill ' + (live ? 'live' : 'paper');

  const t = $('hd-trading');
  if (r.halted) { t.textContent = 'HALTED · ' + (r.halt_reasons || []).join(', '); t.className = 'pill bad'; }
  else if (e.signals_seen === 0) { t.textContent = 'RUNNING · no signals yet'; t.className = 'pill ok'; }
  else { t.textContent = 'RUNNING'; t.className = 'pill ok'; }

  const fd = $('hd-feed');
  const age = f.last_message_age_s;
  const stale = age === null || age === undefined || age > 300;
  fd.textContent = 'feed ' + (stale ? 'STALE ' : 'ok ') + (age === null || age === undefined ? '–' : fmtNum(age, 1) + 's');
  fd.className = 'pill ' + (stale ? 'bad' : 'ok');

  const w = $('hd-ws');
  w.textContent = 'ws: ' + WS_STATE;
  w.className = 'pill ' + (WS_STATE === 'open' ? 'ok' : WS_STATE === 'connecting' ? 'warn' : 'bad');

  $('k-equity').textContent = fmtUsd(p.equity);
  $('k-net').textContent = signed(p.realized_net);
  $('k-net').className = 'value ' + cls(p.realized_net);
  $('k-unreal').textContent = signed(p.unrealized_net);
  $('k-unreal').className = 'value ' + cls(p.unrealized_net);
  $('k-open').textContent = p.open_positions;
  $('k-dd').textContent = pct(r.drawdown_pct);
  $('k-dd').className = 'value ' + (r.drawdown_pct > 5 ? 'neg' : '');
  $('k-fees').textContent = fmtUsd(p.total_fees);
}

function paintBanners() {
  const box = $('banners');
  const items = [];
  const r = LAST.risk, f = LAST.feed, sc = LAST.selfcheck || {}, st = LAST.engine;

  if (r.halted) {
    items.push(['err', 'Trading is HALTED — ' + (r.halt_reasons || []).join(', ') +
      '. No new positions will be opened. Open positions remain protected by their stops.']);
  }
  if (st.mode === 'live' || LAST.mode === 'live') {
    items.push(['warn', 'LIVE MODE: orders are routed to the exchange with real funds.']);
  }
  if (!f.connected) {
    items.push(['warn', 'Market data websocket is down; REST polling is keeping the store fresh. ' +
      'Trading is blocked while data is stale.']);
  }
  const age = f.last_message_age_s;
  if (age !== null && age !== undefined && age > 90) {
    items.push(['warn', 'Last market data message was ' + fmtNum(age, 0) + 's ago.']);
  }
  if (st.reconcile_issues && st.reconcile_issues.length) {
    items.push(['warn', 'Reconciliation issues: ' + st.reconcile_issues.join(' · ')]);
  }
  if (st.error_count > 0 && st.last_error) {
    items.push(['warn', 'Last error: ' + st.last_error]);
  }
  if (sc.balance_error) items.push(['err', 'Exchange balance fetch failed: ' + sc.balance_error]);

  if (!items.length) {
    box.innerHTML = '<div class="banner ok">All systems nominal — data fresh, risk guards clear, no divergence.</div>';
    return;
  }
  box.innerHTML = items.map(([k, m]) => '<div class="banner ' + k + '">' + esc(m) + '</div>').join('');
}

function paintControl() {
  const e = LAST.engine, ex = LAST.execution || {}, p = LAST.params || {};
  $('ctrl-mode').textContent = LAST.mode + (LAST.live_armed ? ' (armed)' : '')
    + (LAST.venue ? ' · ' + LAST.venue : '');
  $('ctrl-interval').textContent = LAST.interval;
  $('ctrl-orders').textContent = (ex.orders_today ?? 0) + ' / ' + (ex.max_orders_per_day ?? '–');
  $('ctrl-params').textContent = 'v' + (p.version || 0) + (p.status ? ' · ' + p.status : '');
  $('ctrl-uptime').textContent = fmtDuration(e.uptime_s);
  $('btn-halt').disabled = !!LAST.risk.halted;
  $('btn-resume').disabled = !LAST.risk.halted;
  $('ctrl-note').textContent = 'ticks ' + (e.ticks || 0) + ' · scans ' + (e.entry_scans || 0);
}

function paintPositions() {
  const ps = (LAST.portfolio.positions || []);
  $('pos-count').textContent = ps.length + ' open';
  if (!ps.length) {
    $('positions').innerHTML = '<div class="empty">No open positions. The engine opens a position only when ' +
      'a verified edge clears the round-trip cost hurdle.</div>';
    return;
  }
  const rows = ps.map((p) => {
    const rr = p.r_now;
    return '<tr class="clickable" data-sym="' + esc(p.symbol) + '">' +
      '<td><b>' + esc(p.symbol) + '</b><br><span class="tag ' + esc(p.side) + '">' + esc(p.side) + '</span></td>' +
      '<td class="num">' + fmtPrice(p.qty) + '</td>' +
      '<td class="num">' + fmtPrice(p.entry_price) + '</td>' +
      '<td class="num">' + fmtPrice(p.mark_price) + '</td>' +
      '<td class="num">' + fmtPrice(p.stop) + (p.breakeven_moved ? ' <span class="small muted">BE</span>' : '') +
        (p.trailing_active ? ' <span class="small muted">TR</span>' : '') + '</td>' +
      '<td class="num">' + fmtPrice(p.target) + '</td>' +
      '<td class="num">' + fmtUsd(p.notional) + '</td>' +
      '<td class="num ' + cls(rr) + '">' + (rr === null ? '–' : fmtNum(rr, 2) + 'R') + '</td>' +
      '<td class="num ' + cls(p.unrealized_net) + '">' + signed(p.unrealized_net) + '</td>' +
      '<td class="num muted">' + fmtUsd(p.fees_paid, 4) + '</td>' +
      '<td class="num muted">' + fmtUsd(p.funding_paid, 4) + '</td>' +
      '<td class="num muted">' + fmtNum(p.cost_bps_at_entry, 1) + '</td>' +
      '<td class="num small muted">' + fmtNum(p.expected_edge_bps, 1) + '</td>' +
      '</tr>';
  }).join('');
  $('positions').innerHTML =
    '<table><thead><tr><th>Symbol / Side</th><th class="num">Qty</th><th class="num">Entry</th>' +
    '<th class="num">Mark</th><th class="num">Stop</th><th class="num">Target</th><th class="num">Notional</th>' +
    '<th class="num">R now</th><th class="num">Unreal. net</th><th class="num">Fees</th>' +
    '<th class="num">Funding</th><th class="num">Cost bps</th><th class="num">Edge bps</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table>';
  $('positions').querySelectorAll('tr[data-sym]').forEach((tr) => {
    tr.onclick = () => { CHART_SYMBOL = tr.dataset.sym; loadCandles(true); };
  });
}

// Renders the per-symbol setup-gap evidence as one plain sentence, so an operator can read
// "no trades" as normal or abnormal instead of being left to guess. The comparison is against
// the symbol's OWN measured gap distribution, not a fixed number of hours.
function setupCalibration(r) {
  if (!r || !r.setup_state) return '';
  const since = r.bars_since_last_setup;
  if (r.setup_state === 'in_setup') return ' · setup on the latest closed bar';
  if (r.setup_state === 'no_historical_setups') {
    return ' · entry rules have not fired in the stored history';
  }
  if (since === null || since === undefined) return '';
  const med = r.setup_gap_median_bars;
  const p90 = r.setup_gap_p90_bars;
  const gaps = (med === null || med === undefined)
    ? '' : " (this symbol's median gap " + fmtNum(med, 0) + ', p90 ' + fmtNum(p90, 0) + ')';
  if (r.setup_state === 'elongated_idle') {
    return ' · no setup for ' + since + ' bars — outside normal spacing' + gaps;
  }
  return ' · no setup for ' + since + ' bars, normal' + gaps;
}

// Where the last tick's time actually went — the evidence an overrun investigation needs.
function phaseSummary(phases) {
  if (!phases) return '–';
  const parts = Object.entries(phases);
  if (!parts.length) return '–';
  return parts.map(([k, v]) => k + ' ' + fmtNum(v, 0) + 'ms').join(' · ');
}

function paintSymbols() {
  const rows = LAST.symbol_rows || [];
  if (!rows.length) { $('symbols').innerHTML = '<div class="empty">Loading universe…</div>'; return; }
  const body = rows.map((r) => {
    const dirTag = r.direction === 'FLAT' ? '' : '<span class="tag ' + esc(r.direction) + '">' + esc(r.direction) + '</span>';
    const act = r.enabled === false ? '<span class="tag SHORT">DISABLED</span>'
      : r.last_action === 'SKIP' ? '<span class="tag SKIP">SKIP</span>'
      : r.last_action === 'HOLD' ? '<span class="tag HOLD">HOLD</span>' : esc(r.last_action);
    const edge = r.edge_bps;
    const hurdle = r.hurdle_bps;
    const pass = hurdle > 0 && edge >= hurdle;
    return '<tr class="clickable" data-sym="' + esc(r.symbol) + '">' +
      '<td><b>' + esc(r.symbol) + '</b> ' + dirTag +
        (r.enabled === false ? ' <span class="tag SHORT" title="' + esc(r.gate_reason) + '">GATED</span>' : '') + '</td>' +
      '<td class="num">' + fmtPrice(r.price) + '</td>' +
      '<td class="num ' + cls(r.change_24h_pct) + '">' + (r.change_24h_pct === null ? '–' : fmtNum(r.change_24h_pct, 2) + '%') + '</td>' +
      '<td class="num">' + fmtNum(r.spread_bps, 3) + '</td>' +
      '<td class="num">' + (r.funding_rate === null || r.funding_rate === undefined ? '–' : (r.funding_rate * 100).toFixed(4) + '%') + '</td>' +
      '<td>' + esc(r.regime) + '</td>' +
      '<td class="num ' + (pass ? 'pos' : 'muted') + '">' + (r.edge_reliable ? fmtNum(edge, 1) : '<span title="not enough historical samples to verify an edge">n/a</span>') + '</td>' +
      '<td class="num muted">' + (hurdle > 0 ? fmtNum(hurdle, 1) : 'n/a') + '</td>' +
      '<td class="num ' + (r.net_edge_bps > 0 ? 'pos' : 'neg') + '">' + fmtNum(r.net_edge_bps, 1) + '</td>' +
      '<td class="num muted small">' + (r.edge_samples || 0) + (r.min_edge_samples ? '/' + r.min_edge_samples : '') + '</td>' +
      '<td>' + act + '</td>' +
      '<td class="small muted" style="text-align:left;white-space:normal;max-width:420px">' +
        esc(r.enabled === false ? r.gate_reason : (r.last_decision || r.trigger)) +
        esc(setupCalibration(r)) + '</td>' +
      '</tr>';
  }).join('');
  $('symbols').innerHTML =
    '<table><thead><tr><th>Symbol</th><th class="num">Price</th><th class="num">24h</th>' +
    '<th class="num">Spread bps</th><th class="num">Funding</th><th>Regime</th>' +
    '<th class="num">Edge bps</th><th class="num">Hurdle</th><th class="num">Net bps</th>' +
    '<th class="num">N</th><th>Action</th><th style="text-align:left">Why</th></tr></thead><tbody>' +
    body + '</tbody></table>';
  $('symbols').querySelectorAll('tr[data-sym]').forEach((tr) => {
    tr.onclick = () => { CHART_SYMBOL = tr.dataset.sym; loadCandles(true); };
  });
  if (!CHART_SYMBOL && rows.length) { CHART_SYMBOL = rows[0].symbol; loadCandles(true); }
}

function paintCosts() {
  const s = LAST.portfolio.stats || {};
  const c = LAST.costs || {};
  const rows = [
    ['Starting equity', fmtUsd(LAST.portfolio.starting_equity)],
    ['Equity now', fmtUsd(LAST.portfolio.equity)],
    ['Total return', pct(s.total_return_pct)],
    ['Realised gross', fmtUsd(s.realized_gross)],
    ['Realised net (after all costs)', '<span class="' + cls(s.realized_net) + '">' + signed(s.realized_net) + '</span>'],
    ['Fees paid', fmtUsd(s.total_fees)],
    ['Funding paid (neg = received)', fmtUsd(s.total_funding)],
    ['Slippage cost', fmtUsd(s.total_slippage)],
    ['Total cost drag', fmtUsd(s.cost_drag)],
    ['Cost as % of gross', pct(s.cost_as_pct_of_gross)],
    ['Trades / W / L', (s.trades || 0) + ' / ' + (s.wins || 0) + ' / ' + (s.losses || 0)],
    ['Win rate', pct(s.win_rate)],
    ['Profit factor', s.profit_factor === null ? '∞' : fmtNum(s.profit_factor, 3)],
    ['Expectancy / trade', fmtUsd(s.expectancy_per_trade, 4)],
    ['Max drawdown', pct(s.max_drawdown_pct)],
    ['Model: maker / taker fee', fmtNum(c.maker_fee_bps, 2) + ' / ' + fmtNum(c.taker_fee_bps, 2) + ' bps'],
    ['Hurdle multiple', fmtNum(c.hurdle_multiplier, 2) + '× cost'],
    ['Minimum edge', fmtNum(c.min_edge_bps, 1) + ' bps'],
  ];
  $('costs').innerHTML = rows.map(([k, v]) =>
    '<div class="k">' + esc(k) + '</div><div class="v">' + v + '</div>').join('');
}

function paintHealth() {
  const e = LAST.engine, f = LAST.feed, sc = LAST.selfcheck || {}, r = LAST.risk;
  const rows = [
    ['Mode', LAST.mode + (LAST.live_armed ? ' · ARMED' : '')],
    ['Uptime', fmtNum(e.uptime_s, 0) + ' s'],
    ['Last tick', ago(e.last_tick_ts) + ' ago'],
    ['Ticks', e.ticks],
    ['Entry scans', e.entry_scans],
    ['Signals seen / rejected', (e.signals_seen || 0) + ' / ' + (e.signals_rejected || 0)],
    ['Positions opened / closed', (e.trades_opened || 0) + ' / ' + (e.trades_closed || 0)],
    ['Feed connected', f.connected ? 'yes' : 'NO'],
    ['Feed age', (f.last_message_age_s ?? '–') + ' s'],
    ['WS reconnects / errors', (f.reconnects || 0) + ' / ' + (f.errors || 0)],
    ['REST polls', f.rest_polls],
    ['Loop errors', e.loop_errors || 0],
    ['Tick time (last / max)', fmtNum(e.last_tick_ms || 0, 0) + ' / ' + fmtNum(e.max_tick_ms || 0, 0) + ' ms'],
    ['Slow ticks (window / total)', (e.slow_ticks_recent || 0) + ' / ' + (e.slow_ticks || 0) +
      (e.slow_tick_alert_threshold ? ' (alert at ' + e.slow_tick_alert_threshold + '/' + fmtNum(e.slow_tick_window_s || 0, 0) + 's)' : '') +
      ((e.slow_tick_alerts || 0) > 0 ? ' · ' + e.slow_tick_alerts + ' reported' : '')],
    ['Last tick phases', phaseSummary(e.last_tick_phases)],
    ['Total errors', e.error_count || 0],
    ['Last error', e.last_error || 'none'],
    ['Risk state', r.halted ? 'HALTED' : 'clear'],
    ['Halt reasons', (r.halt_reasons || []).join(', ') || 'none'],
    ['Consecutive losses', r.consecutive_losses],
    ['Peak equity', fmtUsd(r.peak_equity)],
    ['Day start equity', fmtUsd(r.day_start_equity)],
    ['Daily PnL', signed(r.daily_pnl) + ' (' + pct(r.daily_pnl_pct) + ')'],
    ['Learning runs', e.learning_runs || 0],
    ['Last learning verdict', e.last_learning_verdict || '–'],
    ['Last rollback (version)', e.last_rollback_version || 0],
    ['Reconcile issues', (e.reconcile_issues || []).length ? e.reconcile_issues.join(' · ') : 'none'],
  ];
  if (sc.exchange_wallet_balance !== undefined) {
    rows.push(['Exchange wallet balance', fmtUsd(sc.exchange_wallet_balance)]);
    rows.push(['Exchange available', fmtUsd(sc.exchange_available)]);
  }
  $('health').innerHTML = rows.map(([k, v]) =>
    '<div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div>').join('');
}

function paintParams() {
  const p = LAST.params || {};
  const g = ['ema_fast', 'ema_slow', 'adx_min', 'donchian_period', 'atr_stop_mult',
             'tp_r_multiple', 'breakout_buffer_atr', 'min_momentum_atr', 'require_htf_alignment'];
  const rows = [['Version', 'v' + (p.version || 0)], ['Status', p.status || 'genesis'],
                ['OOS net bps', fmtNum(p.oos_net_bps, 3)], ['OOS trades', p.oos_trades || 0],
                ['OOS win rate', pct((p.oos_win_rate || 0) * 100)],
                ['Score', fmtNum(p.score, 4)], ['Note', p.note || '–']];
  g.forEach((k) => rows.push([k, String(p[k] ?? '–')]));
  $('params').innerHTML = rows.map(([k, v]) =>
    '<div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div>').join('');

  const hist = (LAST.learning && LAST.learning.history) || [];
  if (!hist.length) {
    $('params-history').innerHTML = '<div class="empty">No optimisation history yet. ' +
      'The optimiser promotes parameters only when they beat the incumbent out-of-sample.</div>';
    return;
  }
  const body = hist.map((h) =>
    '<tr><td>v' + h.version + ' <span class="tag ' + (h.status === 'active' ? 'LONG' : 'HOLD') + '">' +
      esc(h.status) + '</span></td>' +
    '<td class="num">' + fmtNum(h.oos_net_bps, 2) + '</td>' +
    '<td class="num">' + (h.oos_trades || 0) + '</td>' +
    '<td class="num">' + fmtNum(h.score, 3) + '</td>' +
    '<td class="small muted" style="text-align:left;white-space:normal;max-width:360px">' + esc(h.note) + '</td>' +
    '<td>' + (h.status === 'active' ? '' : '<button data-roll="' + h.version + '">Roll back</button>') + '</td></tr>'
  ).join('');
  $('params-history').innerHTML =
    '<table><thead><tr><th>Version</th><th class="num">OOS bps</th><th class="num">Trades</th>' +
    '<th class="num">Score</th><th style="text-align:left">Verdict</th><th></th></tr></thead><tbody>' +
    body + '</tbody></table>';
  $('params-history').querySelectorAll('button[data-roll]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try {
        const r = await api('/api/learning/rollback', { method: 'POST', body: { version: Number(b.dataset.roll) } });
        flash(r.message);
      } catch (e) { flash('rollback failed: ' + e.message); }
      b.disabled = false;
    };
  });
}

async function paintOrdersAndTrades() {
  try {
    const [o, t] = await Promise.all([api('/api/orders?limit=40'), api('/api/trades?limit=40')]);
    $('orders-count').textContent = o.orders.length + ' recent';
    $('trades-count').textContent = t.trades.length + ' recent';
    $('orders').innerHTML = o.orders.length ? '<table><thead><tr><th>Time</th><th>Symbol</th><th>Side</th>' +
      '<th class="num">Qty</th><th class="num">Fill</th><th class="num">Fee</th><th>Status</th><th>Intent</th>' +
      '<th style="text-align:left">Error</th></tr></thead><tbody>' +
      o.orders.map((x) => '<tr><td class="small">' + esc(x.created_iso.slice(11, 19)) + '</td>' +
        '<td>' + esc(x.symbol) + '</td><td>' + esc(x.side) + '</td>' +
        '<td class="num">' + fmtPrice(x.qty) + '</td>' +
        '<td class="num">' + fmtPrice(x.avg_fill_price) + '</td>' +
        '<td class="num">' + fmtUsd(x.fee, 4) + '</td>' +
        '<td><span class="tag ' + (x.status === 'FILLED' ? 'LONG' : x.status === 'REJECTED' ? 'SHORT' : 'HOLD') + '">' +
          esc(x.status) + '</span></td>' +
        '<td class="small muted">' + esc(x.intent) + '</td>' +
        '<td class="small muted" style="text-align:left;white-space:normal;max-width:220px">' + esc(x.error) + '</td></tr>'
      ).join('') + '</tbody></table>' : '<div class="empty">No orders yet.</div>';

    $('trades').innerHTML = t.trades.length ? '<table><thead><tr><th>Closed</th><th>Symbol</th><th>Side</th>' +
      '<th class="num">Entry</th><th class="num">Exit</th><th class="num">Gross</th><th class="num">Fees</th>' +
      '<th class="num">Funding</th><th class="num">Net</th><th class="num">R</th><th>Exit</th></tr></thead><tbody>' +
      t.trades.map((x) => '<tr><td class="small">' + esc((x.closed_iso || '').slice(5, 16).replace('T', ' ')) + '</td>' +
        '<td>' + esc(x.symbol) + '</td><td>' + esc(x.side) + '</td>' +
        '<td class="num">' + fmtPrice(x.entry_price) + '</td>' +
        '<td class="num">' + fmtPrice(x.exit_price) + '</td>' +
        '<td class="num">' + fmtUsd(x.gross_pnl) + '</td>' +
        '<td class="num muted">' + fmtUsd(x.fees, 4) + '</td>' +
        '<td class="num muted">' + fmtUsd(x.funding, 4) + '</td>' +
        '<td class="num ' + cls(x.net_pnl) + '">' + signed(x.net_pnl) + '</td>' +
        '<td class="num ' + cls(x.r_multiple) + '">' + fmtNum(x.r_multiple, 2) + '</td>' +
        '<td class="small muted">' + esc(x.exit_reason) + '</td></tr>').join('') + '</tbody></table>'
      : '<div class="empty">No closed trades yet.</div>';
  } catch (e) { /* transient */ }
}

/* ---------------------------------------------------------- equity chart */
function paintEquity() {
  const cv = $('equity-chart');
  const pts = (LAST.portfolio && LAST.portfolio._curve) || EQUITY_CACHE || [];
  if (!pts.length) { clearCanvas(cv, 'no equity data yet'); return; }
  const W = fitCanvas(cv), H = cv.clientHeight;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const vals = pts.map((p) => p.equity);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.12 || Math.max(hi * 0.001, 1);
  const y0 = lo - pad, y1 = hi + pad;
  const X = (i) => (i / Math.max(pts.length - 1, 1)) * (W - 52) + 4;
  const Y = (v) => H - 18 - ((v - y0) / (y1 - y0)) * (H - 28);

  // grid + labels
  ctx.strokeStyle = '#1c2836'; ctx.fillStyle = '#7d8fa3'; ctx.font = '10px ui-monospace, monospace';
  ctx.lineWidth = 1;
  for (let k = 0; k <= 4; k++) {
    const v = y0 + ((y1 - y0) * k) / 4;
    const y = Y(v);
    ctx.beginPath(); ctx.moveTo(4, y); ctx.lineTo(W - 48, y); ctx.stroke();
    ctx.fillText(fmtUsd(v, 0), W - 44, y + 3);
  }
  // zero-return baseline
  const base = pts[0].equity;
  if (base > y0 && base < y1) {
    ctx.strokeStyle = '#3d5266'; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(4, Y(base)); ctx.lineTo(W - 48, Y(base)); ctx.stroke();
    ctx.setLineDash([]);
  }
  // area + line
  const up = pts[pts.length - 1].equity >= base;
  ctx.beginPath();
  pts.forEach((p, i) => { const x = X(i), y = Y(p.equity); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.lineWidth = 1.8; ctx.strokeStyle = up ? '#26a69a' : '#ef5350'; ctx.stroke();
  ctx.lineTo(X(pts.length - 1), H - 18); ctx.lineTo(X(0), H - 18); ctx.closePath();
  ctx.fillStyle = up ? 'rgba(38,166,154,.12)' : 'rgba(239,83,80,.12)'; ctx.fill();
}
let EQUITY_CACHE = null;

async function loadEquity() {
  try {
    const e = await api('/api/equity?limit=2000');
    EQUITY_CACHE = e.curve;
    if (LAST) LAST.portfolio._curve = e.curve;
    paintEquity();
  } catch (err) { /* ignore */ }
}

/* --------------------------------------------------------- candle chart */
function fitCanvas(cv) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || cv.parentElement.clientWidth || 600;
  const h = cv.clientHeight || 300;
  if (cv.width !== Math.floor(w * dpr) || cv.height !== Math.floor(h * dpr)) {
    cv.width = Math.floor(w * dpr); cv.height = Math.floor(h * dpr);
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return w;
}
function clearCanvas(cv, msg) {
  const W = fitCanvas(cv), H = cv.clientHeight;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#7d8fa3'; ctx.font = '12px sans-serif';
  ctx.fillText(msg, 12, 24);
}

async function loadCandles(force) {
  if (!CHART_SYMBOL) return;
  if (!force && CANDLES.length && CHART_SYMBOL === CANDLES.symbol) return;
  try {
    const r = await api('/api/candles?symbol=' + encodeURIComponent(CHART_SYMBOL) + '&limit=300');
    CANDLES = r.candles; CANDLES.symbol = r.symbol; CANDLES.interval = r.interval;
    drawCandles();
  } catch (e) { /* ignore */ }
}

function maybeLoadCandles() {
  if (!CANDLES.symbol || CANDLES.symbol !== CHART_SYMBOL) { loadCandles(true); return; }
  if (!CANDLES.length) return;
  const row = (LAST.symbol_rows || []).find((r) => r.symbol === CHART_SYMBOL);
  if (!row || row.price === null || row.price === undefined) return;
  // Patch the forming bar so the chart ticks with the live price instead of
  // waiting for the next closed candle.
  const last = CANDLES[CANDLES.length - 1];
  last.close = row.price;
  last.high = Math.max(last.high, row.price);
  last.low = Math.min(last.low, row.price);
  drawCandles();
}

function drawCandles() {
  const cv = $('chart');
  const data = CANDLES;
  if (!data || !data.length) { clearCanvas(cv, 'loading candles for ' + (CHART_SYMBOL || '…')); return; }

  const W = fitCanvas(cv);
  const H = cv.clientHeight;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const PLOT_R = 74, PLOT_L = 6, VOL_H = Math.floor(H * 0.18), TIME_H = 18;
  const plotW = W - PLOT_R - PLOT_L;
  const plotTop = 6, plotBot = H - VOL_H - TIME_H - 6;

  let lo = Infinity, hi = -Infinity, vmax = 0;
  for (const c of data) {
    lo = Math.min(lo, c.low); hi = Math.max(hi, c.high); vmax = Math.max(vmax, c.volume);
  }
  const pos = (LAST.portfolio.positions || []).find((p) => p.symbol === CHART_SYMBOL);
  if (pos) {
    [pos.entry_price, pos.stop, pos.target, pos.mark_price].forEach((v) => {
      if (v > 0) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    });
  }
  const padP = (hi - lo) * 0.06 || hi * 0.002 || 1;
  lo -= padP; hi += padP;

  const n = data.length;
  const cw = plotW / n;
  const X = (i) => PLOT_L + i * cw + cw / 2;
  const Y = (p) => plotBot - ((p - lo) / (hi - lo)) * (plotBot - plotTop);
  const VY = (v) => H - TIME_H - 2 - (v / (vmax || 1)) * (VOL_H - 6);

  // --- grid + price axis
  ctx.strokeStyle = '#18232f'; ctx.lineWidth = 1;
  ctx.fillStyle = '#7d8fa3'; ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'left';
  for (let k = 0; k <= 5; k++) {
    const p = lo + ((hi - lo) * k) / 5;
    const y = Y(p);
    ctx.beginPath(); ctx.moveTo(PLOT_L, y); ctx.lineTo(W - PLOT_R, y); ctx.stroke();
    ctx.fillText(fmtPrice(p), W - PLOT_R + 6, y + 3);
  }

  // --- volume
  for (let i = 0; i < n; i++) {
    const c = data[i];
    const up = c.close >= c.open;
    ctx.fillStyle = up ? 'rgba(38,166,154,.35)' : 'rgba(239,83,80,.35)';
    const y = VY(c.volume);
    ctx.fillRect(X(i) - Math.max(cw * 0.35, 0.6), y, Math.max(cw * 0.7, 1), H - TIME_H - 2 - y);
  }

  // --- candles
  const bw = Math.max(cw * 0.62, 1);
  for (let i = 0; i < n; i++) {
    const c = data[i];
    const up = c.close >= c.open;
    const col = up ? '#26a69a' : '#ef5350';
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
    const x = X(i);
    ctx.beginPath(); ctx.moveTo(x, Y(c.high)); ctx.lineTo(x, Y(c.low)); ctx.stroke();
    const yo = Y(c.open), yc = Y(c.close);
    const top = Math.min(yo, yc), hgt = Math.max(Math.abs(yc - yo), 1);
    ctx.fillRect(x - bw / 2, top, bw, hgt);
  }

  // --- position overlays
  if (pos) {
    const line = (price, color, label, dash) => {
      if (!price || price <= 0) return;
      const y = Y(price);
      if (y < plotTop - 4 || y > plotBot + 4) return;
      ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.setLineDash(dash || []);
      ctx.beginPath(); ctx.moveTo(PLOT_L, y); ctx.lineTo(W - PLOT_R, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color; ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'left';
      ctx.fillText(label + ' ' + fmtPrice(price), PLOT_L + 4, y - 3);
    };
    line(pos.entry_price, '#4d9fff', 'ENTRY');
    line(pos.stop, '#ef5350', 'STOP', [5, 4]);
    line(pos.target, '#26a69a', 'TARGET', [5, 4]);
  }

  // --- last price marker
  const lastC = data[n - 1];
  const lp = lastC.close;
  const ly = Y(lp);
  ctx.strokeStyle = '#7d8fa3'; ctx.setLineDash([2, 3]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PLOT_L, ly); ctx.lineTo(W - PLOT_R, ly); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#2b3a4a';
  ctx.fillRect(W - PLOT_R + 2, ly - 8, PLOT_R - 4, 16);
  ctx.fillStyle = '#dbe6f2'; ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'center';
  ctx.fillText(fmtPrice(lp), W - PLOT_R / 2, ly + 3);

  // --- time axis
  ctx.textAlign = 'center'; ctx.fillStyle = '#5d6f83'; ctx.font = '10px ui-monospace, monospace';
  const step = Math.max(1, Math.floor(n / 8));
  for (let i = 0; i < n; i += step) {
    const d = new Date(data[i].time * 1000);
    const label = String(d.getUTCDate()).padStart(2, '0') + ' ' +
                  String(d.getUTCHours()).padStart(2, '0') + 'h';
    ctx.fillText(label, X(i), H - 5);
  }

  // --- hover crosshair
  if (HOVER && HOVER.i >= 0 && HOVER.i < n) {
    const c = data[HOVER.i];
    ctx.strokeStyle = '#4a5f75'; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(X(HOVER.i), plotTop); ctx.lineTo(X(HOVER.i), H - TIME_H); ctx.stroke();
    ctx.setLineDash([]);
    const lines = [
      new Date(c.time * 1000).toISOString().replace('T', ' ').slice(0, 16) + 'Z',
      'O ' + fmtPrice(c.open) + '  H ' + fmtPrice(c.high),
      'L ' + fmtPrice(c.low) + '  C ' + fmtPrice(c.close),
      'Vol ' + fmtNumberShort(c.volume),
    ];
    const bwid = 168, bh = 14 * lines.length + 10;
    let bx = X(HOVER.i) + 10; if (bx + bwid > W - PLOT_R) bx = X(HOVER.i) - bwid - 10;
    ctx.fillStyle = 'rgba(13,19,25,.94)'; ctx.strokeStyle = '#2a3a4c';
    ctx.fillRect(bx, plotTop + 4, bwid, bh); ctx.strokeRect(bx, plotTop + 4, bwid, bh);
    ctx.fillStyle = '#dbe6f2'; ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'left';
    lines.forEach((s, k) => ctx.fillText(s, bx + 7, plotTop + 18 + k * 14));
  }

  // --- chart meta
  const row = (LAST.symbol_rows || []).find((r) => r.symbol === CHART_SYMBOL);
  $('chart-sym-label').textContent = CHART_SYMBOL + ' · ' + (data.interval || '');
  const meta = row ? [
    ['Price', fmtPrice(row.price)],
    ['24h change', (row.change_24h_pct === null ? '–' : fmtNum(row.change_24h_pct, 2) + '%')],
    ['Spread', fmtNum(row.spread_bps, 3) + ' bps'],
    ['Funding rate', row.funding_rate === null ? '–' : (row.funding_rate * 100).toFixed(4) + '%'],
    ['24h quote volume', row.quote_volume_24h ? '$' + fmtNumberShort(row.quote_volume_24h) : '–'],
    ['Regime', row.regime],
    ['Last bar age', (row.last_bar_age_s ?? '–') + ' s'],
    ['Bars loaded', data.length],
  ] : [['Symbol', CHART_SYMBOL]];
  $('chart-meta').innerHTML = meta.map(([k, v]) =>
    '<div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div>').join('');
}

function fmtNumberShort(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '–';
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(2);
}

/* canvas interaction */
(function initChartInteractions() {
  const cv = $('chart');
  const move = (ev) => {
    const data = CANDLES;
    if (!data || !data.length) return;
    const rect = cv.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const W = cv.clientWidth;
    const PLOT_R = 74, PLOT_L = 6;
    const plotW = W - PLOT_R - PLOT_L;
    const idx = Math.floor(((x - PLOT_L) / plotW) * data.length);
    HOVER = { i: Math.max(0, Math.min(data.length - 1, idx)) };
    drawCandles();
  };
  cv.addEventListener('mousemove', move);
  cv.addEventListener('mouseleave', () => { HOVER = null; drawCandles(); });
})();

/* -------------------------------------------------------------- logs */
let LOGS_PAUSED = false;
async function loadLogs() {
  if (LOGS_PAUSED) return;
  try {
    const r = await api('/api/logs?limit=250&level=' + LOG_LEVEL);
    const box = $('logbox');
    const html = r.logs.slice(-250).map((l) => {
      const t = (l.iso || '').slice(11, 19);
      return '<div class="row"><span class="ts">' + esc(t) + '</span>' +
        '<span class="lv ' + esc(l.level) + '">' + esc(l.level) + '</span>' +
        '<span class="msg">' + esc(l.msg) + '</span></div>';
    }).join('');
    if (html !== box.dataset.hash) { box.innerHTML = html; box.dataset.hash = html; box.scrollTop = box.scrollHeight; }
    $('logs-note').textContent = r.logs.length + ' lines';
  } catch (e) { /* ignore */ }
}

/* ----------------------------------------------------------- controls */
function flash(msg) {
  const box = $('banners');
  const d = document.createElement('div');
  d.className = 'banner ok';
  d.textContent = msg;
  box.prepend(d);
  setTimeout(() => d.remove(), 6000);
}

$('btn-halt').onclick = async () => {
  if (!confirm('Halt trading? No new positions will open. Open positions keep their stops.')) return;
  const r = await api('/api/control/halt', { method: 'POST' }); flash(r.message);
};
$('btn-resume').onclick = async () => {
  if (!confirm('Clear all halts and resume trading?')) return;
  const r = await api('/api/control/resume', { method: 'POST' }); flash(r.message);
};
$('btn-flatten').onclick = async () => {
  if (!confirm('Flatten ALL open positions at market? This is irreversible.')) return;
  const r = await api('/api/control/flatten', { method: 'POST' });
  flash(r.message);
};
$('btn-learn').onclick = async () => {
  const b = $('btn-learn'); b.disabled = true; b.textContent = 'Optimising…';
  try {
    const r = await api('/api/learning/run', { method: 'POST' });
    flash('Optimisation verdict: ' + r.message + ' — ' + (r.detail && r.detail.reason || ''));
  } catch (e) { flash('optimisation failed: ' + e.message); }
  b.disabled = false; b.textContent = 'Run optimisation';
};
$('btn-logs-warn').onclick = () => {
  LOG_LEVEL = LOG_LEVEL === 'INFO' ? 'WARNING' : 'INFO';
  $('btn-logs-warn').textContent = LOG_LEVEL === 'INFO' ? 'Warnings+' : 'All levels';
  loadLogs();
};
$('btn-logs-clear').onclick = () => { $('logbox').innerHTML = ''; $('logbox').dataset.hash = ''; };

/* --------------------------------------------------------------- boot */
window.addEventListener('resize', () => { drawCandles(); paintEquity(); });

(async function boot() {
  if (!TOKEN) { lock(''); return; }
  // Validate the stored token before opening the stream.
  try {
    await api('/api/state');
    unlock();
    await loadEquity();
    setInterval(loadEquity, 15000);
    setInterval(() => { if (WS_STATE !== 'open') paintEquity(); }, 15000);
  } catch (e) {
    if (String(e.message) !== 'unauthorized') lock('Cannot reach the server: ' + e.message);
  }
})();
