// Thin client for the Brightspace Valence REST API, called same-origin with the
// user's session cookies. GETs don't need the XSRF token.
const API = {
  lp: "1.64",
  le: "1.100",

  // Firefox content scripts run fetch() with the extension's principal;
  // content.fetch() makes the request as the page, like Chrome does by default.
  fetch: globalThis.content?.fetch?.bind(globalThis.content) ?? globalThis.fetch.bind(globalThis),

  async get(path) {
    const res = await API.fetch(location.origin + path, { credentials: "include" });
    if (res.status === 404 || res.status === 403) return null;
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    return res.json();
  },

  async versions() {
    const list = await API.get("/d2l/api/versions/");
    for (const p of list ?? []) {
      if (p.ProductCode === "lp") API.lp = p.LatestVersion;
      if (p.ProductCode === "le") API.le = p.LatestVersion;
    }
  },

  async myCourses() {
    const items = [];
    let bookmark = "";
    do {
      const page = await API.get(
        `/d2l/api/lp/${API.lp}/enrollments/myenrollments/?orgUnitTypeId=3&bookmark=${bookmark}`
      );
      items.push(...page.Items);
      bookmark = page.PagingInfo.HasMoreItems ? page.PagingInfo.Bookmark : "";
    } while (bookmark);
    return items;
  },

  async contentProgress(ou) {
    const items = [];
    let path = `/d2l/api/le/${API.le}/${ou}/content/myItems/`;
    while (path) {
      const page = await API.get(path);
      if (!page) break;
      items.push(...page.Objects);
      path = page.Next ? new URL(page.Next, location.origin).href.slice(location.origin.length) : null;
    }
    const counted = items.filter((i) => !i.IsExempt);
    const now = Date.now();
    const upcoming = counted
      .filter((i) => !i.DateCompleted && i.DueDate && Date.parse(i.DueDate) > now)
      .sort((a, b) => Date.parse(a.DueDate) - Date.parse(b.DueDate));
    return {
      done: counted.filter((i) => i.DateCompleted).length,
      total: counted.length,
      nextDue: upcoming[0] ? { name: upcoming[0].ItemName, due: upcoming[0].DueDate, url: upcoming[0].ItemUrl } : null,
    };
  },

  async grades(ou) {
    const [final, values] = await Promise.all([
      API.get(`/d2l/api/le/${API.le}/${ou}/grades/final/values/myGradeValue`),
      API.get(`/d2l/api/le/${API.le}/${ou}/grades/values/myGradeValues/`),
    ]);
    return {
      final: final?.DisplayedGrade?.trim() || null,
      items: (values ?? [])
        .filter((v) => v.GradeObjectTypeName !== "Category")
        .map((v) => ({ name: v.GradeObjectName, grade: v.DisplayedGrade?.trim() || "—" })),
    };
  },

  async assignments(ou) {
    const folders = ((await API.get(`/d2l/api/le/${API.le}/${ou}/dropbox/folders/`)) ?? []).filter((f) => !f.IsHidden);
    const statuses = await Promise.all(
      folders.map((f) => API.get(`/d2l/api/le/${API.le}/${ou}/dropbox/folders/${f.Id}/submissions/mysubmissions/`))
    );
    // mysubmissions returns one entity per user/group; Submissions is non-empty once anything is handed in.
    const submitted = statuses.filter((s) => s?.some((e) => e.Submissions?.length)).length;
    return { submitted, total: folders.length };
  },
};
