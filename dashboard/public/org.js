'use strict';

/* Org & Users view — renders GET /api/org-overview (read-only, server-side
 * aggregated CAST AI organization management data). No build step; ES2017+. */

(function () {
  const els = {
    errorBanner: document.getElementById('error-banner'),
    errorMessage: document.getElementById('error-banner__message'),
    errorDismiss: document.getElementById('error-banner__dismiss'),
    loading: document.getElementById('loading'),
    loadingLabel: document.getElementById('loading-label'),
    refreshBtn: document.getElementById('refresh-btn'),
    lastUpdated: document.getElementById('last-updated'),
    root: document.getElementById('overview-root'),

    kpiGrid: document.getElementById('kpi-grid'),

    ssoCards: document.getElementById('sso-cards'),
    ssoEmpty: document.getElementById('sso-empty'),

    usageCards: document.getElementById('usage-cards'),
    usageEmpty: document.getElementById('usage-empty'),

    orgFilter: document.getElementById('org-filter'),
    orgTbody: document.getElementById('org-tbody'),
    orgTableMeta: document.getElementById('org-table-meta'),

    userFilter: document.getElementById('user-filter'),
    userAuthFilter: document.getElementById('user-auth-filter'),
    usersCsvBtn: document.getElementById('users-csv-btn'),
    userTbody: document.getElementById('user-tbody'),
    userTableMeta: document.getElementById('user-table-meta'),

    groupTbody: document.getElementById('group-tbody'),
    groupTableMeta: document.getElementById('group-table-meta'),

    standaloneSection: document.getElementById('standalone-section'),
    standaloneTbody: document.getElementById('standalone-tbody'),

    errorsSection: document.getElementById('errors-section'),
    errorsList: document.getElementById('errors-list'),
  };

  let overview = null;
  const orgSort = { key: 'name', dir: 1 };
  const userSort = { key: 'email', dir: 1 };
  const groupSort = { key: 'organizationName', dir: 1 };

  // ---- helpers ------------------------------------------------------------

  function showError(message) {
    els.errorMessage.textContent = message;
    els.errorBanner.hidden = false;
  }

  function setLoading(on, hard) {
    els.loading.hidden = !on;
    if (on) {
      els.loadingLabel.textContent = hard
        ? 'Rebuilding organization overview from CAST AI — this fans out across every child organization and can take up to a minute…'
        : 'Loading organization overview…';
    }
    if (els.refreshBtn) els.refreshBtn.disabled = on;
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toISOString().slice(0, 10);
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString();
  }

  function relativeAge(iso) {
    if (!iso) return 'Never logged in';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 30) return `${days} days ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} mo ago`;
    return `${Math.floor(months / 12)} y ago`;
  }

  function fmtCount(v) {
    return typeof v === 'number' && Number.isFinite(v) ? String(v) : '—';
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function sortRows(rows, sort) {
    const { key, dir } = sort;
    return [...rows].sort((a, b) => {
      let av = a[key];
      let bv = b[key];
      // Enterprise row always first when sorting by name.
      if (key === 'name') {
        if (a.kind === 'enterprise') return -1;
        if (b.kind === 'enterprise') return 1;
      }
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }

  function bindSort(tableId, sort, rerender) {
    const table = document.getElementById(tableId);
    if (!table) return;
    table.querySelectorAll('th[data-sort]').forEach((th) => {
      th.classList.add('org-table__th--sortable');
      const key = th.getAttribute('data-sort');
      th.addEventListener('click', () => {
        if (sort.key === key) {
          sort.dir = sort.dir * -1;
        } else {
          sort.key = key;
          sort.dir = 1;
        }
        table.querySelectorAll('th[data-sort]').forEach((h) => {
          h.classList.remove('org-table__th--asc', 'org-table__th--desc');
        });
        th.classList.add(sort.dir === 1 ? 'org-table__th--asc' : 'org-table__th--desc');
        rerender();
      });
      const dir = sort.dir;
      if (sort.key === key) {
        th.classList.add(dir === 1 ? 'org-table__th--asc' : 'org-table__th--desc');
      }
    });
  }

  // ---- KPI cards ------------------------------------------------------------

  function renderKpis(enterprise) {
    const t = enterprise.totals;
    const cards = [
      { label: 'Child organizations', value: t.childOrganizations },
      { label: 'Users (unique)', value: t.users },
      { label: 'User groups', value: t.userGroups },
      { label: 'Role bindings', value: t.roleBindings },
      { label: 'Clusters connected', value: t.clusters },
      {
        label: 'SSO connections',
        value: t.ssoConnections > 0 ? `${t.ssoActive}/${t.ssoConnections} active` : '0',
      },
      { label: 'Users never logged in', value: t.usersNeverLoggedIn },
    ];
    els.kpiGrid.replaceChildren();
    for (const c of cards) {
      const card = el('div', 'kpi-card');
      card.append(el('div', 'kpi-card__label', c.label));
      card.append(el('div', 'kpi-card__value', String(c.value)));
      els.kpiGrid.append(card);
    }
  }

  // ---- SSO -------------------------------------------------------------------

  function renderSso(enterprise) {
    const list = enterprise.ssoConnections || [];
    els.ssoCards.replaceChildren();
    els.ssoEmpty.hidden = list.length > 0;
    for (const c of list) {
      const card = el('div', 'sso-card');
      const head = el('div', 'sso-card__head');
      head.append(el('span', 'sso-card__name', c.name || '(unnamed)'));
      const active = c.status === 'STATUS_ACTIVE';
      head.append(el('span', `badge ${active ? 'badge--ok' : 'badge--warn'}`, active ? 'ACTIVE' : (c.status || 'UNKNOWN')));
      card.append(head);

      const domains = [c.emailDomain].concat(c.additionalEmailDomains || []).filter(Boolean);
      const dl = el('dl', 'sso-card__facts');
      const facts = [
        ['Type', c.aad ? 'Microsoft Entra ID' : c.oidc ? 'OIDC' : c.saml ? 'SAML' : 'SSO'],
        ['Email domains', domains.join(', ') || '—'],
        ['Synced', c.isSynced ? 'Yes' : 'No'],
        ['Created', formatDate(c.createdAt)],
      ];
      for (const [k, v] of facts) {
        dl.append(el('dt', '', k));
        dl.append(el('dd', '', v));
      }
      card.append(dl);
      els.ssoCards.append(card);
    }
  }

  // ---- Platform usage ----------------------------------------------------------

  function renderUsage(enterprise) {
    const usage = enterprise.platformUsage || { features: [] };
    const features = Array.isArray(usage.features) ? usage.features : [];
    els.usageCards.replaceChildren();
    els.usageEmpty.hidden = features.length > 0;
    for (const f of features) {
      const card = el('div', 'usage-card');
      card.append(el('div', 'usage-card__name', f.displayName || f.feature || '—'));
      const value = typeof f.usage === 'number'
        ? f.usage.toLocaleString(undefined, { maximumFractionDigits: 0 })
        : '—';
      card.append(el('div', 'usage-card__value', value));
      card.append(el('div', 'usage-card__unit', (f.unit || '').toString()));
      els.usageCards.append(card);
    }
  }

  // ---- Organizations table -----------------------------------------------------

  function renderOrgTable(enterprise) {
    const filter = els.orgFilter.value.trim().toLowerCase();
    let rows = enterprise.organizations || [];
    if (filter) {
      rows = rows.filter((o) => (o.name || '').toLowerCase().includes(filter));
    }
    rows = sortRows(rows, orgSort);

    els.orgTbody.replaceChildren();
    for (const o of rows) {
      const tr = el('tr', o.kind === 'enterprise' ? 'org-table__row--enterprise' : '');

      const nameTd = el('td', 'org-table__name');
      nameTd.append(el('span', '', o.name || '—'));
      const badgeText = o.kind === 'enterprise' ? 'ENTERPRISE' : o.kind === 'standalone' ? 'STANDALONE' : 'CHILD';
      const badgeClass = o.kind === 'enterprise' ? 'badge--enterprise' : 'badge--child';
      nameTd.append(el('span', `badge ${badgeClass}`, badgeText));
      if (o.errors && o.errors.length > 0) {
        nameTd.append(el('span', 'badge badge--warn', 'partial data'));
      }
      tr.append(nameTd);

      tr.append(el('td', 'org-table__num', fmtCount(o.users)));
      tr.append(el('td', 'org-table__num', fmtCount(o.userGroups)));
      tr.append(el('td', 'org-table__num', fmtCount(o.roleBindings)));
      tr.append(el('td', 'org-table__num', fmtCount(o.clusters)));
      const created = el('td', '', formatDate(o.createdAt));
      if (o.createdAt) created.title = formatDateTime(o.createdAt);
      tr.append(created);
      els.orgTbody.append(tr);
    }

    const total = (enterprise.organizations || []).length;
    els.orgTableMeta.textContent =
      `${rows.length} of ${total} organizations · ${enterprise.enterprise.name} enterprise (created ${formatDate(enterprise.enterprise.createdAt)})`;
  }

  // ---- Users table ---------------------------------------------------------------

  function activeUsers() {
    return (overview && overview.enterprises[0] ? overview.enterprises[0].users : []) || [];
  }

  function renderUserTable() {
    const q = els.userFilter.value.trim().toLowerCase();
    const authFilter = els.userAuthFilter.value;
    let rows = activeUsers();
    if (authFilter) rows = rows.filter((u) => u.auth === authFilter);
    if (q) {
      rows = rows.filter((u) =>
        (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q));
    }
    rows = sortRows(rows, userSort);

    els.userTbody.replaceChildren();
    for (const u of rows) {
      const tr = el('tr');
      tr.append(el('td', 'org-table__name', u.name || '—'));
      const emailTd = el('td');
      emailTd.append(el('span', 'org-table__email', u.email || '—'));
      tr.append(emailTd);

      const authTd = el('td');
      const isSso = u.auth === 'SSO';
      const badge = el('span', `badge ${isSso ? 'badge--ok' : 'badge--muted'}`, isSso ? 'SSO' : 'Email');
      if (u.ssoProvider) badge.title = `SSO via ${u.ssoProvider}`;
      authTd.append(badge);
      tr.append(authTd);

      const orgsTd = el('td', 'org-table__tags');
      const orgs = u.organizations || [];
      const MAX_TAGS = 4;
      orgs.slice(0, MAX_TAGS).forEach((name) => orgsTd.append(el('span', 'tag', name)));
      if (orgs.length > MAX_TAGS) {
        const more = el('span', 'tag tag--more', `+${orgs.length - MAX_TAGS} more`);
        more.title = orgs.join('\n');
        orgsTd.append(more);
      }
      if (orgs.length === 0) orgsTd.textContent = '—';
      tr.append(orgsTd);

      const lastTd = el('td');
      const stale = !u.lastActivity || (Date.now() - new Date(u.lastActivity).getTime()) > 90 * 86_400_000;
      lastTd.append(el('span', stale ? 'org-table__stale' : '', relativeAge(u.lastActivity)));
      if (u.lastActivity) lastTd.title = formatDateTime(u.lastActivity);
      tr.append(lastTd);

      els.userTbody.append(tr);
    }

    const total = activeUsers().length;
    els.userTableMeta.textContent = `${rows.length} of ${total} users (deduplicated across organizations)`;
  }

  function exportUsersCsv() {
    const rows = activeUsers();
    const header = ['Name', 'Email', 'Auth', 'SSO Provider', 'Organizations', 'Last activity', 'Created'];
    const escape = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = [header.map(escape).join(',')];
    for (const u of rows) {
      lines.push([
        u.name, u.email, u.auth, u.ssoProvider || '',
        (u.organizations || []).join('; '),
        u.lastActivity || '', u.createdAt || '',
      ].map(escape).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `castai-enterprise-users-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  // ---- User groups table -------------------------------------------------------

  function renderGroupTable(enterprise) {
    const rows = sortRows(enterprise.userGroups || [], groupSort);
    els.groupTbody.replaceChildren();
    for (const g of rows) {
      const tr = el('tr');
      const nameTd = el('td', 'org-table__name', g.name || '—');
      if (g.description) nameTd.title = g.description;
      tr.append(nameTd);
      tr.append(el('td', '', g.organizationName || '—'));
      tr.append(el('td', 'org-table__num', fmtCount(g.members)));
      const created = el('td', '', formatDate(g.createdAt));
      if (g.createdAt) created.title = formatDateTime(g.createdAt);
      tr.append(created);
      els.groupTbody.append(tr);
    }
    els.groupTableMeta.textContent = `${rows.length} user groups across organizations`;
  }

  // ---- Standalone + errors ---------------------------------------------------------

  function renderStandalone(list) {
    els.standaloneSection.hidden = !list || list.length === 0;
    if (!list || list.length === 0) return;
    els.standaloneTbody.replaceChildren();
    for (const o of list) {
      const tr = el('tr');
      tr.append(el('td', 'org-table__name', o.name || '—'));
      tr.append(el('td', 'org-table__num', fmtCount(o.users)));
      tr.append(el('td', 'org-table__num', fmtCount(o.userGroups)));
      tr.append(el('td', 'org-table__num', fmtCount(o.roleBindings)));
      tr.append(el('td', 'org-table__num', fmtCount(o.clusters)));
      tr.append(el('td', '', formatDate(o.createdAt)));
      els.standaloneTbody.append(tr);
    }
  }

  function renderErrors(list) {
    els.errorsSection.hidden = !list || list.length === 0;
    if (!list || list.length === 0) return;
    els.errorsList.replaceChildren();
    for (const e of list) {
      els.errorsList.append(el('li', '', `${e.org} — ${e.endpoint} (status ${e.status})`));
    }
  }

  // ---- Data -------------------------------------------------------------

  async function loadOverview(refresh) {
    setLoading(true, refresh);
    els.errorBanner.hidden = true;
    try {
      const url = refresh ? '/api/org-overview?refresh=1' : '/api/org-overview';
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      overview = await res.json();

      const enterprise = (overview.enterprises || [])[0];
      if (!enterprise) {
        showError('No enterprise organization found for this API key.');
        return;
      }

      renderKpis(enterprise);
      renderSso(enterprise);
      renderUsage(enterprise);
      renderOrgTable(enterprise);
      renderUserTable();
      renderGroupTable(enterprise);
      renderStandalone(overview.standaloneOrganizations || []);
      renderErrors(overview.errors || []);

      els.root.hidden = false;
      const built = overview.buildDurationMs != null
        ? ` · built in ${(overview.buildDurationMs / 1000).toFixed(1)}s`
        : '';
      els.lastUpdated.textContent = `Updated ${new Date(overview.generatedAt || Date.now()).toLocaleTimeString()}${built} (cached 5 min)`;
    } catch (err) {
      showError(`Failed to load organization overview: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  // ---- Wiring -------------------------------------------------------------

  els.errorDismiss.addEventListener('click', () => { els.errorBanner.hidden = true; });
  els.refreshBtn.addEventListener('click', () => loadOverview(true));
  els.orgFilter.addEventListener('input', () => {
    const enterprise = (overview.enterprises || [])[0];
    if (enterprise) renderOrgTable(enterprise);
  });
  els.userFilter.addEventListener('input', renderUserTable);
  els.userAuthFilter.addEventListener('change', renderUserTable);
  els.usersCsvBtn.addEventListener('click', exportUsersCsv);

  bindSort('org-table', orgSort, () => {
    const enterprise = (overview.enterprises || [])[0];
    if (enterprise) renderOrgTable(enterprise);
  });
  bindSort('user-table', userSort, renderUserTable);
  bindSort('group-table', groupSort, () => {
    const enterprise = (overview.enterprises || [])[0];
    if (enterprise) renderGroupTable(enterprise);
  });

  loadOverview(false);
})();
