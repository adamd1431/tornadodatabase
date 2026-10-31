(() => {
  // This shared script runs on desktop too. Keep wheel scrolling from stepping
  // number fields, including fields created later inside edit forms and dialogs.
  const guardedNumberInputs = new WeakSet();
  function scrollNumberField(input, event) {
    if (input.type !== 'number' || document.activeElement !== input || event.ctrlKey || !event.cancelable || event.defaultPrevented) return;
    event.preventDefault();
    const lineHeight = parseFloat(getComputedStyle(input).lineHeight) || 16;
    let x = event.deltaX, y = event.deltaY;
    if (event.shiftKey && !x) { x = y; y = 0; }
    const factor = axis => event.deltaMode === 1 ? lineHeight : event.deltaMode === 2
      ? document.documentElement[axis === 'x' ? 'clientWidth' : 'clientHeight'] : 1;
    function scrollAxis(delta, horizontal) {
      if (!delta) return;
      for (let node = input.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        const overflow = style[horizontal ? 'overflowX' : 'overflowY'];
        const position = node[horizontal ? 'scrollLeft' : 'scrollTop'];
        const max = node[horizontal ? 'scrollWidth' : 'scrollHeight'] - node[horizontal ? 'clientWidth' : 'clientHeight'];
        const hasRoom = delta < 0 ? position > 0 : position < max;
        if (hasRoom && !/hidden|clip/.test(overflow) && (node === document.scrollingElement || /auto|scroll/.test(overflow))) {
          node.scrollBy({ left: horizontal ? delta : 0, top: horizontal ? 0 : delta, behavior: 'instant' });
          return;
        }
        if (/contain|none/.test(style[horizontal ? 'overscrollBehaviorX' : 'overscrollBehaviorY']) || node.matches('dialog[open]')) return;
      }
    }
    scrollAxis(x * factor('x'), true);
    scrollAxis(y * factor('y'), false);
  }
  function guardNumberInput(input) {
    if (!(input instanceof HTMLInputElement) || input.type !== 'number' || guardedNumberInputs.has(input)) return;
    guardedNumberInputs.add(input);
    input.addEventListener('wheel', event => scrollNumberField(input, event), { passive: false });
  }
  document.addEventListener('focusin', event => guardNumberInput(event.target));
  guardNumberInput(document.activeElement);

  const mobile = matchMedia('(max-width: 1024px)');
  const page = document.body.dataset.sitePage;
  const originalNav = document.querySelector('body > nav');
  const radarHeader = page === 'simulator' ? document.getElementById('header') : null;
  const nav = originalNav || (radarHeader ? null : document.body.insertBefore(document.createElement('nav'), document.body.firstChild));
  const sections = [
    ['Browse', [['index.html', 'Database'], ['index.html?view=cyclones', 'Tropical cyclones'], ['strongest100.html', 'Official Top 100'], ['official-cyclone-top100.html', 'Official cyclone Top 100'], ['user-lists.html', 'User lists'], ['versus.html', 'Versus'], ['leaderboard.html', 'Contributors'], ['recent-uploads.html', 'Recent uploads'], ['profile.html', 'My profile']]],
    ['Tools', [['generator.html', 'Image generator'], ['tropical-cyclone-generator.html', 'Tropical cyclone generator'], ['cycloidals.html', 'Cycloidals'], ['formula.html', 'Wind formula'], ['wind-pressure.html', 'Wind–pressure calculator'], ['calculator.html', 'Transport calculator'], ['simulator.html', 'Radar simulator']]]
  ];
  const knownPages = new Set(sections.flatMap(([, links]) => links.map(([url]) => url)));
  const swords = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m3 3 3 1 10 10-2 2L4 6 3 3Zm10 14 4-4m-2 2 5 5m-1 1 2-2"/><path d="m3 3 3 1 10 10-2 2L4 6 3 3Zm10 14 4-4m-2 2 5 5m-1 1 2-2" transform="translate(24 0) scale(-1 1)"/></svg>';
  const header = document.createElement('div');
  header.className = 'mobile-header';
  header.innerHTML = `<a class="mobile-brand" href="index.html" aria-label="Tornado Database home"><img src="favicon.png" alt="" width="26" height="26"><span><b>Tornado</b><strong>Database</strong></span></a><a class="mobile-versus" href="versus.html">${swords}<span>Versus</span></a>`;
  function updateDatabaseBrand() {
    const cycloneMode = document.body.dataset.indexMode === 'cyclones';
    const name = cycloneMode ? 'Cyclone' : 'Tornado';
    const brand = header.querySelector('.mobile-brand');
    brand.querySelector('b').textContent = name;
    brand.href = cycloneMode ? 'index.html?view=cyclones' : 'index.html';
    brand.setAttribute('aria-label', `${name} Database home`);
  }
  updateDatabaseBrand();
  window.addEventListener('index-mode-change', updateDatabaseBrand);
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'mobile-menu-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'mobileSiteMenu');
  toggle.setAttribute('aria-haspopup', 'dialog');
  toggle.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg><span>Menu</span>';
  if (nav) {
    nav.classList.add('mobile-site-nav');
    if (!originalNav) nav.classList.add('mobile-only-nav');
    header.append(toggle);
    nav.append(header);
  } else {
    radarHeader.append(toggle);
  }

  const menu = document.createElement('dialog');
  menu.id = 'mobileSiteMenu';
  menu.className = 'mobile-menu';
  menu.setAttribute('aria-labelledby', 'mobileMenuTitle');
  menu.innerHTML = '<div class="mobile-menu-head"><h2 id="mobileMenuTitle">Explore</h2><button class="mobile-menu-close" type="button" aria-label="Close menu">✕</button></div><div class="mobile-menu-body"><div class="mobile-menu-actions"></div><div class="mobile-menu-links"></div></div>';
  const links = menu.querySelector('.mobile-menu-links');
  sections.forEach(([title, items]) => {
    const group = document.createElement('nav');
    group.className = 'mobile-menu-group';
    group.setAttribute('aria-label', title);
    const label = document.createElement('p');
    label.textContent = title;
    group.append(label);
    items.forEach(([url, text]) => {
      const link = document.createElement('a');
      link.href = url;
      link.textContent = text;
      if (url === `${page}.html`) link.setAttribute('aria-current', 'page');
      group.append(link);
    });
    links.append(group);
  });
  document.body.append(menu);
  const profileLink = links.querySelector('a[href="profile.html"]');
  profileLink.addEventListener('click', event => {
    const source = originalNav?.querySelector('#profileBtn');
    if (!source || !available(source)) return;
    event.preventDefault();
    menu.close();
    requestAnimationFrame(() => source.click());
  });

  function available(source) {
    for (let el = source; el && el !== originalNav; el = el.parentElement) {
      if (el.hidden || el.style.display === 'none' || el.style.visibility === 'hidden' || el.classList.contains('is-hidden') || el.classList.contains('is-pending')) return false;
    }
    return true;
  }

  function updateActions() {
    const actions = menu.querySelector('.mobile-menu-actions');
    const sources = [...(originalNav?.querySelectorAll('a[href],button') || [])].filter(source => !source.closest('.mobile-header') && available(source));
    const actionable = sources.filter(source => {
      if (source.matches('.brand,.topnav-brand')) return false;
      if (source.id === 'profileBtn') return false;
      const destination = source.getAttribute('href') || source.getAttribute('onclick')?.match(/location\.href\s*=\s*['"]([^'"]+)/)?.[1];
      return destination ? !knownPages.has(destination.split(/[?#]/)[0]) : source.tagName === 'BUTTON';
    });
    // Keep focus on an existing action when an account or alert refreshes.
    const focused = actions.contains(document.activeElement) ? document.activeElement.dataset.sourceIndex : null;
    actions.replaceChildren();
    actionable.forEach((source, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = source.id === 'adminNavBtn' ? 'Admin' : source.getAttribute('aria-label') || source.textContent.trim().replace(/\s+/g, ' ');
      if (source.classList.contains('has-alert')) {
        button.classList.add('has-alert');
        button.setAttribute('aria-label', `${button.textContent}, ${source.getAttribute('aria-label') || 'new notifications'}`);
      }
      button.disabled = source.disabled;
      button.dataset.sourceIndex = index;
      button.className = source.classList.contains('btn-primary') ? 'mobile-action primary' : 'mobile-action';
      button.addEventListener('click', () => {
        menu.close();
        requestAnimationFrame(() => source.click());
      });
      actions.append(button);
    });
    actions.hidden = !actionable.length;
    if (focused !== null) actions.querySelector(`[data-source-index="${focused}"]`)?.focus();
  }

  function updateAlerts() {
    const hasAlert = !!originalNav?.querySelector('#profileBtn.has-alert,#adminNavBtn.has-alert');
    toggle.classList.toggle('has-alert', hasAlert);
    toggle.setAttribute('aria-label', hasAlert ? 'Menu, new notifications' : 'Open navigation menu');
    const source = originalNav?.querySelector('#profileBtn');
    profileLink.classList.toggle('has-alert', !!source?.classList.contains('has-alert'));
    if (source) {
      profileLink.textContent = source.querySelector('.btn-label')?.textContent.trim() || 'My profile';
      profileLink.setAttribute('aria-label', source.getAttribute('aria-label') || profileLink.textContent);
    }
  }

  toggle.addEventListener('click', () => {
    if (!mobile.matches) return;
    updateActions();
    menu.showModal();
    toggle.setAttribute('aria-expanded', 'true');
    document.documentElement.classList.add('mobile-menu-open');
  });
  menu.querySelector('.mobile-menu-close').addEventListener('click', () => menu.close());
  menu.addEventListener('click', event => {
    if (event.target === menu || event.target.closest('a[href]')) menu.close();
  });
  menu.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key !== 'Tab') return;
    const focusable = [...menu.querySelectorAll('a[href],button:not([disabled])')].filter(el => el.getClientRects().length);
    const next = event.shiftKey ? focusable.at(-1) : focusable[0];
    if (document.activeElement === (event.shiftKey ? focusable[0] : focusable.at(-1))) {
      event.preventDefault();
      next?.focus();
    }
  });
  menu.addEventListener('close', () => {
    toggle.setAttribute('aria-expanded', 'false');
    document.documentElement.classList.remove('mobile-menu-open');
    if (mobile.matches) toggle.focus({ preventScroll: true });
    else originalNav?.querySelector('a[href]')?.focus({ preventScroll: true });
    window.dispatchEvent(new Event('mobile-menu-close'));
  });
  mobile.addEventListener('change', () => { if (!mobile.matches && menu.open) menu.close(); });
  if (originalNav) {
    let frame = 0;
    new MutationObserver(records => {
      if (records.every(record => record.target.closest?.('.mobile-header'))) return;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        updateAlerts();
        if (menu.open) updateActions();
      });
    }).observe(originalNav, { attributes: true, attributeFilter: ['class', 'style', 'hidden', 'disabled'], childList: true, characterData: true, subtree: true });
  }
  updateAlerts();

  if (page === 'index') {
    const filters = document.querySelector('.filters');
    if (filters) {
      const details = document.createElement('details');
      details.className = 'mobile-filters';
      const summary = document.createElement('summary');
      summary.textContent = 'Filters & sort';
      details.append(summary);
      const updateCount = () => {
        const count = [...filters.querySelectorAll('input,select')].filter(input => input.value && (input.id !== 'sortFilter' || input.value !== 'newest')).length;
        summary.textContent = `Filters & sort${count ? ` · ${count} active` : ''}`;
      };
      filters.addEventListener('input', updateCount);
      filters.addEventListener('change', updateCount);
      const arrangeFilters = () => {
        if (mobile.matches && !details.isConnected) {
          filters.before(details);
          details.append(filters);
          updateCount();
        } else if (!mobile.matches && details.isConnected) {
          details.before(filters);
          details.remove();
        }
      };
      arrangeFilters();
      mobile.addEventListener('change', arrangeFilters);
    }
  }
  if (page === 'generator') {
    const controls = document.querySelector('.col-left');
    const preview = document.querySelector('.col-right');
    if (controls && preview) {
      let lastControl = controls;
      controls.addEventListener('focusin', event => { lastControl = event.target.closest('.card') || controls; });
      const shortcuts = document.createElement('div');
      shortcuts.className = 'mobile-generator-jumps';
      shortcuts.setAttribute('role', 'group');
      shortcuts.setAttribute('aria-label', 'Generator shortcuts');
      [['Edit controls', () => lastControl], ['View preview', () => preview]].forEach(([text, target]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.addEventListener('click', () => target().scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }));
        shortcuts.append(button);
      });
      document.body.append(shortcuts);
    }
    const exportActions = document.querySelector('.top100-head-actions');
    if (exportActions) {
      const controls = [...exportActions.children].filter(el => el.tagName !== 'BUTTON');
      const firstButton = exportActions.querySelector('button');
      const settings = document.createElement('details');
      settings.className = 'mobile-generator-settings';
      settings.innerHTML = '<summary>Export settings</summary><div class="mobile-generator-settings-body"></div>';
      const arrangeSettings = () => {
        if (mobile.matches && !settings.isConnected) {
          exportActions.before(settings);
          settings.lastElementChild.append(...controls);
        } else if (!mobile.matches && settings.isConnected) {
          controls.forEach(control => exportActions.insertBefore(control, firstButton));
          settings.remove();
        }
      };
      arrangeSettings();
      mobile.addEventListener('change', arrangeSettings);
    }
  }
  if (page === 'user-lists') {
    document.getElementById('listCards')?.addEventListener('click', event => {
      if (mobile.matches && event.target.closest('.list-card')) requestAnimationFrame(() => document.getElementById('viewerPanel')?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }));
    });
  }

  let viewportFrame = 0;
  const updateViewport = () => {
    viewportFrame = 0;
    document.documentElement.style.setProperty('--mobile-viewport-height', `${Math.round(window.visualViewport?.height || innerHeight)}px`);
  };
  window.visualViewport?.addEventListener('resize', () => {
    if (!viewportFrame) viewportFrame = requestAnimationFrame(updateViewport);
  });
  updateViewport();
  if (radarHeader) {
    new ResizeObserver(() => document.documentElement.style.setProperty('--mobile-radar-top', `${Math.ceil(radarHeader.getBoundingClientRect().height) + 8}px`)).observe(radarHeader);
  }
})();
