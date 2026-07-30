(() => {
  const root = document.documentElement;
  root.classList.add("utwx-js");
  const loaderSelector = ".loading-state, .modal-loading, .crop-loading, .state-msg, .state";
  const loadingWords = /\b(loading|preparing|saving|uploading|submitting|working|refreshing)\b/i;

  function ensureProgressBar() {
    let bar = document.querySelector(".utwx-page-progress");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "utwx-page-progress active";
      bar.setAttribute("aria-hidden", "true");
      document.body.appendChild(bar);
    }
    return bar;
  }

  function setProgress(active) {
    const bar = ensureProgressBar();
    bar.classList.toggle("active", active);
  }

  function decorateLoader(el) {
    if (!(el instanceof HTMLElement)) return;
    const isLoading = loadingWords.test(el.textContent || "");
    if (isLoading) {
      el.classList.add("is-loading");
    } else if (!el.classList.contains("loading-state")) {
      el.classList.remove("is-loading");
    }
  }

  function scanLoaders(scope = document) {
    if (scope instanceof HTMLElement && scope.matches(loaderSelector)) {
      decorateLoader(scope);
    }
    scope.querySelectorAll?.(loaderSelector).forEach(decorateLoader);
  }

  function watchLoaderChanges() {
    const observer = new MutationObserver(records => {
      const changed = new Set();
      records.forEach(record => {
        const target = record.target instanceof HTMLElement
          ? record.target
          : record.target.parentElement;
        if (target?.matches?.(loaderSelector)) changed.add(target);
        record.addedNodes.forEach(node => {
          if (node instanceof HTMLElement) {
            if (node.matches(loaderSelector)) changed.add(node);
            node.querySelectorAll?.(loaderSelector).forEach(el => changed.add(el));
            protectBlankLinks(node);
            markActiveLinks(node);
          }
        });
      });
      changed.forEach(decorateLoader);
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
  }

  function protectBlankLinks(scope = document) {
    const links = [];
    if (scope instanceof HTMLAnchorElement && scope.target === "_blank") links.push(scope);
    scope.querySelectorAll?.('a[target="_blank"]').forEach(link => links.push(link));

    links.forEach(link => {
      const rel = new Set(String(link.getAttribute("rel") || "").split(/\s+/).filter(Boolean));
      rel.add("noopener");
      rel.add("noreferrer");
      link.setAttribute("rel", [...rel].join(" "));
    });
  }

  function pageFileName(url) {
    const file = String(url.pathname || "").split("/").pop();
    return file || "index.html";
  }

  function markActiveLinks(scope = document) {
    const links = [];
    const selector = ":where(.topnav, nav, .topnav-actions, .nav-right) a[href]";
    if (scope instanceof HTMLAnchorElement && scope.matches(selector)) links.push(scope);
    scope.querySelectorAll?.(selector).forEach(link => links.push(link));

    const currentUrl = new URL(window.location.href);
    const currentFile = pageFileName(currentUrl);
    links.forEach(link => {
      const href = link.getAttribute("href") || "";
      if (!href || href.startsWith("#") || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      const isActive = pageFileName(url) === currentFile &&
        (!url.search || url.search === currentUrl.search);
      link.classList.toggle("utwx-active-link", isActive);
      if (isActive) link.setAttribute("aria-current", "page");
      else if (link.getAttribute("aria-current") === "page") link.removeAttribute("aria-current");
    });
  }

  function ensureBackTop() {
    let button = document.querySelector(".utwx-back-top");
    if (!button) {
      button = document.createElement("button");
      button.className = "utwx-back-top";
      button.type = "button";
      button.setAttribute("aria-label", "Back to top");
      button.title = "Back to top";
      button.innerHTML = '<svg fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>';
      button.addEventListener("click", () => {
        const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
        window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
      });
      document.body.appendChild(button);
    }
    return button;
  }

  function watchBackTop() {
    const button = ensureBackTop();
    const update = () => {
      button.classList.toggle("show", window.scrollY > 720);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
  }

  function isSameSiteUrl(url) {
    if (!["http:", "https:", "file:"].includes(url.protocol)) return false;
    return window.location.protocol === "file:" || url.origin === window.location.origin;
  }

  function handleNavigationClick(event) {
    const link = event.target.closest?.("a[href]");
    if (!(link instanceof HTMLAnchorElement)) return;
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link.target || link.hasAttribute("download")) return;

    const url = new URL(link.href, window.location.href);
    const samePage = url.pathname === window.location.pathname &&
      url.search === window.location.search;
    if (!isSameSiteUrl(url) || samePage || url.href === window.location.href) return;

    root.classList.add("utwx-navigating");
    setProgress(true);
  }

  function handleSubmit(event) {
    if (!(event.target instanceof HTMLFormElement)) return;
    root.classList.add("utwx-working");
    setProgress(true);
    window.setTimeout(() => {
      root.classList.remove("utwx-working");
      setProgress(false);
    }, 1400);
  }

  function initPolish() {
    ensureProgressBar();
    protectBlankLinks();
    markActiveLinks();
    watchBackTop();
    scanLoaders();
    watchLoaderChanges();
    document.addEventListener("click", handleNavigationClick, true);
    document.addEventListener("submit", handleSubmit, true);
    window.requestAnimationFrame(() => root.classList.add("utwx-loaded"));
    const finishInitialLoad = () => {
      window.setTimeout(() => setProgress(false), 180);
    };
    if (document.readyState === "complete") {
      finishInitialLoad();
    } else {
      window.addEventListener("load", finishInitialLoad, { once: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPolish, { once: true });
  } else {
    initPolish();
  }
})();
