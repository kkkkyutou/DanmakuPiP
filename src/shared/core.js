(function initDanmakuCore(globalScope) {
  function clampNumber(raw, min, max, fallback) {
    const num = Number(raw);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, num));
  }

  function findMatchingBracket(text, start) {
    let depth = 0;
    let inString = false;
    let escaping = false;
    for (let i = start; i < text.length; i += 1) {
      const c = text[i];
      if (escaping) {
        escaping = false;
        continue;
      }
      if (c === "\\") {
        escaping = true;
        continue;
      }
      if (c === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (c === "[") depth += 1;
      if (c === "]") {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  function extractCaptionTracksFromHtml(html) {
    const marker = '"captionTracks":';
    const startIdx = html.indexOf(marker);
    if (startIdx < 0) return [];
    const arrStart = html.indexOf("[", startIdx);
    if (arrStart < 0) return [];
    const arrEnd = findMatchingBracket(html, arrStart);
    if (arrEnd < 0) return [];
    const jsonText = html.slice(arrStart, arrEnd + 1);
    try {
      const tracks = JSON.parse(jsonText);
      return Array.isArray(tracks) ? tracks : [];
    } catch (_error) {
      return [];
    }
  }

  function normalizeEvents(events, fallbackSource) {
    const seen = new Set();
    return (events || [])
      .map((item, index) => ({
        id: String(item.id || `e-${index}`),
        source: item.source || fallbackSource || "unknown",
        t: Number(item.t || 0),
        mode: item.mode || "scroll",
        color: item.color || "#FFFFFF",
        text: String(item.text || "").replace(/\s+/g, " ").trim()
      }))
      .filter((item) => item.text && Number.isFinite(item.t))
      .sort((a, b) => a.t - b.t)
      .filter((item) => {
        const rounded = Math.round(item.t * 5) / 5;
        const key = `${rounded}|${item.mode}|${item.text}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function parseKeywordList(input) {
    if (Array.isArray(input)) {
      return input.map((v) => String(v || "").trim()).filter(Boolean);
    }
    if (typeof input === "string") {
      return input
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
    }
    return [];
  }

  function isBlocked(text, blockedKeywords) {
    if (!Array.isArray(blockedKeywords) || !blockedKeywords.length) return false;
    const low = String(text || "").toLowerCase();
    return blockedKeywords.some((word) => low.includes(String(word || "").toLowerCase()));
  }

  const api = {
    clampNumber,
    findMatchingBracket,
    extractCaptionTracksFromHtml,
    normalizeEvents,
    parseKeywordList,
    isBlocked
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }
  globalScope.DanmakuCore = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
