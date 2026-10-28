(async () => {
  // Bump the suffix whenever the cached data shape changes.
  const CACHE_KEY = "panelCache.v2";
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
        const [content, grades, assignments, quizzes] = await Promise.all([
          API.contentProgress(c.id).catch(() => null),
          API.grades(c.id).catch(() => null),
          API.assignments(c.id).catch(() => []),
          API.quizzes(c.id).catch(() => []),
        ]);
        const short = (c.code ?? "").split("-").at(-1) || c.name.split("-")[0];
        const deadlines = [...assignments, ...quizzes].map((d) => ({ ...d, course: short }));
        return { ...c, short, content, grades, deadlines };
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
    const dropboxes = c.deadlines.filter((d) => d.kind === "Dropbox");
    if (dropboxes.length)
      body.append(
        el("div", {
          className: "bsf-row",
          textContent: `Assignments submitted: ${dropboxes.filter((d) => d.done).length}/${dropboxes.length}`,
        })
      );
    const next = c.deadlines
      .filter((d) => !d.done && d.due && Date.parse(d.due) > Date.now())
      .sort((a, b) => Date.parse(a.due) - Date.parse(b.due))[0];
    if (next)
      body.append(
        el(
          "div",
          { className: "bsf-row" },
          "Next due: ",
          el("a", { href: next.url, textContent: next.name }),
          ` (${shortDate(next.due)})`
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

  // Local YYYY-MM-DD, so a 23:59 SGT deadline lands on the right day.
  const dayKey = (d) => new Date(d).toLocaleDateString("en-CA");

  function status(d) {
    if (d.done) return "done";
    if (Date.parse(d.due) < Date.now()) return d.done === false ? "overdue" : "past";
    return "upcoming";
  }

  const STATUS_LABEL = { done: "Submitted", overdue: "Not submitted", past: "Closed", upcoming: "" };

  const HIDE_TIP = "Hide from calendar (click twice)";
  const CONFIRM_TIP = "Click again to hide this from the calendar. It stays on Brightspace; restore it below the list.";

  // Two-click hide without a dialog: the first click arms the button ("−?"),
  // the second hides. It disarms itself if the pointer or focus moves away.
  function hideButton(onHide) {
    const btn = el("button", { type: "button", className: "bsf-hide", textContent: "−", title: HIDE_TIP });
    btn.setAttribute("aria-label", HIDE_TIP);
    const disarm = () => {
      btn.classList.remove("bsf-armed");
      btn.textContent = "−";
      btn.title = HIDE_TIP;
      btn.setAttribute("aria-label", HIDE_TIP);
    };
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (!btn.classList.contains("bsf-armed")) {
        btn.classList.add("bsf-armed");
        btn.textContent = "−?";
        btn.title = CONFIRM_TIP;
        btn.setAttribute("aria-label", CONFIRM_TIP);
        return;
      }
      onHide();
    });
    btn.addEventListener("mouseleave", disarm);
    btn.addEventListener("blur", disarm);
    return btn;
  }

  function deadlineRow(d, onHide) {
    const s = status(d);
    return el(
      "li",
      { className: `bsf-deadline bsf-${s}` },
      el("span", { className: "bsf-dot" }),
      el(
        "div",
        { className: "bsf-deadline-text" },
        el("a", { href: d.url, textContent: d.name }),
        el("div", {
          className: "bsf-muted",
          textContent: [d.course, `due ${shortDate(d.due)}`, STATUS_LABEL[s]].filter(Boolean).join(" · "),
        })
      ),
      hideButton(onHide)
    );
  }

  const HIDDEN_KEY = "hiddenDeadlines";
  let monthOffset = 0;
  let selectedDay = null;

  // `hidden` is a Set of deadline URLs (unique per dropbox folder / quiz) the user dismissed.
  function calendar(deadlines, hidden) {
    const wrap = el("section", { className: "bsf-cal" });
    const saveHidden = () => ext.storage.local.set({ [HIDDEN_KEY]: [...hidden] });

    const draw = () => {
      const dated = deadlines.filter((d) => d.due && !hidden.has(d.url));
      const hiddenCount = deadlines.filter((d) => hidden.has(d.url)).length;
      const byDay = new Map();
      for (const d of dated) {
        const k = dayKey(d.due);
        byDay.set(k, [...(byDay.get(k) ?? []), d]);
      }
      const hide = (d) => () => {
        hidden.add(d.url);
        saveHidden();
        if (selectedDay && !byDay.get(selectedDay)?.some((x) => x !== d)) selectedDay = null;
        draw();
      };

      const today = new Date();
      const first = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
      const nav = (delta, label) => {
        const b = el("button", { type: "button", className: "bsf-cal-nav", textContent: label });
        b.addEventListener("click", () => {
          monthOffset += delta;
          selectedDay = null;
          draw();
        });
        return b;
      };

      const grid = el("div", { className: "bsf-cal-grid" });
      for (const w of ["M", "T", "W", "T", "F", "S", "S"]) grid.append(el("div", { className: "bsf-cal-wd", textContent: w }));
      // Monday-first: getDay() is 0 for Sunday.
      const lead = (first.getDay() + 6) % 7;
      for (let i = 0; i < lead; i++) grid.append(el("div"));
      const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      for (let n = 1; n <= days; n++) {
        const date = new Date(first.getFullYear(), first.getMonth(), n);
        const k = dayKey(date);
        const items = byDay.get(k) ?? [];
        const cell = el(
          items.length ? "button" : "div",
          { className: "bsf-cal-day", title: items.map((d) => `${d.course}: ${d.name}`).join("\n") },
          el("span", { textContent: n }),
          items.length
            ? el("span", { className: "bsf-cal-dots" }, ...items.slice(0, 3).map((d) => el("i", { className: `bsf-${status(d)}` })))
            : null
        );
        if (k === dayKey(today)) cell.classList.add("bsf-today");
        if (k === selectedDay) cell.classList.add("bsf-selected");
        if (items.length) {
          cell.type = "button";
          cell.setAttribute(
            "aria-label",
            `${date.toLocaleDateString(undefined, { day: "numeric", month: "long" })}: ${items.length} due`
          );
          cell.addEventListener("click", () => {
            selectedDay = selectedDay === k ? null : k;
            draw();
          });
        }
        grid.append(cell);
      }

      // Selected day's items, or everything still open plus the last week's misses.
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const list = selectedDay
        ? byDay.get(selectedDay) ?? []
        : dated
            .filter((d) => (status(d) === "upcoming" || status(d) === "overdue") && Date.parse(d.due) > weekAgo)
            .sort((a, b) => Date.parse(a.due) - Date.parse(b.due))
            .slice(0, 6);
      const heading = selectedDay
        ? new Date(selectedDay + "T00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })
        : "Upcoming";

      wrap.replaceChildren(
        el(
          "div",
          { className: "bsf-cal-month" },
          el(
            "div",
            { className: "bsf-cal-head" },
            nav(-1, "‹"),
            el("span", { textContent: first.toLocaleDateString(undefined, { month: "long", year: "numeric" }) }),
            nav(1, "›")
          ),
          grid
        ),
        el(
          "div",
          { className: "bsf-cal-side" },
          el("h3", { className: "bsf-cal-listhead", textContent: heading }),
          list.length
            ? el("ul", { className: "bsf-deadlines" }, ...list.map((d) => deadlineRow(d, hide(d))))
            : el("div", { className: "bsf-muted", textContent: "Nothing due." }),
          hiddenCount ? restoreButton(hiddenCount) : null
        )
      );
    };

    const restoreButton = (count) => {
      const btn = el("button", {
        type: "button",
        className: "bsf-restore",
        textContent: `${count} hidden · Restore`,
        title: "Show all hidden deadlines on the calendar again",
      });
      btn.addEventListener("click", () => {
        hidden.clear();
        saveHidden();
        draw();
      });
      return btn;
    };
    draw();
    return wrap;
  }

  // Native homepage widget chrome, so the boxes match Brightspace's own.
  function widget(id, title, ...actions) {
    const heading = el("h2", { className: "d2l-heading vui-heading-4", id: `${id}-title`, textContent: title });
    const body = el("div", { className: "bsf-widget-body" });
    const box = el(
      "div",
      { className: "d2l-widget d2l-tile bsf-widget", id, role: "region" },
      el(
        "div",
        { className: "d2l-widget-header bsf-widget-header" },
        el("div", { className: "d2l-homepage-header-wrapper" }, heading),
        actions.length ? el("div", { className: "bsf-actions" }, ...actions) : null
      ),
      body
    );
    box.setAttribute("aria-labelledby", heading.id);
    return { box, body };
  }

  function mount() {
    const refresh = el("button", { className: "bsf-icon-btn", type: "button", title: "Refresh", textContent: "↻" });
    refresh.addEventListener("click", () => render(true));
    const dark = el("button", { className: "bsf-icon-btn", type: "button", title: "Toggle dark mode", textContent: "◐" });
    dark.addEventListener("click", async () => {
      const { darkMode } = await getSettings();
      ext.storage.local.set({ darkMode: !darkMode });
    });

    const progress = widget("bsf-progress-widget", "Course Progress", dark, refresh);
    const deadlines = widget("bsf-deadlines-widget", "Deadlines");
    // Progress tops the right column (above My Settings); deadlines tops the main column (above My Courses).
    document.querySelector(".homepage-col-4")?.prepend(progress.box);
    document.querySelector(".homepage-col-8")?.prepend(deadlines.box);
    return { progress, deadlines };
  }

  let widgets = null;

  async function render(force) {
    const { progress, deadlines } = widgets;
    const loading = () => el("div", { className: "bsf-muted", textContent: "Loading…" });
    progress.body.replaceChildren(loading());
    deadlines.body.replaceChildren(loading());

    try {
      const data = await load(force);
      const list = data.courses.length
        ? data.courses.map(courseCard)
        : [el("div", { className: "bsf-muted", textContent: "No current courses found." })];
      progress.body.replaceChildren(
        ...list,
        el("div", { className: "bsf-footnote", textContent: `Updated ${new Date(data.at).toLocaleTimeString()}` })
      );
      const { [HIDDEN_KEY]: hidden = [] } = await ext.storage.local.get(HIDDEN_KEY);
      deadlines.body.replaceChildren(calendar(data.courses.flatMap((c) => c.deadlines ?? []), new Set(hidden)));
    } catch (err) {
      const msg = () => el("div", { className: "bsf-error", textContent: `Couldn't load: ${err.message}` });
      progress.body.replaceChildren(msg());
      deadlines.body.replaceChildren(msg());
    }
  }

  const settings = await getSettings();
  const sync = (on) => {
    if (on && !widgets && document.querySelector(".homepage-col-4")) {
      widgets = mount();
      render();
    }
    if (widgets) {
      widgets.progress.box.hidden = !on;
      widgets.deadlines.box.hidden = !on;
    }
  };
  sync(settings.panel);
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && "panel" in changes) sync(changes.panel.newValue);
  });
})();
