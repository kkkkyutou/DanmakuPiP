const BILIBILI_DANMAKU_URL = "https://api.bilibili.com/x/v1/dm/list.so?oid=";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return false;
  }

  if (message.type === "FETCH_BILIBILI_DANMAKU") {
    fetchBilibiliDanmaku(message.cid)
      .then((events) => sendResponse({ ok: true, events }))
      .catch((error) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      );
    return true;
  }

  if (message.type === "FETCH_YOUTUBE_CAPTIONS") {
    fetchYoutubeCaptions(message.baseUrl)
      .then((events) => sendResponse({ ok: true, events }))
      .catch((error) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      );
    return true;
  }

  return false;
});

async function fetchBilibiliDanmaku(cid) {
  if (!cid) {
    throw new Error("缺少 B站 cid");
  }
  const response = await fetch(`${BILIBILI_DANMAKU_URL}${encodeURIComponent(String(cid))}`);
  if (!response.ok) {
    throw new Error(`获取 B站弹幕失败: ${response.status}`);
  }
  const xmlText = await response.text();
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  const dNodes = Array.from(doc.querySelectorAll("d"));
  const events = dNodes
    .map((node, index) => {
      const p = node.getAttribute("p");
      if (!p) return null;
      const parts = p.split(",");
      const t = Number(parts[0]);
      const modeNum = Number(parts[1]);
      const color = `#${Number(parts[3] || 16777215).toString(16).padStart(6, "0")}`;
      const text = (node.textContent || "").trim();
      if (!text || Number.isNaN(t)) return null;
      return {
        id: `bili-${index}`,
        source: "bilibili",
        t,
        mode: modeNum === 5 ? "top" : modeNum === 4 ? "bottom" : "scroll",
        color,
        text
      };
    })
    .filter(Boolean);

  return events;
}

async function fetchYoutubeCaptions(baseUrl) {
  if (!baseUrl) {
    throw new Error("缺少 YouTube captions baseUrl");
  }
  const url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}fmt=srv3`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`获取 YouTube 时间文本失败: ${response.status}`);
  }
  const xmlText = await response.text();
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  const textNodes = Array.from(doc.querySelectorAll("text"));
  const events = textNodes
    .map((node, index) => {
      const start = Number(node.getAttribute("start"));
      const text = decodeHtmlEntities((node.textContent || "").replace(/\s+/g, " ").trim());
      if (!text || Number.isNaN(start)) return null;
      return {
        id: `yt-${index}`,
        source: "youtube",
        t: start,
        mode: "bottom",
        color: "#FFFFFF",
        text
      };
    })
    .filter(Boolean);
  return events;
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}
