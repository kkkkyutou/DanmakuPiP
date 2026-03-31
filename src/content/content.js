(function () {
  const core = globalThis.DanmakuCore || {};

  const STATE = {
    running: false,
    site: detectSite(),
    sourceVideo: null,
    pipWindow: null,
    pipVideo: null,
    danmakuCanvas: null,
    danmakuCtx: null,
    rafId: null,
    urlWatcherId: null,
    currentUrl: location.href,
    settings: {
      fontSize: 24,
      opacity: 0.9,
      speed: 140,
      density: 50,
      maxFps: 30,
      blockedKeywords: []
    },
    events: [],
    active: [],
    spawnedIds: new Set(),
    lastRenderTs: 0,
    lastVideoTime: 0,
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
  initUrlWatcher();

  async function startPiP() {
    if (STATE.running) return;
    ensureSupported();
    STATE.site = detectSite();
    const video = findVideoElement();
    if (!video) throw new Error("未找到可用视频元素，请先播放视频后重试");

    STATE.sourceVideo = video;
    STATE.settings = await loadSettings();
    STATE.events = await loadDanmakuEvents();
    STATE.spawnedIds.clear();
    STATE.active = [];
    STATE.trackCursor = 0;
    STATE.lastVideoTime = Number(video.currentTime || 0);

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
    STATE.lastRenderTs = 0;
    renderLoop(performance.now());
    log(`启动完成，site=${STATE.site} events=${STATE.events.length}`);
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

    const pipVideo = doc.createElement("video");
    pipVideo.muted = true;
    pipVideo.autoplay = true;
    pipVideo.playsInline = true;
    pipVideo.style.width = "100%";
    pipVideo.style.height = "100%";
    pipVideo.style.objectFit = "contain";
    pipVideo.srcObject = sourceVideo.captureStream();

    const canvas = doc.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
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
    canvas.width = Math.max(320, pipWindow.innerWidth);
    canvas.height = Math.max(180, pipWindow.innerHeight);
  }

  function renderLoop(now) {
    if (!STATE.running || !STATE.sourceVideo || !STATE.danmakuCanvas || !STATE.danmakuCtx) return;

    const fps = clampNumber(STATE.settings.maxFps, 15, 60, 30);
    const frameInterval = 1000 / fps;
    if (STATE.lastRenderTs && now - STATE.lastRenderTs < frameInterval) {
      STATE.rafId = requestAnimationFrame(renderLoop);
      return;
    }

    const dt = STATE.lastRenderTs ? Math.max(0.016, (now - STATE.lastRenderTs) / 1000) : 0.016;
    STATE.lastRenderTs = now;

    const current = Number(STATE.sourceVideo.currentTime || 0);
    if (current < STATE.lastVideoTime - 1.2 || Math.abs(current - STATE.lastVideoTime) > 25) {
      STATE.spawnedIds.clear();
      STATE.active = [];
    }
    STATE.lastVideoTime = current;

    spawnDueEvents(current);
    advanceActive(dt, Number(STATE.sourceVideo.playbackRate || 1));
    drawFrame();

    STATE.rafId = requestAnimationFrame(renderLoop);
  }

  function spawnDueEvents(currentTime) {
    const densityCap = clampNumber(STATE.settings.density, 20, 120, 50);
    if (STATE.active.length >= densityCap) return;

    for (let i = 0; i < STATE.events.length; i += 1) {
      const event = STATE.events[i];
      if (STATE.spawnedIds.has(event.id)) continue;
      if (event.t > currentTime + 0.1) break;
      if (event.t < currentTime - 2.0) {
        STATE.spawnedIds.add(event.id);
        continue;
      }
      if (core.isBlocked && core.isBlocked(event.text, STATE.settings.blockedKeywords)) {
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
    const fontSize = clampNumber(STATE.settings.fontSize, 14, 48, 24);
    const speed = clampNumber(STATE.settings.speed, 80, 240, 140);
    const textWidth = estimateTextWidth(event.text, fontSize);
    const trackHeight = Math.max(28, fontSize + 8);
    const trackCount = Math.max(4, Math.floor(canvas.height / trackHeight));
    const lane = STATE.trackCursor % trackCount;
    STATE.trackCursor += 1;
    const y = Math.min(canvas.height - 8, lane * trackHeight + fontSize + 2);

    if (event.mode === "top" || event.mode === "bottom") {
      return {
        ...event,
        x: Math.max(8, (canvas.width - textWidth) / 2),
        y: event.mode === "top" ? fontSize + 6 : canvas.height - 10,
        ttl: 2.4,
        speed: 0
      };
    }
    return {
      ...event,
      x: canvas.width + 20,
      y,
      ttl: 8.5,
      speed,
      textWidth
    };
  }

  function advanceActive(dt, playbackRate) {
    const out = [];
    for (const item of STATE.active) {
      const next = item;
      next.ttl -= dt;
      if (item.mode === "scroll") {
        next.x -= next.speed * dt * playbackRate;
      }
      const isVisible = next.mode === "scroll" ? next.x + (next.textWidth || 120) > -24 : true;
      if (next.ttl > 0 && isVisible) out.push(next);
    }
    STATE.active = out;
  }

  function drawFrame() {
    const canvas = STATE.danmakuCanvas;
    const ctx = STATE.danmakuCtx;
    const fontSize = clampNumber(STATE.settings.fontSize, 14, 48, 24);
    const opacity = clampNumber(STATE.settings.opacity, 0.2, 1, 0.9);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textBaseline = "alphabetic";
    ctx.globalAlpha = opacity;
    ctx.lineWidth = Math.max(2, Math.floor(fontSize / 8));
    ctx.strokeStyle = "rgba(0,0,0,0.75)";

    for (const item of STATE.active) {
      ctx.fillStyle = item.color || "#FFFFFF";
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
      if (!response?.ok) throw new Error(response?.error || "加载 B站弹幕失败");
      return core.normalizeEvents ? core.normalizeEvents(response.events, "bilibili") : response.events;
    }

    if (STATE.site === "youtube") {
      const baseUrl = await getYoutubeCaptionBaseUrl();
      if (!baseUrl) return [];
      const response = await sendRuntimeMessage({ type: "FETCH_YOUTUBE_CAPTIONS", baseUrl });
      if (!response?.ok) throw new Error(response?.error || "加载 YouTube 时间文本失败");
      return core.normalizeEvents ? core.normalizeEvents(response.events, "youtube") : response.events;
    }

    throw new Error("当前站点未支持");
  }

  async function reloadRunningSession() {
    if (!STATE.running) return;
    const newVideo = findVideoElement();
    if (!newVideo) return;
    STATE.site = detectSite();
    STATE.sourceVideo = newVideo;
    STATE.events = await loadDanmakuEvents();
    STATE.active = [];
    STATE.spawnedIds.clear();
    STATE.lastVideoTime = Number(newVideo.currentTime || 0);
    log(`已重载：site=${STATE.site}, events=${STATE.events.length}`);
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
    if (!json || !Array.isArray(json.data) || !json.data.length) return null;
    const item = json.data[Math.max(0, p - 1)] || json.data[0];
    return item ? item.cid : null;
  }

  async function getYoutubeCaptionBaseUrl() {
    const html = document.documentElement.innerHTML;
    const tracks = core.extractCaptionTracksFromHtml ? core.extractCaptionTracksFromHtml(html) : [];
    if (!tracks.length) return null;
    const preferred =
      tracks.find((track) => String(track.vssId || "").includes(".zh")) ||
      tracks.find((track) => String(track.vssId || "").includes(".en")) ||
      tracks[0];
    return preferred && preferred.baseUrl ? preferred.baseUrl : null;
  }

  function initUrlWatcher() {
    if (STATE.urlWatcherId) clearInterval(STATE.urlWatcherId);
    STATE.urlWatcherId = setInterval(() => {
      if (STATE.currentUrl === location.href) return;
      const oldUrl = STATE.currentUrl;
      STATE.currentUrl = location.href;
      if (STATE.running) {
        reloadRunningSession().catch((error) => log(`URL切换重载失败: ${safeError(error)}`));
      }
      log(`URL变化: ${oldUrl} -> ${STATE.currentUrl}`);
    }, 1000);
  }

  async function loadSettings() {
    const defaults = {
      fontSize: 24,
      opacity: 0.9,
      speed: 140,
      density: 50,
      maxFps: 30,
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
      maxFps: clampNumber(value.maxFps, 15, 60, defaults.maxFps),
      blockedKeywords: core.parseKeywordList
        ? core.parseKeywordList(value.blockedKeywords)
        : Array.isArray(value.blockedKeywords)
          ? value.blockedKeywords
          : []
    };
  }

  function initStorageWatcher() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !STATE.running) return;
      if (
        changes.fontSize ||
        changes.opacity ||
        changes.speed ||
        changes.density ||
        changes.maxFps ||
        changes.blockedKeywords ||
        changes.debug
      ) {
        loadSettings().then((settings) => {
          STATE.settings = settings;
        });
      }
    });
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

  function detectSite() {
    const host = location.hostname;
    if (host.includes("bilibili.com")) return "bilibili";
    if (host.includes("youtube.com")) return "youtube";
    return "unknown";
  }

  function findVideoElement() {
    const videos = Array.from(document.querySelectorAll("video"));
    if (!videos.length) return null;
    return videos.sort((a, b) => {
      const as = (a.videoWidth || 0) * (a.videoHeight || 0);
      const bs = (b.videoWidth || 0) * (b.videoHeight || 0);
      return bs - as;
    })[0];
  }

  function estimateTextWidth(text, fontSize) {
    return Math.max(80, String(text || "").length * Math.floor(fontSize * 0.62));
  }

  function clampNumber(raw, min, max, fallback) {
    if (core.clampNumber) return core.clampNumber(raw, min, max, fallback);
    const num = Number(raw);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, num));
  }

  function ensureSupported() {
    if (!("documentPictureInPicture" in window)) {
      throw new Error("当前浏览器不支持 Document Picture-in-Picture API，请使用 Edge/Chrome 最新版本");
    }
  }

  function safeError(error) {
    return error instanceof Error ? error.message : String(error);
  }

  function log(text) {
    if (STATE.debug) {
      console.info(`[DanmakuPiP] ${text}`);
    }
  }
})();
