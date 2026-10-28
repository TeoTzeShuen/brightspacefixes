(async () => {
  const CACHE_KEY = "panelCache";
  const CACHE_TTL = 15 * 60 * 1000;
  // Enrollments carry no term info, but SIT course names end in a tag like "[2026/27 T1]",
  // which sorts chronologically as a string.
  const TERM_RE = /\[(\d{4}\/\d{2} T\d+)\]\s*$/;

  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children.filter((c) => c != null));
    return node;
  };

  const shortDate = (iso) =>
    new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  function currentCourses(enrollments) {
    const now = Date.now();
    const active = enrollments.filter(
      (e) => e.Access.IsActive && e.Access.CanAccess && Date.parse(e.Access.StartDate) <= now
    );
    const term = (e) => e.OrgUnit.Name.match(TERM_RE)?.[1];
    const latest = active.map(term).filter(Boolean).sort().at(-1);
    const picked = latest ? active.filter((e) => term(e) === latest) : active.filter((e) => e.PinDate);
    return picked.map((e) => ({ id: e.OrgUnit.Id, name: e.OrgUnit.Name, code: e.OrgUnit.Code, url: e.OrgUnit.HomeUrl }));
  }

  async function load(force) {
    const { [CACHE_KEY]: cache } = await ext.storage.local.get(CACHE_KEY);
    if (!force && cache && Date.now() - cache.at < CACHE_TTL) return cache;

    await API.versions();
    const courses = currentCourses(await API.myCourses());
    const data = await Promise.all(
      courses.map(async (c) => {
        const [content, grades, assignments] = await Promise.all([
          API.contentProgress(c.id).catch(() => null),
          API.grades(c.id).catch(() => null),
          API.assignments(c.id).catch(() => null),
        ]);
        return { ...c, content, grades, assignments };
      })
    );
    const fresh = { at: Date.now(), courses: data };
    await ext.storage.local.set({ [CACHE_KEY]: fresh });
    return fresh;
  }

  function progressBar(done, total) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    return el(
      "div",
      { className: "bsf-progress" },
      el("div", { className: "bsf-progress-track" }, el("div", { className: "bsf-progress-fill", style: `width:${pct}%` })),
      el("span", { className: "bsf-progress-label", textContent: `${done}/${total} · ${pct}%` })
    );
  }

  function courseCard(c) {
    const title = c.name.replace(/\s*\[.*?\]\s*$/, "");
    const card = el("details", { className: "bsf-course" });
    const final = c.grades?.final;

    card.append(
      el(
        "summary",
        {},
        el("a", { href: c.url, className: "bsf-course-name", textContent: title }),
        final ? el("span", { className: "bsf-final", textContent: final }) : null,
        c.content?.total ? progressBar(c.content.done, c.content.total) : null
      )
    );

    const body = el("div", { className: "bsf-course-body" });
    if (c.assignments?.total)
      body.append(
        el("div", { className: "bsf-row", textContent: `Assignments submitted: ${c.assignments.submitted}/${c.assignments.total}` })
      );
    if (c.content?.nextDue)
      body.append(
        el(
          "div",
          { className: "bsf-row" },
          "Next due: ",
          el("a", { href: c.content.nextDue.url, textContent: c.content.nextDue.name }),
          ` (${shortDate(c.content.nextDue.due)})`
        )
      );

    const items = c.grades?.items ?? [];
    if (items.length) {
      const table = el("table", { className: "bsf-grades" });
      for (const g of items)
        table.append(el("tr", {}, el("td", { textContent: g.name }), el("td", { textContent: g.grade })));
      body.append(table);
    } else {
      body.append(el("div", { className: "bsf-muted", textContent: "No released grades yet." }));
    }

    card.append(body);
    return card;
  }

  function mount() {
    const panel = el("aside", { className: "bsf-panel", id: "bsf-panel" });
    const toggle = el("button", { className: "bsf-tab", textContent: "Progress", type: "button" });
    toggle.addEventListener("click", () => panel.classList.toggle("bsf-open"));
    document.body.append(panel, toggle);

    // Sit in the empty gutter to the right of the homepage layout when it's wide
    // enough; otherwise collapse into a slide-out drawer behind the tab.
    const place = () => {
      const layout = document.querySelector(".homepage-col-12") ?? document.querySelector(".homepage-col-4");
      const header = document.querySelector("d2l-navigation, .d2l-navigation-s");
      const right = layout?.getBoundingClientRect().right ?? innerWidth;
      const gutter = innerWidth - right;
      const top = Math.max(16, (header?.getBoundingClientRect().bottom ?? 0) + 16);
      const docked = gutter >= 280;
      panel.classList.toggle("bsf-docked", docked);
      toggle.hidden = docked;
      panel.style.top = `${top}px`;
      panel.style.left = docked ? `${right + 16}px` : "";
      panel.style.width = docked ? `${Math.min(360, gutter - 32)}px` : "";
    };
    place();
    addEventListener("resize", place);
    // Header loads lazily; re-place once it settles.
    setTimeout(place, 1500);
    return panel;
  }

  async function render(panel, force) {
    const refresh = el("button", { className: "bsf-refresh", type: "button", title: "Refresh", textContent: "↻" });
    refresh.addEventListener("click", () => render(panel, true));
    const dark = el("button", { className: "bsf-refresh", type: "button", title: "Toggle dark mode", textContent: "◐" });
    dark.addEventListener("click", async () => {
      const { darkMode } = await getSettings();
      ext.storage.local.set({ darkMode: !darkMode });
    });
    const header = el(
      "div",
      { className: "bsf-header" },
      el("h2", { textContent: "Course progress" }),
      el("div", {}, dark, refresh)
    );
    panel.replaceChildren(header, el("div", { className: "bsf-muted", textContent: "Loading…" }));

    try {
      const data = await load(force);
      const list = data.courses.length
        ? data.courses.map(courseCard)
        : [el("div", { className: "bsf-muted", textContent: "No current courses found." })];
      panel.replaceChildren(
        header,
        ...list,
        el("div", { className: "bsf-footnote", textContent: `Updated ${new Date(data.at).toLocaleTimeString()}` })
      );
    } catch (err) {
      panel.replaceChildren(header, el("div", { className: "bsf-error", textContent: `Couldn't load: ${err.message}` }));
    }
  }

  const settings = await getSettings();
  let panel = null;
  const sync = (on) => {
    if (on && !panel) render((panel = mount()));
    if (panel) {
      panel.hidden = !on;
      document.querySelector(".bsf-tab")?.toggleAttribute("data-off", !on);
    }
  };
  sync(settings.panel);
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && "panel" in changes) sync(changes.panel.newValue);
  });
})();
