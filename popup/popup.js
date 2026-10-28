(async () => {
  const settings = await getSettings();
  for (const key of Object.keys(DEFAULTS)) {
    const box = document.getElementById(key);
    box.checked = settings[key];
    box.addEventListener("change", () => ext.storage.local.set({ [key]: box.checked }));
  }
})();
