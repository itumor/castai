'use strict';

// Siemens CAST AI Dashboard - frontend logic.
// Fetches cluster data from /api/clusters and renders cards. No frameworks,
// no build step, no secrets on the client.

(function () {
  const ENDPOINT = '/api/clusters';

  const dom = {
    refreshBtn: document.getElementById('refresh-btn'),
    errorBanner: document.getElementById('error-banner'),
    errorMessage: document.getElementById('error-banner__message'),
    errorDismiss: document.getElementById('error-banner__dismiss'),
    loading: document.getElementById('loading'),
    clusters: document.getElementById('clusters'),
    emptyState: document.getElementById('empty-state'),
    lastUpdated: document.getElementById('last-updated'),
  };

  // ---------- Formatting helpers ----------

  function safe(value, fallback) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'number' && !Number.isFinite(value)) return fallback;
    if (typeof value === 'string' && value.trim() === '') return fallback;
    return value;
  }

  function formatNumber(value, options) {
    const v = safe(value, null);
    if (v === null) return 'N/A';
    const opts = options || {};
    const min = opts.min != null ? opts.min : 0;
    const max = opts.max != null ? opts.max : 2;
    if (typeof v !== 'number') return 'N/A';
    return v.toLocaleString(undefined, {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
    });
  }

  function formatPercent(value) {
    const v = safe(value, null);
    if (v === null) return 'N/A';
    if (typeof v !== 'number') return 'N/A';
    // Backend returns fractions like 0.42 meaning 42%.
    const pct = v <= 1 ? v * 100 : v;
    return pct.toLocaleString(undefined, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }) + '%';
  }

  function formatCurrency(value) {
    const v = safe(value, null);
    if (v === null) return 'N/A';
    if (typeof v !== 'number') return 'N/A';
    return v.toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    });
  }

  function formatDateTime(date) {
    try {
      return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch (_err) {
      return '';
    }
  }

  // ---------- Status classification ----------

  // Map a status string into a CSS class plus a friendly label.
  function classifyStatus(status) {
    const s = (safe(status, '') || '').toString().toLowerCase();
    if (s === 'ready' || s === 'running' || s === 'active' || s === 'healthy') {
      return { cls: 'badge--ok', label: 'Ready' };
    }
    if (s === 'warning' || s === 'degraded' || s === 'pending') {
      return { cls: 'badge--warn', label: 'Warning' };
    }
    if (s === 'failed' || s === 'error' || s === 'unhealthy' || s === 'disconnected') {
      return { cls: 'badge--err', label: 'Failed' };
    }
    if (s === 'unknown' || s === '') {
      return { cls: 'badge--muted', label: 'Unknown' };
    }
    return { cls: 'badge--neutral', label: s.charAt(0).toUpperCase() + s.slice(1) };
  }

  function classifyAgentStatus(status) {
    const s = (safe(status, '') || '').toString().toLowerCase();
    if (s === 'connected' || s === 'ok' || s === 'healthy') {
      return { cls: 'badge--ok', label: 'Connected' };
    }
    if (s === 'warning' || s === 'degraded') {
      return { cls: 'badge--warn', label: 'Degraded' };
    }
    if (s === 'disconnected' || s === 'failed' || s === 'error') {
      return { cls: 'badge--err', label: 'Disconnected' };
    }
    if (s === '' || s === 'unknown') {
      return { cls: 'badge--muted', label: 'Unknown' };
    }
    return { cls: 'badge--neutral', label: s.charAt(0).toUpperCase() + s.slice(1) };
  }

  // ---------- DOM helpers ----------

  function el(tag, options) {
    const node = document.createElement(tag);
    if (!options) return node;
    if (options.className) node.className = options.className;
    if (options.text != null) node.textContent = options.text;
    if (options.attrs) {
      for (const key of Object.keys(options.attrs)) {
        node.setAttribute(key, options.attrs[key]);
      }
    }
    if (options.children) {
      for (const child of options.children) {
        if (child) node.appendChild(child);
      }
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // ---------- UI state ----------

  function showLoading() {
    dom.errorBanner.hidden = true;
    dom.emptyState.hidden = true;
    dom.loading.hidden = false;
    dom.clusters.setAttribute('aria-busy', 'true');
    if (dom.refreshBtn) dom.refreshBtn.disabled = true;
  }

  function hideLoading() {
    dom.loading.hidden = true;
    dom.clusters.removeAttribute('aria-busy');
    if (dom.refreshBtn) dom.refreshBtn.disabled = false;
  }

  function showError(message) {
    // Never display raw stack traces, API keys, or any internal detail.
    const safeMessage = safe(message, 'Unable to load cluster data. Please try again.');
    dom.errorMessage.textContent = safeMessage;
    dom.errorBanner.hidden = false;
  }

  function hideError() {
    dom.errorBanner.hidden = true;
    dom.errorMessage.textContent = '';
  }

  // ---------- Rendering ----------

  function renderMetric(label, valueEl) {
    return el('div', { className: 'metric', children: [
      el('span', { className: 'metric__label', text: label }),
      el('span', { className: 'metric__value', children: valueEl ? [valueEl] : [] }),
    ] });
  }

  function renderBar(percentText) {
    // The percentage string already includes the "%" suffix when available.
    const wrap = el('div', { className: 'bar' });
    const fill = el('div', { className: 'bar__fill' });
    fill.style.width = percentText;
    wrap.appendChild(fill);
    return wrap;
  }

  function renderBadge(classification) {
    return el('span', {
      className: 'badge ' + classification.cls,
      text: classification.label,
    });
  }

  function renderClusterCard(cluster) {
    const name = safe(cluster && cluster.name, 'Unnamed cluster');
    const id = safe(cluster && cluster.id, '');
    const provider = safe(cluster && cluster.providerType, 'N/A');
    const region = safe(cluster && cluster.region, 'N/A');
    const statusClass = classifyStatus(cluster && cluster.status);
    const agentClass = classifyAgentStatus(cluster && cluster.agentStatus);
    const nodeCount = safe(cluster && cluster.nodeCount, null);

    const resources = (cluster && cluster.resources) || {};
    const savings = (cluster && cluster.savings) || {};
    const opportunities = safe(cluster && cluster.workloadOptimizationOpportunities, null);

    // CPU section
    const cpuReqText = formatNumber(resources.cpuRequested, { max: 2 });
    const cpuUsedText = formatNumber(resources.cpuUsed, { max: 2 });
    const cpuPct = formatPercent(resources.cpuUtilization);
    const cpuBar = el('span', { className: 'metric__bar-wrap', children: [renderBar(cpuPct)] });

    // Memory section
    const memReqText = formatNumber(resources.memoryRequested, { max: 2 });
    const memUsedText = formatNumber(resources.memoryUsed, { max: 2 });
    const memPct = formatPercent(resources.memoryUtilization);
    const memBar = el('span', { className: 'metric__bar-wrap', children: [renderBar(memPct)] });

    // Savings
    const currentCost = formatCurrency(savings.currentMonthlyCost);
    const optimizedCost = formatCurrency(savings.optimizedMonthlyCost);
    const savingsAmt = formatCurrency(savings.monthlySavings);
    const savingsPct = formatPercent(savings.savingsPercentage);

    const header = el('header', { className: 'card__header', children: [
      el('div', { className: 'card__title-row', children: [
        el('h2', { className: 'card__title', text: name }),
        renderBadge(statusClass),
      ] }),
      id ? el('span', { className: 'card__id', text: 'ID: ' + id }) : null,
    ] });

    const metaSection = el('section', { className: 'card__section', children: [
      el('h3', { className: 'card__section-title', text: 'Cluster' }),
      el('dl', { className: 'kv', children: [
        el('div', { className: 'kv__row', children: [
          el('dt', { className: 'kv__key', text: 'Provider' }),
          el('dd', { className: 'kv__val', text: provider }),
        ] }),
        el('div', { className: 'kv__row', children: [
          el('dt', { className: 'kv__key', text: 'Region' }),
          el('dd', { className: 'kv__val', text: region }),
        ] }),
        el('div', { className: 'kv__row', children: [
          el('dt', { className: 'kv__key', text: 'Agent' }),
          el('dd', { className: 'kv__val', children: [renderBadge(agentClass)] }),
        ] }),
        el('div', { className: 'kv__row', children: [
          el('dt', { className: 'kv__key', text: 'Nodes' }),
          el('dd', { className: 'kv__val', text: nodeCount === null ? 'N/A' : formatNumber(nodeCount, { max: 0 }) }),
        ] }),
      ] }),
    ] });

    const cpuSection = el('section', { className: 'card__section', children: [
      el('h3', { className: 'card__section-title', text: 'CPU' }),
      el('div', { className: 'metrics-grid', children: [
        renderMetric('Requested', el('span', { text: cpuReqText })),
        renderMetric('Used', el('span', { text: cpuUsedText })),
        renderMetric('Utilization', el('span', { children: [el('span', { text: cpuPct }), cpuBar] })),
      ] }),
    ] });

    const memSection = el('section', { className: 'card__section', children: [
      el('h3', { className: 'card__section-title', text: 'Memory' }),
      el('div', { className: 'metrics-grid', children: [
        renderMetric('Requested', el('span', { text: memReqText })),
        renderMetric('Used', el('span', { text: memUsedText })),
        renderMetric('Utilization', el('span', { children: [el('span', { text: memPct }), memBar] })),
      ] }),
    ] });

    const costSection = el('section', { className: 'card__section', children: [
      el('h3', { className: 'card__section-title', text: 'Monthly Cost' }),
      el('dl', { className: 'kv', children: [
        el('div', { className: 'kv__row', children: [
          el('dt', { className: 'kv__key', text: 'Current' }),
          el('dd', { className: 'kv__val', text: currentCost }),
        ] }),
        el('div', { className: 'kv__row', children: [
          el('dt', { className: 'kv__key', text: 'Optimized' }),
          el('dd', { className: 'kv__val', text: optimizedCost }),
        ] }),
        el('div', { className: 'kv__row kv__row--accent', children: [
          el('dt', { className: 'kv__key', text: 'Savings' }),
          el('dd', { className: 'kv__val', text: savingsAmt + ' (' + savingsPct + ')' }),
        ] }),
      ] }),
    ] });

    const optsSection = el('section', { className: 'card__section card__section--opps', children: [
      el('h3', { className: 'card__section-title', text: 'Optimization' }),
      el('div', { className: 'opps', children: [
        el('span', { className: 'opps__count', text: opportunities === null ? 'N/A' : formatNumber(opportunities, { max: 0 }) }),
        el('span', { className: 'opps__label', text: opportunities === 1 ? 'opportunity' : 'opportunities' }),
      ] }),
    ] });

    return el('article', {
      className: 'card',
      attrs: { 'data-cluster-id': id || '' },
      children: [header, metaSection, cpuSection, memSection, costSection, optsSection],
    });
  }

  function renderClusters(clusters) {
    clear(dom.clusters);
    if (!Array.isArray(clusters) || clusters.length === 0) {
      dom.emptyState.hidden = false;
      return;
    }
    dom.emptyState.hidden = true;
    const frag = document.createDocumentFragment();
    for (const c of clusters) {
      frag.appendChild(renderClusterCard(c));
    }
    dom.clusters.appendChild(frag);
  }

  // ---------- Fetching ----------

  function friendlyErrorMessage(err) {
    // err is intentionally opaque: never echo err.message to the user.
    if (err && err.status === 401) return 'You are not authorized to view cluster data.';
    if (err && err.status === 403) return 'Access to cluster data is forbidden.';
    if (err && err.status === 404) return 'Cluster data endpoint was not found.';
    if (err && err.status === 429) return 'Too many requests. Please wait and try again.';
    if (err && (err.status === 500 || err.status === 502 || err.status === 503 || err.status === 504)) {
      return 'The cluster service is temporarily unavailable. Please try again shortly.';
    }
    if (err && err.name === 'AbortError') return 'The request was cancelled.';
    return 'Unable to load cluster data. Please check your connection and try again.';
  }

  async function loadClusters() {
    showLoading();
    hideError();

    let response;
    try {
      const fetchOpts = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout)
        ? { signal: AbortSignal.timeout(15_000) }
        : {};
      response = await fetch(ENDPOINT, fetchOpts);
    } catch (networkErr) {
      hideLoading();
      const errName = networkErr && networkErr.name;
      const isTimeout = errName === 'AbortError' || errName === 'TimeoutError';
      if (isTimeout) {
        showError(friendlyErrorMessage({ name: 'AbortError' }));
      } else {
        showError('Network error. Please check your connection and try again.');
      }
      return;
    }

    if (!response.ok) {
      hideLoading();
      let parsed = null;
      try { parsed = await response.json(); } catch (_e) { /* ignore parse errors */ }
      const status = response.status;
      const message = friendlyErrorMessage({ status, body: parsed });
      showError(message);
      return;
    }

    let data;
    try {
      data = await response.json();
    } catch (_parseErr) {
      hideLoading();
      showError('Received an unexpected response from the server.');
      return;
    }

    hideLoading();
    renderClusters(data);
    if (dom.lastUpdated) {
      dom.lastUpdated.textContent = 'Updated ' + formatDateTime(new Date());
    }
  }

  // ---------- Wiring ----------

  function init() {
    if (dom.refreshBtn) {
      dom.refreshBtn.addEventListener('click', function () {
        loadClusters();
      });
    }
    if (dom.errorDismiss) {
      dom.errorDismiss.addEventListener('click', function () {
        hideError();
      });
    }
    loadClusters();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
