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
    // DueDate is never populated here on xSITE; deadlines come from dropbox/quizzes instead.
    const counted = items.filter((i) => !i.IsExempt);
    return { done: counted.filter((i) => i.DateCompleted).length, total: counted.length };
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
    return folders.map((f, i) => ({
      kind: "Dropbox",
      name: f.Name,
      due: f.DueDate ?? f.Availability?.EndDate ?? null,
      done: !!statuses[i]?.some((e) => e.Submissions?.length),
      url: `/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${f.Id}&ou=${ou}`,
    }));
  },

  async quizzes(ou) {
    const page = await API.get(`/d2l/api/le/${API.le}/${ou}/quizzes/`);
    // Undated quizzes (common for formative ones) can't go on a calendar.
    return (page?.Objects ?? [])
      .filter((q) => q.IsActive && (q.DueDate || q.EndDate))
      .map((q) => ({
        kind: "Quiz",
        name: q.Name,
        due: q.DueDate ?? q.EndDate,
        done: null,
        url: `/d2l/lms/quizzing/user/quiz_summary.d2l?qi=${q.QuizId}&ou=${ou}`,
      }));
  },
};
