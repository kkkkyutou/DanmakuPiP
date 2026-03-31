const BILIBILI_DANMAKU_URL = "https://api.bilibili.com/x/v1/dm/list.so?oid=";
const BILIBILI_LEGACY_DANMAKU_URL = "https://comment.bilibili.com/";

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
  const legacyUrl = `${BILIBILI_LEGACY_DANMAKU_URL}${encodeURIComponent(String(cid))}.xml`;
  const legacyResp = await fetch(legacyUrl);
  if (legacyResp.ok) {
    return parseBilibiliDanmakuXml(await legacyResp.text());
  }

  const response = await fetch(`${BILIBILI_DANMAKU_URL}${encodeURIComponent(String(cid))}`);
  if (!response.ok) {
    throw new Error(`获取 B站弹幕失败: legacy=${legacyResp.status}, api=${response.status}`);
  }
  return parseBilibiliDanmakuXml(await response.text());
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
  return parseYoutubeCaptionsXml(xmlText);
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, code) => String.fromCharCode(parseInt(code, 16)));
}

function parseBilibiliDanmakuXml(xmlText) {
  const pattern = /<d\s+[^>]*p="([^"]+)"[^>]*>([\s\S]*?)<\/d>/g;
  const events = [];
  let match;
  let index = 0;
  while ((match = pattern.exec(xmlText)) !== null) {
    const p = match[1];
    const rawText = match[2] || "";
    const parts = p.split(",");
    const t = Number(parts[0]);
    const modeNum = Number(parts[1]);
    const colorNum = Number(parts[3] || 16777215);
    const text = decodeHtmlEntities(rawText).replace(/\s+/g, " ").trim();
    if (!text || Number.isNaN(t)) continue;
    events.push({
      id: `bili-${index}`,
      source: "bilibili",
      t,
      mode: modeNum === 5 ? "top" : modeNum === 4 ? "bottom" : "scroll",
      color: `#${colorNum.toString(16).padStart(6, "0")}`,
      text
    });
    index += 1;
  }
  return events;
}

function parseYoutubeCaptionsXml(xmlText) {
  const pattern = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  const events = [];
  let match;
  let index = 0;
  while ((match = pattern.exec(xmlText)) !== null) {
    const attrs = match[1] || "";
    const rawText = match[2] || "";
    const startMatch = attrs.match(/\bstart="([^"]+)"/);
    const start = Number(startMatch ? startMatch[1] : NaN);
    const text = decodeHtmlEntities(rawText).replace(/\s+/g, " ").trim();
    if (!text || Number.isNaN(start)) continue;
    events.push({
      id: `yt-${index}`,
      source: "youtube",
      t: start,
      mode: "bottom",
      color: "#FFFFFF",
      text
    });
    index += 1;
  }
  return events;
}
