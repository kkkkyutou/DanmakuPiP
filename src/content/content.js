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
      fontSize: 20,
      opacity: 0.9,
      speed: 140,
      density: 50,
      maxFps: 45,
      displayAreaRatio: 1,
      syncWithBili: true,
      blockedKeywords: []
    },
    events: [],
    active: [],
    spawnedIds: new Set(),
    lastRenderTs: 0,
    lastVideoTime: 0,
    trackCursor: 0,
    hiddenSourceVideo: null,
    hiddenSourceOriginalStyle: "",
    laneCount: 0,
    controlUnsubscribers: [],
    nativeTakeoverInProgress: false,
    rightHoldTimer: null,
    rightHoldActive: false,
    rightHoldPrevRate: 1,
    progressDragging: false,
    controlsHideTimer: null,
    observedVideos: new WeakSet(),
    videoObserver: null,
    forceBiliLiveDom: false,
    liveDomMode: false,
    liveDomObserver: null,
    liveDomDedup: new Map(),
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
  initPiPButtonHijack();
  initNativePiPFallbackHook();
  initVideoPiPObserver();
  initPageRequestPiPHook();

  async function startPiP(forcedVideo = null, options = {}) {
    if (STATE.running) return;
    ensureSupported();
    STATE.site = detectSite();
    const video = forcedVideo || findVideoElement();
    if (!video) throw new Error("未找到可用视频元素，请先播放视频后重试");

    STATE.sourceVideo = video;
    STATE.settings = await loadSettings();
    if (STATE.site === "bilibili" && STATE.settings.syncWithBili) {
      STATE.settings = applyBiliDanmakuSettings(STATE.settings);
    }
    STATE.forceBiliLiveDom = false;
    STATE.liveDomMode = false;
    STATE.events = await loadDanmakuEvents();
    STATE.spawnedIds.clear();
    STATE.active = [];
    STATE.trackCursor = 0;
    STATE.lastVideoTime = Number(video.currentTime || 0);

    if (STATE.forceBiliLiveDom && STATE.site === "bilibili") {
      initBiliLiveDomBridge();
      STATE.liveDomMode = true;
      log("启用 B站 DOM 实时弹幕兜底模式");
    }

    if (!STATE.events.length && !STATE.liveDomMode) {
      throw new Error("未获取到可显示内容（B站弹幕或 YouTube 时间文本）");
    }

    if (!options.skipExitNativePiP && document.pictureInPictureElement) {
      try {
        await document.exitPictureInPicture();
      } catch (_error) {
        log("退出原生PiP失败，继续尝试弹幕PiP");
      }
    }

    const pipWindow = await documentPictureInPicture.requestWindow({
      width: Math.max(480, Math.floor(video.clientWidth || 640)),
      height: Math.max(270, Math.floor(video.clientHeight || 360))
    });
    mountPiPWindow(pipWindow, video);
    STATE.pipWindow = pipWindow;
    STATE.running = true;
    hideSourceVideo(video);
    STATE.lastRenderTs = 0;
    bindVideoControlEvents();
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
    cleanupLiveDomBridge();
    cleanupVideoControlEvents();
    restoreSourceVideo();
  }

  function mountPiPWindow(pipWindow, sourceVideo) {
    const doc = pipWindow.document;
    doc.title = "DanmakuPiP";
    doc.head.innerHTML = "";
    doc.body.innerHTML = "";
    doc.body.style.margin = "0";
    doc.body.style.background = "#000";
    doc.body.style.overflow = "hidden";

    const container = doc.createElement("div");
    container.style.position = "relative";
    container.style.width = "100vw";
    container.style.height = "100vh";
    container.style.overflow = "hidden";

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

    const controls = doc.createElement("div");
    controls.style.position = "absolute";
    controls.style.left = "8px";
    controls.style.right = "8px";
    controls.style.bottom = "8px";
    controls.style.height = "68px";
    controls.style.display = "grid";
    controls.style.gridTemplateRows = "30px 30px";
    controls.style.gap = "6px";
    controls.style.padding = "6px 10px";
    controls.style.borderRadius = "9px";
    controls.style.background = "rgba(16,16,16,0.42)";
    controls.style.opacity = "0";
    controls.style.transition = "opacity 120ms ease";
    controls.style.pointerEvents = "none";
    controls.style.zIndex = "12";
    controls.style.boxSizing = "border-box";
    controls.style.fontFamily = '"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif';

    const progress = doc.createElement("input");
    progress.type = "range";
    progress.min = "0";
    progress.max = "1000";
    progress.step = "1";
    progress.value = "0";
    progress.style.flex = "1";
    progress.style.height = "18px";
    progress.style.margin = "0";
    progress.style.accentColor = "#8fd3ff";

    const timeLabel = doc.createElement("span");
    timeLabel.textContent = "00:00 / 00:00";
    timeLabel.style.color = "#fff";
    timeLabel.style.fontSize = "12px";
    timeLabel.style.minWidth = "96px";
    timeLabel.style.textAlign = "right";

    const topRow = doc.createElement("div");
    topRow.style.display = "flex";
    topRow.style.alignItems = "center";
    topRow.style.gap = "8px";

    const playPauseBtn = doc.createElement("button");
    playPauseBtn.textContent = sourceVideo.paused ? "播放" : "暂停";
    playPauseBtn.style.height = "28px";
    playPauseBtn.style.width = "76px";
    playPauseBtn.style.justifySelf = "center";
    playPauseBtn.style.borderRadius = "8px";
    playPauseBtn.style.border = "1px solid rgba(255,255,255,0.42)";
    playPauseBtn.style.background = "rgba(255,255,255,0.15)";
    playPauseBtn.style.color = "#fff";
    playPauseBtn.style.cursor = "pointer";
    playPauseBtn.style.fontWeight = "600";
    playPauseBtn.style.fontSize = "13px";

    container.appendChild(pipVideo);
    container.appendChild(canvas);
    topRow.appendChild(progress);
    topRow.appendChild(timeLabel);
    controls.appendChild(topRow);
    controls.appendChild(playPauseBtn);
    container.appendChild(controls);
    doc.body.appendChild(container);

    pipWindow.addEventListener("resize", () => resizeCanvas(canvas, pipWindow), { passive: true });
    pipWindow.addEventListener("pagehide", stopPiP, { once: true });

    resizeCanvas(canvas, pipWindow);
    STATE.pipVideo = pipVideo;
    STATE.danmakuCanvas = canvas;
    STATE.danmakuCtx = canvas.getContext("2d");

    const updateProgress = () => {
      if (STATE.progressDragging) return;
      const duration = Number(sourceVideo.duration || 0);
      const current = Number(sourceVideo.currentTime || 0);
      const ratio = duration > 0 ? Math.min(1, Math.max(0, current / duration)) : 0;
      progress.value = String(Math.round(ratio * 1000));
      timeLabel.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
    };
    updateProgress();

    const setProgressVisible = (visible) => {
      controls.style.opacity = visible ? "1" : "0";
      controls.style.pointerEvents = visible ? "auto" : "none";
    };
    const showControls = () => {
      setProgressVisible(true);
      clearControlsHideTimer();
      STATE.controlsHideTimer = setTimeout(() => {
        if (!STATE.progressDragging) setProgressVisible(false);
      }, 1500);
    };
    const hideControls = () => {
      if (!STATE.progressDragging) setProgressVisible(false);
    };

    const togglePlayPause = () => {
      if (sourceVideo.paused) {
        sourceVideo.play().catch(() => undefined);
      } else {
        sourceVideo.pause();
      }
      playPauseBtn.textContent = sourceVideo.paused ? "播放" : "暂停";
    };

    const syncPlayPauseText = () => {
      playPauseBtn.textContent = sourceVideo.paused ? "播放" : "暂停";
    };
    const onProgressDown = (event) => {
      event.stopPropagation();
      STATE.progressDragging = true;
      showControls();
    };
    const onProgressInput = (event) => {
      event.stopPropagation();
      const duration = Number(sourceVideo.duration || 0);
      if (!(duration > 0)) return;
      const ratio = clampNumber(progress.value, 0, 1000, 0) / 1000;
      sourceVideo.currentTime = duration * ratio;
    };
    const onProgressUp = () => {
      STATE.progressDragging = false;
      showControls();
    };
    const onMouseMove = () => showControls();
    const onMouseLeave = () => hideControls();
    const onPlayPauseClick = (event) => {
      event.stopPropagation();
      togglePlayPause();
      showControls();
    };

    container.addEventListener("mousemove", onMouseMove, { passive: true });
    container.addEventListener("mouseleave", onMouseLeave, { passive: true });
    progress.addEventListener("pointerdown", onProgressDown, true);
    progress.addEventListener("input", onProgressInput, true);
    progress.addEventListener("pointerup", onProgressUp, true);
    progress.addEventListener("change", onProgressUp, true);
    playPauseBtn.addEventListener("click", onPlayPauseClick, true);
    sourceVideo.addEventListener("play", syncPlayPauseText);
    sourceVideo.addEventListener("pause", syncPlayPauseText);
    sourceVideo.addEventListener("timeupdate", updateProgress);
    sourceVideo.addEventListener("durationchange", updateProgress);
    sourceVideo.addEventListener("loadedmetadata", updateProgress);

    STATE.controlUnsubscribers.push(() => container.removeEventListener("mousemove", onMouseMove));
    STATE.controlUnsubscribers.push(() => container.removeEventListener("mouseleave", onMouseLeave));
    STATE.controlUnsubscribers.push(() => progress.removeEventListener("pointerdown", onProgressDown, true));
    STATE.controlUnsubscribers.push(() => progress.removeEventListener("input", onProgressInput, true));
    STATE.controlUnsubscribers.push(() => progress.removeEventListener("pointerup", onProgressUp, true));
    STATE.controlUnsubscribers.push(() => progress.removeEventListener("change", onProgressUp, true));
    STATE.controlUnsubscribers.push(() => playPauseBtn.removeEventListener("click", onPlayPauseClick, true));
    STATE.controlUnsubscribers.push(() => sourceVideo.removeEventListener("play", syncPlayPauseText));
    STATE.controlUnsubscribers.push(() => sourceVideo.removeEventListener("pause", syncPlayPauseText));
    STATE.controlUnsubscribers.push(() => sourceVideo.removeEventListener("timeupdate", updateProgress));
    STATE.controlUnsubscribers.push(() => sourceVideo.removeEventListener("durationchange", updateProgress));
    STATE.controlUnsubscribers.push(() => sourceVideo.removeEventListener("loadedmetadata", updateProgress));
  }

  function resizeCanvas(canvas, pipWindow) {
    canvas.width = Math.max(320, pipWindow.innerWidth);
    canvas.height = Math.max(180, pipWindow.innerHeight);
    STATE.laneCount = Math.max(4, Math.floor(canvas.height / Math.max(28, STATE.settings.fontSize + 8)));
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
    if (Math.abs(current - STATE.lastVideoTime) > 1.2) {
      STATE.spawnedIds.clear();
      STATE.active = [];
    }
    STATE.lastVideoTime = current;

    const isPaused = Boolean(STATE.sourceVideo.paused);
    spawnDueEvents(current, isPaused);
    advanceActive(dt, isPaused ? 0 : Number(STATE.sourceVideo.playbackRate || 1));
    drawFrame();

    STATE.rafId = requestAnimationFrame(renderLoop);
  }

  function spawnDueEvents(currentTime, isPaused) {
    if (STATE.liveDomMode) return;
    if (isPaused) return;
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
    const textWidth = measureTextWidth(event.text, fontSize);
    const trackHeight = Math.max(28, fontSize + 8);
    const renderHeight = getRenderHeight(canvas.height);
    const trackCount = Math.max(4, Math.floor(renderHeight / trackHeight));
    const lane = chooseLane(trackCount, canvas.width);
    const y = Math.min(renderHeight - 6, lane * trackHeight + fontSize + 2);

    if (event.mode === "top" || event.mode === "bottom") {
      return {
        ...event,
        x: Math.max(8, (canvas.width - textWidth) / 2),
        y: event.mode === "top" ? fontSize + 6 : Math.max(fontSize + 10, renderHeight - 10),
        ttl: 2.4,
        speed: 0,
        textWidth,
        lane
      };
    }
    return {
      ...event,
      x: canvas.width + 20,
      y,
      ttl: 8.5,
      speed,
      textWidth,
      lane
    };
  }

  function advanceActive(dt, playbackRate) {
    const out = [];
    for (const item of STATE.active) {
      const next = item;
      if (playbackRate > 0) {
        next.ttl -= dt;
        if (item.mode === "scroll") {
          next.x -= next.speed * dt * playbackRate;
        }
      }
      const isVisible = next.mode === "scroll" ? next.x + (next.textWidth || 120) > -24 : true;
      if (next.ttl > 0 && isVisible) out.push(next);
    }
    STATE.active = out;
  }

  function drawFrame() {
    const canvas = STATE.danmakuCanvas;
    const ctx = STATE.danmakuCtx;
    const fontSize = clampNumber(STATE.settings.fontSize, 14, 42, 20);
    const opacity = clampNumber(STATE.settings.opacity, 0.2, 1, 0.9);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = `600 ${fontSize}px "Microsoft YaHei","PingFang SC","Helvetica Neue",Arial,sans-serif`;
    ctx.textBaseline = "alphabetic";
    ctx.globalAlpha = opacity;
    ctx.lineWidth = Math.max(1.5, Math.floor(fontSize / 10));
    ctx.strokeStyle = "rgba(0,0,0,0.62)";
    ctx.shadowColor = "rgba(0,0,0,0.3)";
    ctx.shadowBlur = Math.max(1, Math.floor(fontSize / 10));

    for (const item of STATE.active) {
      ctx.fillStyle = item.color || "#FFFFFF";
      ctx.strokeText(item.text, item.x, item.y);
      ctx.fillText(item.text, item.x, item.y);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  async function loadDanmakuEvents() {
    if (STATE.site === "bilibili") {
      const cid = await getBilibiliCid();
      if (!cid) return [];
      const response = await sendRuntimeMessage({ type: "FETCH_BILIBILI_DANMAKU", cid });
      if (response?.ok) {
        return core.normalizeEvents ? core.normalizeEvents(response.events, "bilibili") : response.events;
      }
      const errorText = String(response?.error || "");
      if (!errorText.includes("412")) {
        throw new Error(response?.error || "加载 B站弹幕失败");
      }
      try {
        const xmlText = await fetchBilibiliDanmakuXmlFromContent(cid);
        const events = parseBilibiliDanmakuXml(xmlText);
        return core.normalizeEvents ? core.normalizeEvents(events, "bilibili") : events;
      } catch (contentError) {
        log(`内容脚本兜底失败: ${safeError(contentError)}`);
      }
      try {
        const xmlText = await fetchBilibiliDanmakuXmlFromPage(cid);
        const events = parseBilibiliDanmakuXml(xmlText);
        return core.normalizeEvents ? core.normalizeEvents(events, "bilibili") : events;
      } catch (pageError) {
        STATE.forceBiliLiveDom = true;
        log(`B站弹幕接口全失败，将切 DOM 实时模式: ${safeError(pageError)}`);
        return [];
      }
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
    restoreSourceVideo();
    STATE.site = detectSite();
    STATE.sourceVideo = newVideo;
    STATE.events = await loadDanmakuEvents();
    STATE.active = [];
    STATE.spawnedIds.clear();
    STATE.lastVideoTime = Number(newVideo.currentTime || 0);
    hideSourceVideo(newVideo);
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

  function initPiPButtonHijack() {
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (!matchesPiPButton(target)) return;
        if (STATE.running) return;
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === "function") {
          event.stopImmediatePropagation();
        }
        const video = findVideoElement();
        STATE.nativeTakeoverInProgress = true;
        startPiP(video, { skipExitNativePiP: true }).catch((error) => {
          log(`点击PiP按钮接管失败: ${safeError(error)}`);
        }).finally(() => {
          STATE.nativeTakeoverInProgress = false;
        });
      },
      true
    );
  }

  function initNativePiPFallbackHook() {
    // keep for compatibility; actual robust hook is bound per-video in initVideoPiPObserver.
  }

  function initVideoPiPObserver() {
    const attach = (video) => {
      if (!(video instanceof HTMLVideoElement)) return;
      if (STATE.observedVideos.has(video)) return;
      STATE.observedVideos.add(video);
      video.addEventListener(
        "enterpictureinpicture",
        () => {
          if (STATE.running || STATE.nativeTakeoverInProgress) return;
          STATE.nativeTakeoverInProgress = true;
          startPiP(video, { skipExitNativePiP: true })
            .then(async () => {
              if (document.pictureInPictureElement) {
                try {
                  await document.exitPictureInPicture();
                } catch (_error) {
                  // ignore
                }
              }
            })
            .catch((error) => {
              log(`视频级PiP接管失败: ${safeError(error)}`);
            })
            .finally(() => {
              STATE.nativeTakeoverInProgress = false;
            });
        },
        true
      );
    };
    document.querySelectorAll("video").forEach(attach);
    if (STATE.videoObserver) STATE.videoObserver.disconnect();
    STATE.videoObserver = new MutationObserver(() => {
      document.querySelectorAll("video").forEach(attach);
    });
    STATE.videoObserver.observe(document.documentElement || document.body, {
      subtree: true,
      childList: true
    });
  }

  function initPageRequestPiPHook() {
    const eventName = "DanmakuPiP:NativeRequestPiP";
    window.addEventListener(
      eventName,
      (event) => {
        if (STATE.running || STATE.nativeTakeoverInProgress) return;
        const detail = event.detail || {};
        const id = detail.id ? String(detail.id) : "";
        let video = null;
        if (id) {
          video = document.querySelector(`video[data-dmp-hook-id="${escapeAttrValue(id)}"]`);
        }
        if (!(video instanceof HTMLVideoElement)) {
          video = findVideoElement();
        }
        if (!(video instanceof HTMLVideoElement)) return;
        event.preventDefault();
        STATE.nativeTakeoverInProgress = true;
        startPiP(video, { skipExitNativePiP: true })
          .catch((error) => {
            log(`页面requestPiP接管失败: ${safeError(error)}`);
          })
          .finally(() => {
            STATE.nativeTakeoverInProgress = false;
          });
      },
      true
    );

    const script = document.createElement("script");
    script.textContent = `
      (function () {
        if (window.__danmakuPiPHooked) return;
        window.__danmakuPiPHooked = true;
        const eventName = ${JSON.stringify(eventName)};
        const proto = HTMLVideoElement && HTMLVideoElement.prototype;
        if (!proto) return;
        const original = proto.requestPictureInPicture;
        if (typeof original !== "function") return;
        let seq = 0;
        proto.requestPictureInPicture = function patchedRequestPiP() {
          let id = this.getAttribute("data-dmp-hook-id");
          if (!id) {
            id = "dmp_" + Date.now() + "_" + (++seq);
            this.setAttribute("data-dmp-hook-id", id);
          }
          const evt = new CustomEvent(eventName, {
            bubbles: true,
            cancelable: true,
            detail: { id: id }
          });
          window.dispatchEvent(evt);
          if (evt.defaultPrevented) {
            return Promise.resolve(null);
          }
          return original.call(this);
        };
      })();
    `;
    (document.documentElement || document.head || document.body).appendChild(script);
    script.remove();
  }

  function initBiliLiveDomBridge() {
    cleanupLiveDomBridge();
    const root = findBiliDanmakuRoot() || document.body;
    if (!root) return;
    STATE.liveDomDedup.clear();
    STATE.liveDomObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          collectDanmakuFromNode(node);
        }
      }
    });
    STATE.liveDomObserver.observe(root, { subtree: true, childList: true });
  }

  function cleanupLiveDomBridge() {
    if (STATE.liveDomObserver) {
      try {
        STATE.liveDomObserver.disconnect();
      } catch (_error) {
        // ignore
      }
      STATE.liveDomObserver = null;
    }
    STATE.liveDomDedup.clear();
    STATE.liveDomMode = false;
  }

  function findBiliDanmakuRoot() {
    const candidates = [
      ".bpx-player-dm-wrap",
      ".bilibili-player-video-danmaku",
      ".bpx-player-row-dm-wrap",
      ".bilibili-player-danmaku",
      "[class*='dm-wrap']"
    ];
    for (const selector of candidates) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function collectDanmakuFromNode(node) {
    if (!node || !STATE.running || !STATE.sourceVideo) return;
    if (isLikelyDanmakuNode(node)) {
      pushLiveDomDanmaku(node);
    }
    const descendants = node.querySelectorAll
      ? node.querySelectorAll(".bili-dm,[class*='dm'],[class*='danmaku']")
      : [];
    descendants.forEach((el) => {
      if (el instanceof HTMLElement && isLikelyDanmakuNode(el)) {
        pushLiveDomDanmaku(el);
      }
    });
  }

  function isLikelyDanmakuNode(el) {
    const text = (el.textContent || "").trim();
    if (!text || text.length > 80) return false;
    const cls = (el.className && String(el.className).toLowerCase()) || "";
    if (cls.includes("dm") || cls.includes("danmaku")) return true;
    const style = window.getComputedStyle(el);
    return style.position === "absolute" && style.pointerEvents === "none";
  }

  function pushLiveDomDanmaku(el) {
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!text) return;
    const now = Date.now();
    const key = text;
    const prev = STATE.liveDomDedup.get(key) || 0;
    if (now - prev < 700) return;
    STATE.liveDomDedup.set(key, now);
    if (STATE.liveDomDedup.size > 300) {
      for (const [k, t] of STATE.liveDomDedup) {
        if (now - t > 30000) STATE.liveDomDedup.delete(k);
      }
    }
    const color = rgbaToHex(window.getComputedStyle(el).color) || "#FFFFFF";
    const event = {
      id: `live-${now}-${Math.random().toString(36).slice(2, 8)}`,
      source: "bilibili",
      mode: "scroll",
      color,
      text
    };
    const densityCap = clampNumber(STATE.settings.density, 20, 120, 50);
    if (STATE.active.length >= densityCap) return;
    STATE.active.push(createActiveDanmaku(event));
  }

  function rgbaToHex(color) {
    if (!color) return null;
    const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!m) return null;
    const r = Number(m[1]).toString(16).padStart(2, "0");
    const g = Number(m[2]).toString(16).padStart(2, "0");
    const b = Number(m[3]).toString(16).padStart(2, "0");
    return `#${r}${g}${b}`.toUpperCase();
  }

  async function loadSettings() {
    const defaults = {
      fontSize: 20,
      opacity: 0.9,
      speed: 140,
      density: 50,
      maxFps: 45,
      displayAreaRatio: 1,
      syncWithBili: true,
      blockedKeywords: [],
      debug: false
    };
    const value = await chrome.storage.local.get(defaults);
    STATE.debug = Boolean(value.debug);
    return {
      fontSize: clampNumber(value.fontSize, 14, 42, defaults.fontSize),
      opacity: clampNumber(value.opacity, 0.2, 1, defaults.opacity),
      speed: clampNumber(value.speed, 80, 240, defaults.speed),
      density: clampNumber(value.density, 20, 120, defaults.density),
      maxFps: clampNumber(value.maxFps, 15, 60, defaults.maxFps),
      displayAreaRatio: clampNumber(value.displayAreaRatio, 0.25, 1, defaults.displayAreaRatio),
      syncWithBili: Boolean(value.syncWithBili),
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
        changes.displayAreaRatio ||
        changes.syncWithBili ||
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

  function measureTextWidth(text, fontSize) {
    const ctx = STATE.danmakuCtx;
    if (!ctx) return estimateTextWidth(text, fontSize);
    ctx.save();
    ctx.font = `600 ${fontSize}px "Microsoft YaHei","PingFang SC","Helvetica Neue",Arial,sans-serif`;
    const width = Math.ceil(ctx.measureText(String(text || "")).width);
    ctx.restore();
    return Math.max(80, width);
  }

  function chooseLane(trackCount, canvasWidth) {
    const laneRightEdges = Array(trackCount).fill(-Infinity);
    for (const item of STATE.active) {
      if (item.mode !== "scroll") continue;
      const lane = Number(item.lane || 0);
      const right = item.x + (item.textWidth || 120);
      laneRightEdges[lane] = Math.max(laneRightEdges[lane], right);
    }
    const preferredThreshold = canvasWidth * 0.7;
    let bestLane = 0;
    let bestEdge = Number.POSITIVE_INFINITY;
    for (let lane = 0; lane < trackCount; lane += 1) {
      const edge = laneRightEdges[lane];
      if (edge < preferredThreshold) {
        return lane;
      }
      if (edge < bestEdge) {
        bestEdge = edge;
        bestLane = lane;
      }
    }
    return bestLane;
  }

  function getRenderHeight(canvasHeight) {
    const ratio = clampNumber(STATE.settings.displayAreaRatio, 0.25, 1, 1);
    return Math.max(80, Math.floor(canvasHeight * ratio));
  }

  function applyBiliDanmakuSettings(base) {
    const merged = { ...base };
    const candidates = [
      "bilibili_player_settings",
      "bili_player_settings",
      "biliplayer_settings",
      "bpx_player_profile",
      "bilibili_player"
    ];
    const objects = [];
    for (const key of candidates) {
      const raw = safeReadLocalStorage(key);
      if (!raw) continue;
      try {
        objects.push(JSON.parse(raw));
      } catch (_error) {
        // ignore
      }
    }
    const found = {
      opacity: findNumberByKeys(objects, ["opacity", "danmakuOpacity", "dmOpacity", "danmuOpacity"]),
      fontSize: findNumberByKeys(objects, ["fontSize", "fontsize", "dmFontSize", "danmakuFontSize"]),
      speed: findNumberByKeys(objects, ["speed", "danmakuSpeed", "dmSpeed", "danmuSpeed"]),
      area: findNumberByKeys(objects, ["area", "danmakuArea", "dmArea", "showArea", "danmuArea"])
    };

    if (Number.isFinite(found.opacity)) {
      merged.opacity = normalizeOpacity(found.opacity, merged.opacity);
    }
    if (Number.isFinite(found.fontSize)) {
      merged.fontSize = normalizeFontSize(found.fontSize, merged.fontSize);
    }
    if (Number.isFinite(found.speed)) {
      merged.speed = normalizeSpeed(found.speed, merged.speed);
    }
    if (Number.isFinite(found.area)) {
      merged.displayAreaRatio = normalizeArea(found.area, merged.displayAreaRatio);
    }
    return merged;
  }

  function safeReadLocalStorage(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (_error) {
      return null;
    }
  }

  function findNumberByKeys(objects, keys) {
    for (const obj of objects) {
      const value = findValueRecursive(obj, keys, 0);
      if (Number.isFinite(value)) return value;
    }
    return NaN;
  }

  function findValueRecursive(node, keys, depth) {
    if (depth > 7 || !node || typeof node !== "object") return NaN;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(node, key)) {
        const num = Number(node[key]);
        if (Number.isFinite(num)) return num;
      }
    }
    for (const v of Object.values(node)) {
      const num = findValueRecursive(v, keys, depth + 1);
      if (Number.isFinite(num)) return num;
    }
    return NaN;
  }

  function normalizeOpacity(v, fallback) {
    if (!Number.isFinite(v)) return fallback;
    if (v > 1 && v <= 100) return clampNumber(v / 100, 0.2, 1, fallback);
    return clampNumber(v, 0.2, 1, fallback);
  }

  function normalizeFontSize(v, fallback) {
    if (!Number.isFinite(v)) return fallback;
    if (v > 0 && v <= 3) return clampNumber(20 * v, 14, 42, fallback);
    if (v > 3 && v <= 100) return clampNumber(v, 14, 42, fallback);
    return fallback;
  }

  function normalizeSpeed(v, fallback) {
    if (!Number.isFinite(v)) return fallback;
    if (v > 0 && v <= 3) return clampNumber(140 * v, 80, 240, fallback);
    if (v >= 0 && v <= 100) return clampNumber(80 + v * 1.6, 80, 240, fallback);
    return clampNumber(v, 80, 240, fallback);
  }

  function normalizeArea(v, fallback) {
    if (!Number.isFinite(v)) return fallback;
    if (v > 0 && v <= 1) return clampNumber(v, 0.25, 1, fallback);
    if (v > 1 && v <= 100) return clampNumber(v / 100, 0.25, 1, fallback);
    return fallback;
  }

  function hideSourceVideo(video) {
    if (!(video instanceof HTMLVideoElement)) return;
    if (STATE.hiddenSourceVideo === video) return;
    restoreSourceVideo();
    STATE.hiddenSourceVideo = video;
    STATE.hiddenSourceOriginalStyle = video.getAttribute("style") || "";
    video.style.visibility = "hidden";
    video.style.pointerEvents = "none";
  }

  function restoreSourceVideo() {
    const video = STATE.hiddenSourceVideo;
    if (!video) return;
    if (STATE.hiddenSourceOriginalStyle) {
      video.setAttribute("style", STATE.hiddenSourceOriginalStyle);
    } else {
      video.removeAttribute("style");
    }
    STATE.hiddenSourceVideo = null;
    STATE.hiddenSourceOriginalStyle = "";
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

  function bindVideoControlEvents() {
    if (!STATE.sourceVideo) return;
    const sync = () => {
      if (!STATE.running) return;
      if (Math.abs(Number(STATE.sourceVideo.currentTime || 0) - STATE.lastVideoTime) > 1.2) {
        STATE.spawnedIds.clear();
        STATE.active = [];
      }
    };
    STATE.sourceVideo.addEventListener("seeked", sync);
    STATE.controlUnsubscribers.push(() => STATE.sourceVideo.removeEventListener("seeked", sync));

    const keyState = { rightPressed: false };

    const onKeyDown = (event) => {
      if (!STATE.running || !STATE.sourceVideo) return;
      if (event.code === "Space") {
        event.preventDefault();
        if (STATE.sourceVideo.paused) {
          STATE.sourceVideo.play().catch(() => undefined);
        } else {
          STATE.sourceVideo.pause();
        }
        return;
      }
      if (event.code === "ArrowLeft") {
        event.preventDefault();
        if (event.repeat) return;
        STATE.sourceVideo.currentTime = Math.max(0, Number(STATE.sourceVideo.currentTime || 0) - 5);
        return;
      }
      if (event.code === "ArrowRight") {
        event.preventDefault();
        if (event.repeat || keyState.rightPressed) return;
        keyState.rightPressed = true;
        clearRightHoldTimer();
        STATE.rightHoldTimer = setTimeout(() => {
          if (!keyState.rightPressed || !STATE.sourceVideo) return;
          STATE.rightHoldActive = true;
          STATE.rightHoldPrevRate = Number(STATE.sourceVideo.playbackRate || 1);
          STATE.sourceVideo.playbackRate = 3;
        }, 240);
      }
    };

    const onKeyUp = (event) => {
      if (!STATE.running || !STATE.sourceVideo) return;
      if (event.code !== "ArrowRight") return;
      event.preventDefault();
      keyState.rightPressed = false;
      const activated = STATE.rightHoldActive;
      clearRightHoldTimer();
      if (activated) {
        STATE.sourceVideo.playbackRate = clampNumber(STATE.rightHoldPrevRate, 0.5, 4, 1);
      } else {
        const max = Number.isFinite(STATE.sourceVideo.duration)
          ? STATE.sourceVideo.duration
          : Number(STATE.sourceVideo.currentTime || 0) + 5;
        STATE.sourceVideo.currentTime = Math.min(max, Number(STATE.sourceVideo.currentTime || 0) + 5);
      }
      STATE.rightHoldActive = false;
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    STATE.controlUnsubscribers.push(() => window.removeEventListener("keydown", onKeyDown, true));
    STATE.controlUnsubscribers.push(() => window.removeEventListener("keyup", onKeyUp, true));
    if (STATE.pipWindow) {
      STATE.pipWindow.addEventListener("keydown", onKeyDown, true);
      STATE.pipWindow.addEventListener("keyup", onKeyUp, true);
      STATE.controlUnsubscribers.push(() => STATE.pipWindow.removeEventListener("keydown", onKeyDown, true));
      STATE.controlUnsubscribers.push(() => STATE.pipWindow.removeEventListener("keyup", onKeyUp, true));
      try {
        STATE.pipWindow.focus();
      } catch (_error) {
        // ignore
      }
    }
  }

  function cleanupVideoControlEvents() {
    clearRightHoldTimer();
    clearControlsHideTimer();
    STATE.rightHoldActive = false;
    STATE.progressDragging = false;
    STATE.controlUnsubscribers.forEach((fn) => {
      try {
        fn();
      } catch (_error) {
        // ignore
      }
    });
    STATE.controlUnsubscribers = [];
  }

  function clearRightHoldTimer() {
    if (STATE.rightHoldTimer) {
      clearTimeout(STATE.rightHoldTimer);
      STATE.rightHoldTimer = null;
    }
  }

  function clearControlsHideTimer() {
    if (STATE.controlsHideTimer) {
      clearTimeout(STATE.controlsHideTimer);
      STATE.controlsHideTimer = null;
    }
  }

  async function fetchBilibiliDanmakuXmlFromPage(cid) {
    const requestId = `dmp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const eventName = `DanmakuPiP:DMXML:${requestId}`;
    const legacyUrl = `https://comment.bilibili.com/${encodeURIComponent(String(cid))}.xml`;
    const apiUrl = `https://api.bilibili.com/x/v1/dm/list.so?oid=${encodeURIComponent(String(cid))}`;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        window.removeEventListener(eventName, onResult);
      };
      const onResult = (event) => {
        cleanup();
        const detail = event.detail || {};
        if (!detail.ok) {
          reject(new Error(`页面上下文获取 B站弹幕失败: ${detail.status || "unknown"}`));
          return;
        }
        resolve(String(detail.text || ""));
      };
      window.addEventListener(eventName, onResult, { once: true });
      const script = document.createElement("script");
      script.textContent = `
        (async function () {
          try {
            let res = await fetch(${JSON.stringify(legacyUrl)}, { credentials: "include" });
            let text = await res.text();
            if (!res.ok) {
              res = await fetch(${JSON.stringify(apiUrl)}, { credentials: "include" });
              text = await res.text();
            }
            window.dispatchEvent(new CustomEvent(${JSON.stringify(eventName)}, {
              detail: { ok: res.ok, status: res.status, text: text }
            }));
          } catch (e) {
            window.dispatchEvent(new CustomEvent(${JSON.stringify(eventName)}, {
              detail: { ok: false, status: "network", text: "", error: String(e) }
            }));
          }
        })();
      `;
      (document.documentElement || document.head || document.body).appendChild(script);
      script.remove();
      setTimeout(() => {
        cleanup();
        reject(new Error("页面上下文获取 B站弹幕超时（可能被站点策略拦截）"));
      }, 8000);
    });
  }

  async function fetchBilibiliDanmakuXmlFromContent(cid) {
    const legacyUrl = `https://comment.bilibili.com/${encodeURIComponent(String(cid))}.xml`;
    const legacyRes = await fetch(legacyUrl, {
      credentials: "include",
      headers: {
        Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8"
      }
    });
    if (legacyRes.ok) return legacyRes.text();

    const url = `https://api.bilibili.com/x/v1/dm/list.so?oid=${encodeURIComponent(String(cid))}`;
    const res = await fetch(url, {
      credentials: "include",
      headers: {
        Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8"
      }
    });
    if (!res.ok) {
      throw new Error(`内容脚本获取 B站弹幕失败: legacy=${legacyRes.status}, api=${res.status}`);
    }
    return res.text();
  }

  function parseBilibiliDanmakuXml(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, "text/xml");
    const dNodes = Array.from(doc.querySelectorAll("d"));
    return dNodes
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
          id: `bili-page-${index}`,
          source: "bilibili",
          t,
          mode: modeNum === 5 ? "top" : modeNum === 4 ? "bottom" : "scroll",
          color,
          text
        };
      })
      .filter(Boolean);
  }

  function formatTime(totalSec) {
    const sec = Math.max(0, Math.floor(Number(totalSec || 0)));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function escapeAttrValue(text) {
    return String(text).replace(/"/g, '\\"');
  }

  function matchesPiPButton(target) {
    const button = target.closest("button, [role='button'], .bpx-player-ctrl-pip, .ytp-pip-button");
    if (!button) return false;
    const text = [
      button.getAttribute("aria-label"),
      button.getAttribute("title"),
      button.getAttribute("data-tooltip-title"),
      button.textContent
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const cls = (button.className && String(button.className).toLowerCase()) || "";
    if (cls.includes("ytp-pip-button") || cls.includes("ctrl-pip")) return true;
    return text.includes("画中画") || text.includes("picture-in-picture") || text.includes("picture in picture") || text === "pip";
  }
})();
