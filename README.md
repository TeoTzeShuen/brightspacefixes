# Brightspace Fixes

Quality-of-life fixes for SIT's xSITE (D2L Brightspace). Firefox first, and also works in Chrome.

## Features

- **Dark mode**: inverts the page, including Brightspace's shadow-DOM components, and leaves photos and videos in their original colours. Toggle it with the moon button on the toolbar, or with ◐ in the panel header. In Firefox, if the button isn't on the toolbar, open the puzzle-piece Extensions menu and choose ⚙ → *Pin to Toolbar*.
- **Progress panel** on the homepage: lists courses in the current term (taken from the `[YYYY/YY Tn]` tag in course names), with:
  - content completion (from `content/myItems`)
  - assignments submitted (from `dropbox/folders/*/submissions/mysubmissions`)
  - next due item
  - a **deadlines calendar** covering Dropbox folders and dated quizzes across current courses. Today is highlighted, and each due day has a dot: blue = upcoming, green = submitted, red = past due and not submitted, grey = closed quiz. Click a day to list its items, and use ‹ › to change month. Below the calendar is an "Upcoming" list.
  - released grade items and the final grade once it's released
  
  It appears as two native-looking homepage widgets: **Course Progress** at the top of the right column, and **Deadlines** (the calendar) above My Courses. Data is cached for 15 minutes; ↻ refreshes it.

## Install (Firefox)

1. Go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and pick `manifest.json`.
3. Open the extension's menu (puzzle-piece icon) and make sure it's allowed on `xsite.singaporetech.edu.sg`. Firefox MV3 treats host permissions as optional.

A temporary add-on is removed when Firefox restarts. To keep it installed permanently, sign it as an unlisted add-on with `web-ext sign`.

## Install (Chrome)

Go to `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and select this folder.

## Layout

```
manifest.json      MV3 manifest with a gecko id for Firefox
src/compat.js      browser/chrome shim and settings defaults
src/darkmode.*     dark mode (document_start, all xSITE pages)
src/api.js         Valence REST client (same-origin and cookie-authenticated)
src/panel.*        homepage progress/grades panel
popup/             toolbar toggles
```
