'use strict';

// Savings Explorer - frontend logic for the CAST AI estimated-savings endpoints.
// Vanilla JS, no build step, no secrets on the client. Data comes from the
// dashboard's own read-only proxy routes:
//   /api/orgs
//   /api/clusters
//   /api/clusters/:id/estimated-savings
//   /api/clusters/:id/estimated-savings-history
// All cluster-scoped calls accept ?orgId= to address a Siemens sub-org.

(function () {
  const CLUSTERS_ENDPOINT = '/api/clusters';
  const ORGS_ENDPOINT = '/api/orgs';
  const FALLBACK_PCT = 40; // The flat assumption this view is meant to replace.
  // Preferred default sub-org when no #org= hash is supplied (Siemens CPS).
  const DEFAULT_ORG_ID = '5e413e89-eb67-48fb-b81c-6172baa988ed';

  const SCENARIO_COLORS = ['#00a3a6', '#1d6fb8', '#d97706', '#7c3aed', '#e11d48', '#0891b2'];
  const CURRENT_COLOR = '#94a3b8';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const dom = {
    refreshBtn: document.getElementById('refresh-btn'),
    exportBtn: document.getElementById('export-btn'),
    exportBtnLabel: document.getElementById('export-btn-label'),
    errorBanner: document.getElementById('error-banner'),
    errorMessage: document.getElementById('error-banner__message'),
    errorDismiss: document.getElementById('error-banner__dismiss'),
    loading: document.getElementById('loading'),
    content: document.getElementById('content'),
    emptyState: document.getElementById('empty-state'),
    lastUpdated: document.getElementById('last-updated'),
    orgSelect: document.getElementById('org-select'),
    clusterSelect: document.getElementById('cluster-select'),
    dateFrom: document.getElementById('date-from'),
    dateTo: document.getElementById('date-to'),
    presets: document.querySelectorAll('.chip[data-days]'),
    spotToggle: document.getElementById('spot-toggle'),
    armToggle: document.getElementById('arm-toggle'),
    statCurrent: document.getElementById('stat-current'),
    statScenarioCost: document.getElementById('stat-scenario-cost'),
    statForecastPct: document.getElementById('stat-forecast-pct'),
    statForecastScenario: document.getElementById('stat-forecast-scenario'),
    statDelta: document.getElementById('stat-delta'),
    statUpdated: document.getElementById('stat-updated'),
    rebalanceNote: document.getElementById('rebalance-note'),
    scenarioGrid: document.getElementById('scenario-grid'),
    scenarioEmpty: document.getElementById('scenario-empty'),
    historyChart: document.getElementById('history-chart'),
    historyLegend: document.getElementById('history-legend'),
    medianBody: document.getElementById('median-body'),
    historyEmpty: document.getElementById('history-empty'),
  };

  const state = {
    orgs: [],
    orgId: '',       // '' = env default org on the server
    clusters: [],
    clusterId: null,
    spotAllowed: false,
    armAllowed: false,
    pinnedKey: null,
    snapshot: null, // parsed estimated-savings
    history: null,  // parsed history
  };

  // ---------- Formatting helpers ----------

  function safe(value, fallback) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'number' && !Number.isFinite(value)) return fallback;
    if (typeof value === 'string' && value.trim() === '') return fallback;
    return value;
  }

  // CAST AI numeric fields may arrive as JSON numbers or numeric strings.
  function parseNum(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  function firstNum() {
    for (const v of arguments) {
      const n = parseNum(v);
      if (n !== null) return n;
    }
    return null;
  }

  function formatCurrency(value, maxDigits) {
    const v = parseNum(value);
    if (v === null) return 'N/A';
    return v.toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: maxDigits != null ? maxDigits : 0,
    });
  }

  function formatRateHour(value) {
    const v = parseNum(value);
    if (v === null) return 'N/A';
    return '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '/h';
  }

  // savingsPercentage arrives either as a fraction (0.42) or as 42.
  function normalizePct(value) {
    const v = parseNum(value);
    if (v === null) return null;
    return Math.abs(v) <= 1 ? v * 100 : v;
  }

  function formatPct(value, digits) {
    const v = normalizePct(value);
    if (v === null) return 'N/A';
    return v.toLocaleString(undefined, {
      minimumFractionDigits: digits != null ? digits : 1,
      maximumFractionDigits: digits != null ? digits : 1,
    }) + '%';
  }

  function formatDateTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'N/A';
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  }

  function formatShortDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // ---------- Scenario model ----------

  function humanize(key) {
    return String(key)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^./, (c) => c.toUpperCase());
  }

  // History keys carry an "optimized" prefix that snapshot keys lack
  // ("optimizedLayman" vs "Layman") - strip it for display consistency.
  function displayScenarioName(key) {
    return humanize(String(key).replace(/^optimized/i, ''));
  }

  // Classify a recommendation key into the constraint buckets used by the
  // forecast toggles: 'spot', 'arm', 'mixed' (spot+arm), or 'rightsize'.
  function classifyScenario(key) {
    const k = String(key).toLowerCase();
    const hasSpot = /spot/.test(k);
    const hasArm = /arm|graviton/.test(k);
    if (hasSpot && hasArm) return 'mixed';
    if (hasSpot) return 'spot';
    if (hasArm) return 'arm';
    return 'rightsize';
  }

  function categoryLabel(cls) {
    switch (cls) {
      case 'spot': return 'Spot';
      case 'arm': return 'ARM';
      case 'mixed': return 'Spot + ARM';
      default: return 'Rightsizing';
    }
  }

  function categoryBadgeClass(cls) {
    switch (cls) {
      case 'spot': return 'badge--accent';
      case 'arm': return 'badge--neutral';
      case 'mixed': return 'badge--warn';
      default: return 'badge--ok';
    }
  }

  function scenarioEligible(cls) {
    if (cls === 'spot') return state.spotAllowed;
    if (cls === 'arm') return state.armAllowed;
    if (cls === 'mixed') return state.spotAllowed && state.armAllowed;
    return true; // rightsizing is always allowed
  }

  // A cost field may be a plain number, a numeric string, or a pair object
  // {priceBefore, priceAfter} (the actual API shape). costFrom() takes the
  // "after" (optimized) side; costBeforeFrom() exposes the "before" side.
  function costFrom(value) {
    const n = parseNum(value);
    if (n !== null) return n;
    if (value && typeof value === 'object') return firstNum(value.priceAfter, value.cost, value.price);
    return null;
  }

  function costBeforeFrom(value) {
    if (value && typeof value === 'object') return parseNum(value.priceBefore);
    return null;
  }

  // details is an object: {configurationAfter: {nodes: [{instanceType, spot, ...}]}}.
  // Reduce it to a compact one-liner like "14 nodes | 10x m6a.8xlarge + 4x c6a | 4 on spot".
  function summarizeDetails(details) {
    if (!details || typeof details !== 'object') {
      return details != null ? String(details) : null;
    }
    const ca = details.configurationAfter;
    const nodes = ca && Array.isArray(ca.nodes) ? ca.nodes : null;
    if (!nodes || nodes.length === 0) return null;

    const byType = new Map();
    let spotCount = 0;
    for (const n of nodes) {
      if (!n || typeof n !== 'object') continue;
      const type = n.instanceType != null ? String(n.instanceType) : 'unknown';
      byType.set(type, (byType.get(type) || 0) + 1);
      if (n.spot === true) spotCount += 1;
    }
    const types = Array.from(byType.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([type, count]) => `${count}x ${type}`)
      .join(' + ');
    const more = byType.size > 2 ? ` +${byType.size - 2} more` : '';
    const spotBit = spotCount > 0 ? ` \u00B7 ${spotCount} on spot` : '';
    return `${nodes.length} nodes \u00B7 ${types}${more}${spotBit}`;
  }

  function parseSnapshot(payload) {
    const recs = [];
    const rawRecs = payload && payload.recommendations && typeof payload.recommendations === 'object'
      ? payload.recommendations
      : {};
    for (const key of Object.keys(rawRecs)) {
      const r = rawRecs[key];
      if (!r || typeof r !== 'object') continue;
      recs.push({
        key,
        label: humanize(key),
        cls: classifyScenario(key),
        hourly: costFrom(r.hourly),
        hourlyBefore: costBeforeFrom(r.hourly),
        monthly: costFrom(r.monthly),
        monthlyBefore: costBeforeFrom(r.monthly),
        pct: parseNum(r.savingsPercentage),
        armSavingsMonthly: parseNum(r.armSavingsMonthly),
        details: summarizeDetails(r.details),
      });
    }
    recs.sort((a, b) => (normalizePct(b.pct) || 0) - (normalizePct(a.pct) || 0));

    const cc = payload && payload.currentConfiguration && typeof payload.currentConfiguration === 'object'
      ? payload.currentConfiguration
      : {};
    // Live shape: currentConfiguration.totalPrice = {hourly, monthly} (string
    // prices). Fall back to flatter variants defensively.
    const tp = cc.totalPrice && typeof cc.totalPrice === 'object' ? cc.totalPrice : {};
    const currentMonthly = firstNum(tp.monthly, cc.monthlyCost, cc.costMonthly, cc.monthlyPrice)
      ?? costFrom(cc.monthly);
    const currentHourly = firstNum(tp.hourly, cc.hourlyCost, cc.costPerHour, cc.hourlyPrice)
      ?? costFrom(cc.hourly);

    return {
      recommendations: recs,
      currentMonthly,
      currentHourly,
      isRebalancingRecommended: payload && payload.isRebalancingRecommended === true,
      lastUpdatedAt: payload && payload.lastUpdatedAt ? String(payload.lastUpdatedAt) : null,
    };
  }

  function parseHistory(payload) {
    const items = payload && Array.isArray(payload.items) ? payload.items
      : (Array.isArray(payload) ? payload : []);
    const points = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const t = item.createdAt || item.timestamp || null;
      if (!t) continue;
      const current = item.current && typeof item.current === 'object'
        ? firstNum(item.current.costPerHour, item.current.hourly, item.current.cost)
        : null;
      const scenarios = {};
      for (const key of Object.keys(item)) {
        if (key === 'createdAt' || key === 'timestamp' || key === 'current') continue;
        const v = item[key];
        if (!v || typeof v !== 'object') continue;
        const cost = firstNum(v.costPerHour, v.hourly, v.cost);
        if (cost !== null) scenarios[key] = cost;
      }
      points.push({ t, current, scenarios });
    }
    points.sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());
    return points;
  }

  // Median of daily savings percentages for one scenario over the history.
  function medianDailySavings(points, scenarioKey) {
    const pcts = [];
    for (const p of points) {
      if (p.current == null || p.current <= 0) continue;
      const scen = p.scenarios[scenarioKey];
      if (scen == null) continue;
      pcts.push((1 - scen / p.current) * 100);
    }
    if (pcts.length === 0) return { median: null, days: 0 };
    pcts.sort((a, b) => a - b);
    const mid = Math.floor(pcts.length / 2);
    const median = pcts.length % 2 === 0 ? (pcts[mid - 1] + pcts[mid]) / 2 : pcts[mid];
    return { median, days: pcts.length };
  }

  // ---------- Forecast selection ----------

  function pickForecastScenario() {
    const recs = state.snapshot ? state.snapshot.recommendations : [];
    if (state.pinnedKey) {
      const pinned = recs.find((r) => r.key === state.pinnedKey);
      if (pinned && scenarioEligible(pinned.cls)) {
        return { scenario: pinned, pinned: true };
      }
    }
    const eligible = recs.filter((r) => scenarioEligible(r.cls) && normalizePct(r.pct) !== null);
    if (eligible.length === 0) return { scenario: null, pinned: false };
    const best = eligible.reduce((a, b) =>
      (normalizePct(b.pct) || 0) > (normalizePct(a.pct) || 0) ? b : a);
    return { scenario: best, pinned: false };
  }

  // Current monthly cost: prefer the API field, then the forecast scenario's
  // own priceBefore, then any scenario's priceBefore, then derive from
  // monthly / (1 - pct), else from the latest history point.
  function currentMonthlyCost(forecast) {
    const snap = state.snapshot;
    if (snap && snap.currentMonthly !== null) return snap.currentMonthly;
    if (snap && snap.currentHourly !== null) return snap.currentHourly * 730;
    if (forecast) {
      if (typeof forecast.monthlyBefore === 'number') return forecast.monthlyBefore;
      if (typeof forecast.hourlyBefore === 'number') return forecast.hourlyBefore * 730;
      if (typeof forecast.monthly === 'number') {
        const pct = normalizePct(forecast.pct);
        if (pct !== null && pct < 100) return forecast.monthly / (1 - pct / 100);
      }
    }
    const recs = snap ? snap.recommendations : [];
    for (const r of recs) {
      if (typeof r.monthlyBefore === 'number') return r.monthlyBefore;
      if (typeof r.hourlyBefore === 'number') return r.hourlyBefore * 730;
    }
    const points = state.history || [];
    for (let i = points.length - 1; i >= 0; i -= 1) {
      if (points[i].current != null) return points[i].current * 730;
    }
    return null;
  }

  // ---------- DOM helpers ----------

  function el(tag, options) {
    const node = document.createElement(tag);
    if (!options) return node;
    if (options.className) node.className = options.className;
    if (options.text != null) node.textContent = options.text;
    if (options.attrs) {
      for (const key of Object.keys(options.attrs)) node.setAttribute(key, options.attrs[key]);
    }
    if (options.children) {
      for (const child of options.children) if (child) node.appendChild(child);
    }
    return node;
  }

  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const key of Object.keys(attrs)) node.setAttribute(key, attrs[key]);
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // ---------- UI state ----------

  function showLoading() {
    dom.errorBanner.hidden = true;
    dom.loading.hidden = false;
    if (dom.refreshBtn) dom.refreshBtn.disabled = true;
  }

  function hideLoading() {
    dom.loading.hidden = true;
    if (dom.refreshBtn) dom.refreshBtn.disabled = false;
  }

  function showError(message) {
    dom.errorMessage.textContent = safe(message, 'Unable to load savings data. Please try again.');
    dom.errorBanner.hidden = false;
  }

  function hideError() {
    dom.errorBanner.hidden = true;
    dom.errorMessage.textContent = '';
  }

  function friendlyErrorMessage(err) {
    if (err && err.status === 401) return 'You are not authorized to view savings data.';
    if (err && err.status === 403) return 'Access to savings data is forbidden.';
    if (err && err.status === 404) return 'Savings endpoint was not found for this cluster.';
    if (err && err.status === 400) return 'The request was invalid. Check the selected dates.';
    if (err && err.status === 429) return 'Too many requests. Please wait and try again.';
    if (err && (err.status >= 500 && err.status <= 504)) {
      return 'The savings service is temporarily unavailable. Please try again shortly.';
    }
    return 'Unable to load savings data. Please check your connection and try again.';
  }

  async function fetchJson(url) {
    const opts = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout)
      ? { signal: AbortSignal.timeout(20_000) }
      : {};
    const res = await fetch(url, opts);
    if (!res.ok) {
      const err = new Error('request failed');
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  // ---------- Rendering: stat strip ----------

  function renderStats() {
    const { scenario, pinned } = pickForecastScenario();
    const currentMonthly = currentMonthlyCost(scenario);
    const pct = scenario ? normalizePct(scenario.pct) : null;

    dom.statCurrent.textContent = formatCurrency(currentMonthly);
    dom.statScenarioCost.textContent = scenario ? formatCurrency(scenario.monthly) : 'N/A';
    dom.statForecastPct.textContent = scenario ? formatPct(scenario.pct, 1) : 'N/A';
    dom.statForecastScenario.textContent = scenario
      ? (pinned ? '\u{1F4CC} ' : '') + scenario.label
      : 'no eligible scenario';

    clear(dom.statDelta);
    if (pct === null) {
      dom.statDelta.textContent = '—';
      dom.statDelta.className = 'stat__delta';
    } else {
      const delta = pct - FALLBACK_PCT;
      const sign = delta > 0 ? '+' : '';
      dom.statDelta.textContent = sign + delta.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' pts';
      dom.statDelta.className = 'stat__delta ' + (delta >= 0 ? 'stat__delta--up' : 'stat__delta--down');
      dom.statDelta.title = 'Flat assumption: ' + FALLBACK_PCT + '%';
    }

    dom.statUpdated.textContent = state.snapshot && state.snapshot.lastUpdatedAt
      ? formatDateTime(state.snapshot.lastUpdatedAt)
      : 'N/A';
    dom.rebalanceNote.hidden = !(state.snapshot && state.snapshot.isRebalancingRecommended);
  }

  // ---------- Rendering: scenario cards ----------

  function renderScenarios() {
    clear(dom.scenarioGrid);
    const recs = state.snapshot ? state.snapshot.recommendations : [];
    dom.scenarioEmpty.hidden = recs.length > 0;
    const { scenario: forecast } = pickForecastScenario();

    const frag = document.createDocumentFragment();
    recs.forEach((r, i) => {
      const eligible = scenarioEligible(r.cls);
      const isForecast = forecast && forecast.key === r.key;
      const pctText = formatPct(r.pct, 1);
      const pctNum = normalizePct(r.pct);

      const bar = el('div', { className: 'bar', children: [
        (function () {
          const fill = el('div', { className: 'bar__fill' });
          fill.style.width = pctNum === null ? '0%' : Math.max(0, Math.min(100, pctNum)) + '%';
          return fill;
        })(),
      ] });

      const badges = [el('span', { className: 'badge ' + categoryBadgeClass(r.cls), text: categoryLabel(r.cls) })];
      if (!eligible) badges.push(el('span', { className: 'badge badge--muted', text: 'Excluded by constraints' }));
      if (isForecast) badges.push(el('span', { className: 'badge badge--neutral', text: 'Forecast' }));

      const card = el('button', {
        className: 'scenario-card'
          + (isForecast ? ' scenario-card--forecast' : '')
          + (eligible ? '' : ' scenario-card--excluded'),
        attrs: { type: 'button', 'data-scenario-key': r.key, 'aria-pressed': String(isForecast) },
        children: [
          el('div', { className: 'scenario-card__top', children: [
            el('span', { className: 'scenario-card__name', text: r.label }),
            el('span', { className: 'scenario-card__badges', children: badges }),
          ] }),
          el('span', { className: 'scenario-card__pct', text: pctText }),
          bar,
          el('dl', { className: 'kv', children: [
            el('div', { className: 'kv__row', children: [
              el('dt', { className: 'kv__key', text: 'Monthly' }),
              el('dd', { className: 'kv__val', text: formatCurrency(r.monthly) }),
            ] }),
            el('div', { className: 'kv__row', children: [
              el('dt', { className: 'kv__key', text: 'Hourly' }),
              el('dd', { className: 'kv__val', text: formatRateHour(r.hourly) }),
            ] }),
            r.armSavingsMonthly !== null
              ? el('div', { className: 'kv__row', children: [
                  el('dt', { className: 'kv__key', text: 'ARM uplift /mo' }),
                  el('dd', { className: 'kv__val', text: formatCurrency(r.armSavingsMonthly) }),
                ] })
              : null,
          ] }),
          r.details ? el('p', { className: 'scenario-card__details', text: r.details }) : null,
        ],
      });

      card.style.setProperty('--scenario-hue', SCENARIO_COLORS[i % SCENARIO_COLORS.length]);
      card.addEventListener('click', () => {
        state.pinnedKey = (state.pinnedKey === r.key) ? null : r.key;
        renderAll();
      });
      frag.appendChild(card);
    });
    dom.scenarioGrid.appendChild(frag);
  }

  // ---------- Rendering: history chart ----------

  function buildLinePath(points, xOf, yOf) {
    let d = '';
    let started = false;
    for (const p of points) {
      if (p.v == null) { started = false; continue; }
      const x = xOf(p.t).toFixed(2);
      const y = yOf(p.v).toFixed(2);
      d += (started ? ' L' : 'M') + x + ' ' + y;
      started = true;
    }
    return d;
  }

  function renderHistory() {
    clear(dom.historyChart);
    clear(dom.historyLegend);
    clear(dom.medianBody);

    const points = state.history || [];
    dom.historyEmpty.hidden = points.length > 0;
    if (points.length === 0) return;

    const scenarioKeys = [];
    for (const p of points) {
      for (const key of Object.keys(p.scenarios)) {
        if (!scenarioKeys.includes(key)) scenarioKeys.push(key);
      }
    }

    let max = 0;
    for (const p of points) {
      if (p.current != null) max = Math.max(max, p.current);
      for (const key of scenarioKeys) {
        if (p.scenarios[key] != null) max = Math.max(max, p.scenarios[key]);
      }
    }
    if (max <= 0) max = 1;

    const W = 760, H = 280, PL = 58, PR = 18, PT = 18, PB = 30;
    const t0 = new Date(points[0].t).getTime();
    const t1 = new Date(points[points.length - 1].t).getTime();
    const span = Math.max(1, t1 - t0);
    const xOf = (t) => PL + ((new Date(t).getTime() - t0) / span) * (W - PL - PR);
    const yOf = (v) => PT + (1 - v / (max * 1.05)) * (H - PT - PB);

    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'history-chart__svg', 'aria-hidden': 'true' });

    for (let i = 0; i <= 4; i += 1) {
      const v = (max * 1.05 * i) / 4;
      const y = yOf(v);
      svg.appendChild(svgEl('line', {
        x1: PL, x2: W - PR, y1: y, y2: y, class: 'history-chart__grid',
      }));
      const label = svgEl('text', { x: PL - 8, y: y + 4, class: 'history-chart__ylabel' });
      label.textContent = '$' + v.toLocaleString(undefined, { maximumFractionDigits: 2 });
      svg.appendChild(label);
    }

    const xticks = [points[0].t, points[Math.floor(points.length / 2)].t, points[points.length - 1].t];
    for (const t of xticks) {
      const label = svgEl('text', { x: xOf(t), y: H - 8, class: 'history-chart__xlabel' });
      label.textContent = formatShortDate(t);
      svg.appendChild(label);
    }

    const currentSeries = points.map((p) => ({ t: p.t, v: p.current }));
    svg.appendChild(svgEl('path', {
      d: buildLinePath(currentSeries, xOf, yOf),
      class: 'history-chart__line history-chart__line--current',
      stroke: CURRENT_COLOR,
    }));

    scenarioKeys.forEach((key, i) => {
      const color = SCENARIO_COLORS[i % SCENARIO_COLORS.length];
      const series = points.map((p) => ({ t: p.t, v: p.scenarios[key] != null ? p.scenarios[key] : null }));
      svg.appendChild(svgEl('path', {
        d: buildLinePath(series, xOf, yOf),
        class: 'history-chart__line',
        stroke: color,
      }));
      for (const s of series) {
        if (s.v == null) continue;
        const dot = svgEl('circle', { cx: xOf(s.t), cy: yOf(s.v), r: 2.5, fill: color });
        const title = svgEl('title', {});
        title.textContent = `${displayScenarioName(key)} — ${formatRateHour(s.v)} — ${formatDateTime(s.t)}`;
        dot.appendChild(title);
        svg.appendChild(dot);
      }
    });

    dom.historyChart.appendChild(svg);

    const legendFrag = document.createDocumentFragment();
    legendFrag.appendChild(el('span', { className: 'history-legend__item', children: [
      el('span', { className: 'history-legend__swatch', attrs: { style: `background:${CURRENT_COLOR}` } }),
      el('span', { text: 'Current' }),
    ] }));
    scenarioKeys.forEach((key, i) => {
      legendFrag.appendChild(el('span', { className: 'history-legend__item', children: [
        el('span', { className: 'history-legend__swatch', attrs: { style: `background:${SCENARIO_COLORS[i % SCENARIO_COLORS.length]}` } }),
        el('span', { text: displayScenarioName(key) }),
      ] }));
    });
    dom.historyLegend.appendChild(legendFrag);

    const medianFrag = document.createDocumentFragment();
    for (const key of scenarioKeys) {
      const stat = medianDailySavings(points, key);
      medianFrag.appendChild(el('tr', { children: [
        el('td', { text: displayScenarioName(key) }),
        el('td', { className: 'median-table__num', text: stat.median === null ? 'N/A' : stat.median.toFixed(1) + '%' }),
        el('td', { className: 'median-table__num', text: String(stat.days) }),
      ] }));
    }
    dom.medianBody.appendChild(medianFrag);
  }

  function renderAll() {
    renderStats();
    renderScenarios();
    renderHistory();
  }

  // ---------- Fetching ----------

  function apiBase() {
    return CLUSTERS_ENDPOINT + '/' + encodeURIComponent(state.clusterId);
  }

  // Appends the selected sub-org to a proxied API path (no-op when the
  // server-side env default org is in force).
  function withOrg(url) {
    if (!state.orgId) return url;
    return url + (url.includes('?') ? '&' : '?') + 'orgId=' + encodeURIComponent(state.orgId);
  }

  function parseHash() {
    return {
      org: (location.hash.match(/org=([0-9A-Fa-f-]{36})/) || [])[1] || '',
      cluster: (location.hash.match(/cluster=([A-Za-z0-9_-]+)/) || [])[1] || '',
    };
  }

  function updateHash() {
    const parts = [];
    if (state.orgId) parts.push('org=' + state.orgId);
    if (state.clusterId) parts.push('cluster=' + state.clusterId);
    location.hash = parts.join('&');
  }

  function setEmptyMessage(title, message) {
    const h = dom.emptyState.querySelector('.empty-state__title');
    const p = dom.emptyState.querySelector('.empty-state__message');
    if (h) h.textContent = title;
    if (p) p.textContent = message;
  }

  async function loadOrgs() {
    const hash = parseHash();
    clear(dom.orgSelect);
    let orgs;
    try {
      orgs = await fetchJson(ORGS_ENDPOINT);
    } catch (_err) {
      // Org directory unreachable: degrade to the server-side default org.
      state.orgs = [];
      state.orgId = '';
      dom.orgSelect.appendChild(el('option', {
        text: 'Server default organization',
        attrs: { value: '' },
      }));
      return;
    }

    state.orgs = Array.isArray(orgs) ? orgs : [];
    for (const o of state.orgs) {
      dom.orgSelect.appendChild(el('option', {
        text: safe(o.name, 'Unnamed org') || 'Unnamed org',
        attrs: { value: String(o.id) },
      }));
    }

    const pick = state.orgs.find((o) => String(o.id) === hash.org)
      || state.orgs.find((o) => String(o.id) === DEFAULT_ORG_ID)
      || state.orgs[0]
      || null;
    state.orgId = pick ? String(pick.id) : '';
    dom.orgSelect.value = state.orgId;
  }

  async function loadClusters() {
    showLoading();
    hideError();
    let list;
    try {
      list = await fetchJson(withOrg(CLUSTERS_ENDPOINT + '?basic=true'));
    } catch (err) {
      hideLoading();
      dom.content.hidden = true;
      dom.emptyState.hidden = true;
      if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        showError('The request timed out. Please try again.');
      } else if (err && err.status) {
        showError(friendlyErrorMessage(err));
      } else {
        showError('Network error. Please check your connection and try again.');
      }
      return;
    }

    state.clusters = Array.isArray(list) ? list : [];
    clear(dom.clusterSelect);
    if (state.clusters.length === 0) {
      hideLoading();
      dom.content.hidden = true;
      setEmptyMessage('No clusters in this organization',
        'This organization has no clusters connected to CAST AI. Pick another organization above.');
      dom.emptyState.hidden = false;
      return;
    }
    dom.emptyState.hidden = true;

    for (const c of state.clusters) {
      dom.clusterSelect.appendChild(el('option', {
        text: (safe(c.name, 'Unnamed cluster') || 'Unnamed cluster') + ' — ' + safe(c.id, ''),
        attrs: { value: String(c.id) },
      }));
    }

    const fromHash = parseHash().cluster;
    const preselect = state.clusters.find((c) => String(c.id) === fromHash) || state.clusters[0];
    state.clusterId = String(preselect.id);
    dom.clusterSelect.value = state.clusterId;

    await loadSavings();
  }

  async function loadSavings() {
    if (!state.clusterId) return;
    showLoading();
    hideError();
    state.pinnedKey = null;
    updateHash();

    const from = dom.dateFrom.value;
    const to = dom.dateTo.value;
    const historyUrl = withOrg(apiBase() + '/estimated-savings-history?fromDate='
      + encodeURIComponent(from) + '&toDate=' + encodeURIComponent(to));

    let snapshotPayload = null;
    let historyPayload = null;
    let firstErr = null;
    try {
      const [snap, hist] = await Promise.allSettled([
        fetchJson(withOrg(apiBase() + '/estimated-savings')),
        fetchJson(historyUrl),
      ]);
      if (snap.status === 'fulfilled') snapshotPayload = snap.value;
      else if (!firstErr) firstErr = snap.reason;
      if (hist.status === 'fulfilled') historyPayload = hist.value;
      else if (!firstErr) firstErr = hist.reason;
    } catch (err) {
      firstErr = err;
    }

    hideLoading();

    if (!snapshotPayload && !historyPayload) {
      showError(friendlyErrorMessage(firstErr));
      return;
    }
    if (firstErr) {
      // Partial success: show what we have, warn about the missing half.
      showError('Some savings data failed to load: ' + friendlyErrorMessage(firstErr));
    }

    state.snapshot = snapshotPayload ? parseSnapshot(snapshotPayload) : { recommendations: [], currentMonthly: null, currentHourly: null, isRebalancingRecommended: false, lastUpdatedAt: null };
    state.history = historyPayload ? parseHistory(historyPayload) : [];
    dom.content.hidden = false;
    renderAll();
    if (dom.lastUpdated) dom.lastUpdated.textContent = 'Updated ' + formatDateTime(new Date().toISOString());
  }

  // ---------- Wiring ----------

  function setWindowDays(days) {
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    dom.dateFrom.value = from.toISOString().slice(0, 10);
    dom.dateTo.value = to.toISOString().slice(0, 10);
  }

  function markActivePreset(days) {
    dom.presets.forEach((chip) => {
      chip.classList.toggle('chip--active', Number(chip.getAttribute('data-days')) === days);
    });
  }

  let dateDebounce = null;
  function onDatesChanged() {
    markActivePreset(NaN);
    if (dateDebounce) clearTimeout(dateDebounce);
    dateDebounce = setTimeout(() => { loadSavings(); }, 400);
  }

  // Downloads the fleet-wide xlsx report. Slow by nature (every org x cluster
  // is queried server-side) - long window, generous timeout, busy label.
  async function exportExcel() {
    const btn = dom.exportBtn;
    const label = dom.exportBtnLabel;
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    if (label) label.textContent = 'Building export\u2026 (can take a few minutes)';
    hideError();
    try {
      const opts = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout)
        ? { signal: AbortSignal.timeout(600_000) }
        : {};
      const res = await fetch('/api/export/savings-potential.xlsx', opts);
      if (!res.ok) {
        let msg = 'Export failed.';
        try {
          const body = await res.json();
          if (body && body.error) msg = 'Export failed: ' + body.error;
        } catch (_e) { /* keep generic message */ }
        throw { status: res.status, message: msg };
      }
      const blob = await res.blob();
      const dispo = res.headers.get('Content-Disposition') || '';
      const m = dispo.match(/filename="([^"]+)"/);
      const filename = m ? m[1] : 'castai-savings-potential.xlsx';

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        showError('The export timed out. Try again, or export a single organization.');
      } else if (err && err.message) {
        showError(err.message);
      } else {
        showError('Export failed. Please try again.');
      }
    } finally {
      btn.disabled = false;
      if (label) label.textContent = 'Export Excel';
    }
  }

  function init() {
    setWindowDays(14);

    if (dom.refreshBtn) dom.refreshBtn.addEventListener('click', () => { loadSavings(); });
    if (dom.exportBtn) dom.exportBtn.addEventListener('click', exportExcel);
    if (dom.errorDismiss) dom.errorDismiss.addEventListener('click', hideError);
    if (dom.orgSelect) {
      dom.orgSelect.addEventListener('change', () => {
        state.orgId = dom.orgSelect.value;
        state.clusterId = null;
        updateHash();
        loadClusters();
      });
    }
    if (dom.clusterSelect) {
      dom.clusterSelect.addEventListener('change', () => {
        state.clusterId = dom.clusterSelect.value;
        loadSavings();
      });
    }
    if (dom.spotToggle) {
      dom.spotToggle.addEventListener('change', () => {
        state.spotAllowed = dom.spotToggle.checked;
        renderStats();
        renderScenarios();
      });
    }
    if (dom.armToggle) {
      dom.armToggle.addEventListener('change', () => {
        state.armAllowed = dom.armToggle.checked;
        renderStats();
        renderScenarios();
      });
    }
    dom.presets.forEach((chip) => {
      chip.addEventListener('click', () => {
        const days = Number(chip.getAttribute('data-days'));
        setWindowDays(days);
        markActivePreset(days);
        loadSavings();
      });
    });
    if (dom.dateFrom) dom.dateFrom.addEventListener('change', onDatesChanged);
    if (dom.dateTo) dom.dateTo.addEventListener('change', onDatesChanged);

    (async () => {
      await loadOrgs();
      await loadClusters();
    })();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
