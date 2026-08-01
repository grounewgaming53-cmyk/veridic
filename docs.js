/* ========================================================================
   VERIDIC — Documentation page behaviour
   Renders the tool catalogue, app screens and API table from docs-data.js,
   then wires search, tag filtering, scroll-spy and the mobile nav.
   ======================================================================== */

(function () {
  'use strict';

  const TOOLS = window.VERIDIC_TOOLS || [];
  const SCREENS = window.VERIDIC_SCREENS || [];
  const PLUGINS = window.VERIDIC_PLUGINS || [];
  const API = window.VERIDIC_API || [];

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ------------------------------------------------------------ counters */

  const totalTools = TOOLS.reduce((n, g) => n + g.tools.length, 0);
  const coreTools = TOOLS.filter((g) => g.id !== 'minecraft')
    .reduce((n, g) => n + g.tools.length, 0);
  const confirmCount = TOOLS.reduce(
    (n, g) => n + g.tools.filter((t) => t.confirm).length, 0
  );

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  setText('mTotalTools', String(totalTools));
  setText('mCoreTools', String(coreTools));
  setText('mCategories', String(TOOLS.length));
  setText('mScreens', String(SCREENS.length));
  setText('mConfirm', String(confirmCount));
  setText('mEndpoints', String(API.length));
  setText('mPlugins', String(PLUGINS.length));

  /* ------------------------------------------- render the tool catalogue */

  const catalogue = $('#toolCatalogue');

  function toolMarkup(tool) {
    const badges =
      (tool.confirm
        ? '<span class="badge badge-confirm"><i class="fas fa-hand"></i> Confirmation</span>'
        : '') +
      (tool.gated
        ? '<span class="badge badge-gated"><i class="fas fa-lock"></i> ' + esc(tool.gated) + '</span>'
        : '');

    const tags = (tool.tags || [])
      .map((t) => '<span class="tool-tag">' + esc(t) + '</span>')
      .join('');

    return (
      '<article class="tool" data-tool="' + esc(tool.name.toLowerCase()) + '"' +
      ' data-tags="' + esc((tool.tags || []).join(' ')) + '"' +
      ' data-haystack="' + esc((tool.name + ' ' + tool.sig + ' ' + tool.desc).toLowerCase()) + '">' +
      '<div class="tool-head">' +
      '<span class="tool-name">' + esc(tool.name) + '</span>' +
      badges +
      '</div>' +
      '<div class="tool-sig">' + esc(tool.sig) + '</div>' +
      '<p class="tool-desc" style="margin-top:10px">' + tool.desc + '</p>' +
      (tool.note ? '<p class="tool-note">' + tool.note + '</p>' : '') +
      (tags ? '<div class="tool-tags">' + tags + '</div>' : '') +
      '</article>'
    );
  }

  if (catalogue) {
    catalogue.innerHTML = TOOLS.map((group) =>
      '<section class="tool-group" id="tools-' + esc(group.id) + '" data-group="' + esc(group.id) + '">' +
      '<div class="tool-group-head">' +
      '<i class="fas ' + esc(group.icon) + '"></i>' +
      '<div><h3>' + esc(group.title) +
      '<span class="n">' + group.tools.length + '</span></h3></div>' +
      '</div>' +
      '<p class="tool-group-blurb">' + group.blurb + '</p>' +
      '<div class="tool-list">' + group.tools.map(toolMarkup).join('') + '</div>' +
      '</section>'
    ).join('') +
    '<div class="tool-empty" id="toolEmpty" hidden>' +
    '<i class="fas fa-magnifying-glass"></i>' +
    'No tools match that search. Try a capability word like <code>file</code>, ' +
    '<code>browser</code>, <code>memory</code> or <code>install</code>.' +
    '</div>';
  }

  /* ---------------------------------------------------- render app screens */

  const screensEl = $('#screenList');
  if (screensEl) {
    const groups = [];
    SCREENS.forEach((s) => {
      let g = groups.find((x) => x.name === s.group);
      if (!g) groups.push((g = { name: s.group, items: [] }));
      g.items.push(s);
    });

    screensEl.innerHTML = groups.map((g) =>
      '<div class="group-label">' + esc(g.name) + '</div>' +
      '<div class="screen-grid">' +
      g.items.map((s) =>
        '<div class="screen-card">' +
        '<div class="screen-card-head"><i class="fas ' + esc(s.icon) + '"></i>' +
        '<h4>' + esc(s.name) + '</h4></div>' +
        '<p>' + esc(s.desc) + '</p>' +
        '</div>'
      ).join('') +
      '</div>'
    ).join('');
  }

  /* -------------------------------------------------------- render plugins */

  const pluginsEl = $('#pluginList');
  if (pluginsEl) {
    pluginsEl.innerHTML =
      '<div class="screen-grid">' +
      PLUGINS.map((p) =>
        '<div class="screen-card">' +
        '<div class="screen-card-head"><i class="fas fa-plug"></i>' +
        '<h4 class="mono" style="font-size:0.88rem">' + esc(p.name) + '</h4></div>' +
        '<p>' + esc(p.desc) + '</p>' +
        '</div>'
      ).join('') +
      '</div>';
  }

  /* ------------------------------------------------------- render API table */

  const apiEl = $('#apiTable');
  if (apiEl) {
    apiEl.innerHTML =
      '<div class="table-scroll"><table class="docs-table">' +
      '<thead><tr><th style="width:96px">Method</th><th style="width:210px">Endpoint</th>' +
      '<th>Purpose</th><th style="width:96px">Guarded</th></tr></thead><tbody>' +
      API.map((e) =>
        '<tr>' +
        '<td><span class="method' + (/POST|DELETE/.test(e.method) ? ' post' : '') + '">' +
        esc(e.method) + '</span></td>' +
        '<td><code>' + esc(e.path) + '</code></td>' +
        '<td>' + e.desc + '</td>' +
        '<td>' + (e.secure
          ? '<i class="fas fa-lock" style="color:var(--amber)" title="Loopback + X-Veridic-Local header"></i>'
          : '<span style="color:var(--text-muted)">—</span>') + '</td>' +
        '</tr>'
      ).join('') +
      '</tbody></table></div>';
  }

  /* ---------------------------------------------------- sidebar tool links */

  const toolNav = $('#toolNav');
  if (toolNav) {
    toolNav.innerHTML = TOOLS.map((g) =>
      '<a href="#tools-' + esc(g.id) + '"><i class="fas ' + esc(g.icon) + '"></i>' +
      esc(g.title) + '<span class="count">' + g.tools.length + '</span></a>'
    ).join('');
  }

  /* --------------------------------------------------- search + filtering */

  const searchInput = $('#docsSearch');
  const countEl = $('#toolCount');
  const emptyEl = () => $('#toolEmpty');
  let activeTag = 'all';

  function applyFilter() {
    const query = (searchInput ? searchInput.value : '').trim().toLowerCase();
    let visible = 0;

    $$('.tool-group').forEach((group) => {
      let groupVisible = 0;

      $$('.tool', group).forEach((tool) => {
        const haystack = tool.getAttribute('data-haystack');
        const tags = tool.getAttribute('data-tags').split(' ');
        const matchesQuery = !query || haystack.indexOf(query) !== -1;
        const matchesTag = activeTag === 'all' || tags.indexOf(activeTag) !== -1;
        const show = matchesQuery && matchesTag;

        tool.hidden = !show;
        if (show) groupVisible++;
      });

      group.hidden = groupVisible === 0;
      visible += groupVisible;
    });

    if (countEl) {
      countEl.textContent = query || activeTag !== 'all'
        ? visible + ' of ' + totalTools + ' tools'
        : totalTools + ' tools';
    }

    const empty = emptyEl();
    if (empty) empty.hidden = visible !== 0;
  }

  if (searchInput) {
    let timer;
    searchInput.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(applyFilter, 120);
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        searchInput.value = '';
        applyFilter();
        searchInput.blur();
      }
    });

    // "/" focuses search, the way most docs sites behave.
    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
    });
  }

  $$('.tool-filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTag = btn.getAttribute('data-tag');
      $$('.tool-filter').forEach((b) =>
        b.setAttribute('aria-pressed', String(b === btn))
      );
      applyFilter();
    });
  });

  applyFilter();

  /* ------------------------------------------------------------ scroll-spy */

  const navLinks = $$('.docs-nav a[href^="#"]');
  const railLinks = $$('.docs-rail a[href^="#"]');
  const targets = []
    .concat(navLinks, railLinks)
    .map((a) => {
      const el = document.getElementById(a.getAttribute('href').slice(1));
      return el ? { link: a, el } : null;
    })
    .filter(Boolean);

  function spy() {
    const line = window.scrollY + 140;
    let current = null;

    targets.forEach((t) => {
      if (t.el.offsetTop <= line) current = t.el.id;
    });

    [].concat(navLinks, railLinks).forEach((a) => {
      a.classList.toggle('active', a.getAttribute('href') === '#' + current);
    });
  }

  window.addEventListener('scroll', spy, { passive: true });
  spy();

  /* ------------------------------------------------------- smooth anchors */

  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href^="#"]');
    if (!link) return;

    const id = link.getAttribute('href').slice(1);
    if (!id) return;

    const target = document.getElementById(id);
    if (!target) return;

    e.preventDefault();
    const top = target.getBoundingClientRect().top + window.scrollY - 92;
    window.scrollTo({ top, behavior: 'smooth' });
    history.replaceState(null, '', '#' + id);

    const nav = $('#docsNav');
    if (nav) nav.classList.remove('open');
  });

  /* ---------------------------------------------------------- mobile nav */

  const navToggle = $('#docsNavToggle');
  const docsNav = $('#docsNav');
  if (navToggle && docsNav) {
    navToggle.addEventListener('click', () => {
      const open = docsNav.classList.toggle('open');
      navToggle.innerHTML = open
        ? '<i class="fas fa-xmark"></i>'
        : '<i class="fas fa-list"></i>';
    });
  }

  /* --------------------------------------- deep link to a section on load */

  if (location.hash) {
    const target = document.getElementById(location.hash.slice(1));
    if (target) {
      setTimeout(() => {
        window.scrollTo({
          top: target.getBoundingClientRect().top + window.scrollY - 92,
          behavior: 'auto',
        });
        spy();
      }, 40);
    }
  }
})();
