const statusText = document.getElementById("statusText");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const openOptionsBtn = document.getElementById("openOptionsBtn");

startBtn.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  const response = await sendToTab(tab.id, { type: "DANMAKU_PIP_START" });
  if (!response?.ok) {
    statusText.textContent = `启动失败：${response?.error || "未知错误"}`;
    return;
  }
  statusText.textContent = "已启动 PiP 弹幕";
});

stopBtn.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  await sendToTab(tab.id, { type: "DANMAKU_PIP_STOP" });
  statusText.textContent = "已关闭 PiP 弹幕";
});

openOptionsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

initStatus();

async function initStatus() {
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url) {
    statusText.textContent = "未找到可用标签页";
    return;
  }
  if (!/https:\/\/(www\.bilibili\.com\/video\/|www\.youtube\.com\/watch)/.test(tab.url)) {
    statusText.textContent = "请先打开 B站视频页或 YouTube watch 页";
    return;
  }
  const response = await sendToTab(tab.id, { type: "DANMAKU_PIP_STATUS" });
  if (response?.ok) {
    statusText.textContent = response.running
      ? `运行中（${response.site}，${response.eventCount} 条）`
      : `可启动（${response.site}）`;
  } else {
    statusText.textContent = "页面未就绪，请刷新后重试";
  }
}

function getActiveTab() {
  return chrome.tabs
    .query({ active: true, currentWindow: true })
    .then((tabs) => tabs[0])
    .catch(() => null);
}

function sendToTab(tabId, payload) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, payload, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}
