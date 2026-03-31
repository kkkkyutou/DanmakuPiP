(function () {
  const STATE = {
    running: false,
    site: detectSite(),
    sourceVideo: null,
    pipWindow: null,
    pipVideo: null,
    danmakuCanvas: null,
    danmakuCtx: null,
    rafId: null,
    settings: {
      fontSize: 24,
      opacity: 0.9,
      speed: 140,
      density: 50,
      blockedKeywords: []
    },
    events: [],
    active: [],
    spawnedIds: new Set(),
    lastRenderTs: 0,
    trackCursor: 0,
    debug: false
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") return false;

    if (message.type === "DANMAKU_PIP_START") {
      startPiP()
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, error: safeError(error) }));
      return true;
    }

    if (message.type === "DANMAKU_PIP_STOP") {
      stopPiP();
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "DANMAKU_PIP_STATUS") {
      sendResponse({
        ok: true,
        running: STATE.running,
        site: STATE.site,
        eventCount: STATE.events.length
      });
      return false;
    }

    return false;
  });

  initStorageWatcher();

  async function startPiP() {
    if (STATE.running) return;
    ensureSupported();

    const video = findVideoElement();
    if (!video) {
      throw new Error("未找到可用视频元素，请先开始播放视频后再试");
    }

    STATE.sourceVideo = video;
    STATE.settings = await loadSettings();
    STATE.events = await loadDanmakuEvents();
    STATE.spawnedIds.clear();
    STATE.active = [];
    STATE.trackCursor = 0;

    if (!STATE.events.length) {
      throw new Error("未获取到可显示内容（B站弹幕或 YouTube 时间文本）");
    }

    const pipWindow = await documentPictureInPicture.requestWindow({
      width: Math.max(480, Math.floor(video.clientWidth || 640)),
      height: Math.max(270, Math.floor(video.clientHeight || 360))
    });

    mountPiPWindow(pipWindow, video);
    STATE.pipWindow = pipWindow;
    STATE.running = true;
    renderLoop(performance.now());
    log(`已启动，事件数: ${STATE.events.length}`);
  }

  function stopPiP() {
    STATE.running = false;
    STATE.spawnedIds.clear();
    STATE.active = [];
    if (STATE.rafId) {
      cancelAnimationFrame(STATE.rafId);
      STATE.rafId = null;
    }
    if (STATE.pipWindow && !STATE.pipWindow.closed) {
      STATE.pipWindow.close();
    }
    STATE.pipWindow = null;
    STATE.pipVideo = null;
    STATE.danmakuCanvas = null;
    STATE.danmakuCtx = null;
  }

  function mountPiPWindow(pipWindow, sourceVideo) {
    const doc = pipWindow.document;
    doc.head.innerHTML = "";
    doc.body.innerHTML = "";
    doc.body.style.margin = "0";
    doc.body.style.background = "#000";
    doc.body.style.overflow = "hidden";

    const container = doc.createElement("div");
    container.style.position = "relative";
    container.style.width = "100vw";
    container.style.height = "100vh";
    container.style.background = "#000";

    const pipVideo = doc.createElement("video");
    pipVideo.muted = true;
    pipVideo.autoplay = true;
    pipVideo.playsInline = true;
    pipVideo.style.width = "100%";
    pipVideo.style.height = "100%";
    pipVideo.style.objectFit = "contain";
    const stream = sourceVideo.captureStream();
    pipVideo.srcObject = stream;

    const canvas = doc.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.width = pipWindow.innerWidth;
    canvas.height = pipWindow.innerHeight;
    canvas.style.pointerEvents = "none";

    container.appendChild(pipVideo);
    container.appendChild(canvas);
    doc.body.appendChild(container);

    pipWindow.addEventListener("resize", () => resizeCanvas(canvas, pipWindow), { passive: true });
    pipWindow.addEventListener("pagehide", stopPiP, { once: true });
    resizeCanvas(canvas, pipWindow);

    STATE.pipVideo = pipVideo;
    STATE.danmakuCanvas = canvas;
    STATE.danmakuCtx = canvas.getContext("2d");
  }

  function resizeCanvas(canvas, pipWindow) {
    canvas.width = pipWindow.innerWidth;
    canvas.height = pipWindow.innerHeight;
  }

  function renderLoop(now) {
    if (!STATE.running || !STATE.danmakuCtx || !STATE.danmakuCanvas || !STATE.sourceVideo) return;
    const deltaMs = Math.max(16, now - (STATE.lastRenderTs || now));
    STATE.lastRenderTs = now;

    const current = STATE.sourceVideo.currentTime || 0;
    spawnDueEvents(current);
    advanceActive(deltaMs / 1000, STATE.sourceVideo.playbackRate || 1);
    drawFrame();

    STATE.rafId = requestAnimationFrame(renderLoop);
  }

  function spawnDueEvents(currentTime) {
    const densityCap = Math.max(20, Number(STATE.settings.density) || 50);
    if (STATE.active.length >= densityCap) return;

    for (let i = 0; i < STATE.events.length; i += 1) {
      const event = STATE.events[i];
      if (STATE.spawnedIds.has(event.id)) continue;
      if (event.t > currentTime + 0.12) break;
      if (event.t < currentTime - 2.0) {
        STATE.spawnedIds.add(event.id);
        continue;
      }
      if (isBlocked(event.text)) {
        STATE.spawnedIds.add(event.id);
        continue;
      }
      if (STATE.active.length >= densityCap) break;

      STATE.active.push(createActiveDanmaku(event));
      STATE.spawnedIds.add(event.id);
    }
  }

  function createActiveDanmaku(event) {
    const canvas = STATE.danmakuCanvas;
    const fontSize = Number(STATE.settings.fontSize) || 24;
    const speed = Number(STATE.settings.speed) || 140;
    const trackHeight = Math.max(28, fontSize + 8);
    const trackCount = Math.max(4, Math.floor(canvas.height / trackHeight));
    const lane = STATE.trackCursor % trackCount;
    STATE.trackCursor += 1;

    const yBase = lane * trackHeight + fontSize;
    const maxY = Math.max(fontSize + 4, canvas.height - 6);
    const y = Math.min(maxY, yBase);

    if (event.mode === "top") {
      return {
        ...event,
        x: (canvas.width - 200) / 2,
        y: fontSize + 6,
        ttl: 2.5,
        speed: 0
      };
    }
    if (event.mode === "bottom") {
      return {
        ...event,
        x: (canvas.width - 200) / 2,
        y: canvas.height - 12,
        ttl: 2.5,
        speed: 0
      };
    }
    return {
      ...event,
      x: canvas.width + 24,
      y,
      ttl: 8,
      speed
    };
  }

  function advanceActive(dt, playbackRate) {
    const canvas = STATE.danmakuCanvas;
    const out = [];
    for (const item of STATE.active) {
      const next = item;
      next.ttl -= dt;
      if (item.mode === "scroll") {
        next.x -= next.speed * dt * playbackRate;
      }
      if (next.ttl > 0 && next.x > -canvas.width * 1.5) {
        out.push(next);
      }
    }
    STATE.active = out;
  }

  function drawFrame() {
    const canvas = STATE.danmakuCanvas;
    const ctx = STATE.danmakuCtx;
    const fontSize = Number(STATE.settings.fontSize) || 24;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textBaseline = "alphabetic";
    ctx.globalAlpha = Number(STATE.settings.opacity) || 0.9;

    for (const item of STATE.active) {
      ctx.fillStyle = item.color || "#FFFFFF";
      ctx.strokeStyle = "rgba(0,0,0,0.75)";
      ctx.lineWidth = Math.max(2, Math.floor(fontSize / 8));
      ctx.strokeText(item.text, item.x, item.y);
      ctx.fillText(item.text, item.x, item.y);
    }

    ctx.globalAlpha = 1;
  }

  async function loadDanmakuEvents() {
    if (STATE.site === "bilibili") {
      const cid = await getBilibiliCid();
      if (!cid) return [];
      const response = await sendRuntimeMessage({ type: "FETCH_BILIBILI_DANMAKU", cid });
      if (!response || !response.ok) {
        throw new Error(response?.error || "加载 B站弹幕失败");
      }
      return normalizeEvents(response.events || []);
    }

    if (STATE.site === "youtube") {
      const baseUrl = await getYoutubeCaptionBaseUrl();
      if (!baseUrl) return [];
      const response = await sendRuntimeMessage({ type: "FETCH_YOUTUBE_CAPTIONS", baseUrl });
      if (!response || !response.ok) {
        throw new Error(response?.error || "加载 YouTube 时间文本失败");
      }
      return normalizeEvents(response.events || []);
    }

    throw new Error("当前站点未支持");
  }

  async function getBilibiliCid() {
    const bvidMatch = location.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/i);
    const bvid = bvidMatch ? bvidMatch[1] : "";
    if (!bvid) return null;
    const p = Number(new URLSearchParams(location.search).get("p") || "1");
    const api = `https://api.bilibili.com/x/player/pagelist?bvid=${encodeURIComponent(bvid)}`;
    const response = await fetch(api, { credentials: "omit" });
    if (!response.ok) return null;
    const json = await response.json();
    if (!json || !Array.isArray(json.data)) return null;
    const item = json.data[Math.max(0, p - 1)] || json.data[0];
    return item ? item.cid : null;
  }

  async function getYoutubeCaptionBaseUrl() {
    const html = document.documentElement.innerHTML;
    const marker = '"captionTracks":';
    const startIdx = html.indexOf(marker);
    if (startIdx < 0) return null;
    const arrStart = html.indexOf("[", startIdx);
    if (arrStart < 0) return null;
    const arrEnd = findMatchingBracket(html, arrStart);
    if (arrEnd < 0) return null;
    const jsonText = html.slice(arrStart, arrEnd + 1);
    try {
      const tracks = JSON.parse(jsonText);
      if (!Array.isArray(tracks) || !tracks.length) return null;
      const preferred = tracks.find((track) => String(track.vssId || "").includes(".zh")) || tracks[0];
      return preferred.baseUrl || null;
    } catch (_error) {
      return null;
    }
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

  function normalizeEvents(events) {
    return events
      .map((item, index) => ({
        id: String(item.id || `e-${index}`),
        source: item.source || STATE.site,
        t: Number(item.t || 0),
        mode: item.mode || "scroll",
        color: item.color || "#FFFFFF",
        text: String(item.text || "").trim()
      }))
      .filter((item) => item.text && Number.isFinite(item.t))
      .sort((a, b) => a.t - b.t);
  }

  function detectSite() {
    const host = location.hostname;
    if (host.includes("bilibili.com")) return "bilibili";
    if (host.includes("youtube.com")) return "youtube";
    return "unknown";
  }

  function findVideoElement() {
    const videos = Array.from(document.querySelectorAll("video"));
    if (!videos.length) return null;
    return videos.sort((a, b) => (b.videoWidth || 0) * (b.videoHeight || 0) - (a.videoWidth || 0) * (a.videoHeight || 0))[0];
  }

  function ensureSupported() {
    if (!("documentPictureInPicture" in window)) {
      throw new Error("当前浏览器不支持 Document Picture-in-Picture API，请使用较新的 Edge/Chrome");
    }
  }

  function sendRuntimeMessage(payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response);
      });
    });
  }

  async function loadSettings() {
    const defaults = {
      fontSize: 24,
      opacity: 0.9,
      speed: 140,
      density: 50,
      blockedKeywords: [],
      debug: false
    };
    const value = await chrome.storage.local.get(defaults);
    STATE.debug = Boolean(value.debug);
    return {
      fontSize: clampNumber(value.fontSize, 14, 48, defaults.fontSize),
      opacity: clampNumber(value.opacity, 0.2, 1, defaults.opacity),
      speed: clampNumber(value.speed, 80, 240, defaults.speed),
      density: clampNumber(value.density, 20, 120, defaults.density),
      blockedKeywords: Array.isArray(value.blockedKeywords) ? value.blockedKeywords : []
    };
  }

  function initStorageWatcher() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;
      if (!STATE.running) return;
      if (
        changes.fontSize ||
        changes.opacity ||
        changes.speed ||
        changes.density ||
        changes.blockedKeywords ||
        changes.debug
      ) {
        loadSettings().then((settings) => {
          STATE.settings = settings;
        });
      }
    });
  }

  function clampNumber(raw, min, max, fallback) {
    const num = Number(raw);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, num));
  }

  function isBlocked(text) {
    const words = STATE.settings.blockedKeywords || [];
    if (!words.length) return false;
    return words.some((w) => w && text.includes(w));
  }

  function safeError(error) {
    return error instanceof Error ? error.message : String(error);
  }

  function log(msg) {
    if (STATE.debug) {
      console.info(`[DanmakuPiP] ${msg}`);
    }
  }
})();
