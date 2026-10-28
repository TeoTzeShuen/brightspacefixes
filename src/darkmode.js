(async () => {
  // The page-level invert reaches into shadow roots, but darkmode.css's media
  // re-invert rules don't, so each open shadow root gets its own copy.
  const SHADOW_CSS = "img, picture, video, canvas { filter: invert(1) hue-rotate(180deg); }";
  const shadowStyles = [];
  const observed = new WeakSet();
  let enabled = false;

  function patch(root) {
    for (const node of root.querySelectorAll("*")) {
      const sr = node.shadowRoot;
      if (!sr) continue;
      // The header logo has dark text, so it reads better left inverted.
      if (!observed.has(sr) && node.localName !== "d2l-labs-navigation-link-image") {
        observed.add(sr);
        const style = document.createElement("style");
        style.textContent = SHADOW_CSS;
        style.media = enabled ? "all" : "not all";
        sr.append(style);
        shadowStyles.push(style);
        observer.observe(sr, { childList: true, subtree: true });
      }
      // Always descend: components inside an already-patched root may be new.
      patch(sr);
    }
  }

  let pending = false;
  const observer = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      patch(document);
    }, 250);
  });

  const apply = (on) => {
    enabled = on;
    document.documentElement.classList.toggle("bsf-dark", on);
    for (const s of shadowStyles) s.media = on ? "all" : "not all";
    if (on && !observed.has(document)) {
      observed.add(document);
      observer.observe(document, { childList: true, subtree: true });
      patch(document);
    }
  };

  const { darkMode } = await getSettings();
  apply(darkMode);

  ext.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && "darkMode" in changes) apply(changes.darkMode.newValue);
  });
})();
