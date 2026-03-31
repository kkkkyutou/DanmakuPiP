const ids = {
  fontSize: document.getElementById("fontSize"),
  opacity: document.getElementById("opacity"),
  speed: document.getElementById("speed"),
  density: document.getElementById("density"),
  maxFps: document.getElementById("maxFps"),
  blockedKeywords: document.getElementById("blockedKeywords"),
  debug: document.getElementById("debug"),
  saveBtn: document.getElementById("saveBtn"),
  saveResult: document.getElementById("saveResult")
};

const DEFAULTS = {
  fontSize: 24,
  opacity: 0.9,
  speed: 140,
  density: 50,
  maxFps: 45,
  blockedKeywords: [],
  debug: false
};

init();
ids.saveBtn.addEventListener("click", save);

async function init() {
  const data = await chrome.storage.local.get(DEFAULTS);
  ids.fontSize.value = data.fontSize;
  ids.opacity.value = data.opacity;
  ids.speed.value = data.speed;
  ids.density.value = data.density;
  ids.maxFps.value = data.maxFps;
  ids.blockedKeywords.value = (data.blockedKeywords || []).join(", ");
  ids.debug.checked = Boolean(data.debug);
}

async function save() {
  const keywords = ids.blockedKeywords.value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  const payload = {
    fontSize: toNum(ids.fontSize.value, 24),
    opacity: toNum(ids.opacity.value, 0.9),
    speed: toNum(ids.speed.value, 140),
    density: toNum(ids.density.value, 50),
    maxFps: toNum(ids.maxFps.value, 45),
    blockedKeywords: keywords,
    debug: ids.debug.checked
  };

  await chrome.storage.local.set(payload);
  ids.saveResult.textContent = "已保存";
  setTimeout(() => {
    ids.saveResult.textContent = "";
  }, 1600);
}

function toNum(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
