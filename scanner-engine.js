
/* =========================================================
   WebScan Advanced Scanner Engine
   Auto Edge Detection + Perspective Correction
   Camera UI enhancement
   ========================================================= */

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const cameraScreen = $("cameraScreen");
  const video = $("video");
  const captureBtn = $("captureBtn");
  const fileInput = $("fileInput");

  if (!cameraScreen || !video || !captureBtn) {
    console.warn("WebScan Advanced Scanner: camera elements not found.");
    return;
  }

  cameraScreen.classList.add("ws-pro-camera");

  let cvReady = false;
  let detecting = false;
  let lastCorners = null;
  let mode = "Scan";
  let autoCrop = true;
  let detectTimer = null;

  const liveOverlay = document.createElement("div");
  liveOverlay.className = "ws-live-corners";
  liveOverlay.innerHTML = `
    <span class="ws-live-corner" data-corner="0"></span>
    <span class="ws-live-corner" data-corner="1"></span>
    <span class="ws-live-corner" data-corner="2"></span>
    <span class="ws-live-corner" data-corner="3"></span>
  `;
  cameraScreen.querySelector(".camera-view")?.appendChild(liveOverlay);

  const status = document.createElement("div");
  status.className = "ws-live-status";
  status.innerHTML = `<i></i><span>Looking for document…</span>`;
  cameraScreen.querySelector(".camera-view")?.appendChild(status);

  const flash = document.createElement("div");
  flash.className = "ws-capture-flash";
  cameraScreen.querySelector(".camera-view")?.appendChild(flash);

  const processing = document.createElement("div");
  processing.className = "ws-processing";
  processing.innerHTML = `
    <div class="ws-processing-card">
      <div class="ws-processing-spinner"></div>
      <div class="ws-processing-title">Scanning document</div>
      <div class="ws-processing-sub">Detecting edges and correcting perspective…</div>
    </div>
  `;
  cameraScreen.querySelector(".camera-view")?.appendChild(processing);

  const modeBar = document.createElement("div");
  modeBar.className = "ws-mode-bar";
  modeBar.innerHTML = `
    <button class="ws-mode" data-mode="Text">Text</button>
    <button class="ws-mode" data-mode="ID Cards">ID Cards</button>
    <button class="ws-mode" data-mode="Sign">Sign</button>
    <button class="ws-mode active" data-mode="Scan">Scan</button>
    <button class="ws-mode" data-mode="To Word">To Word</button>
    <button class="ws-mode" data-mode="Question Set">Question Set</button>
  `;
  cameraScreen.appendChild(modeBar);

  const header = cameraScreen.querySelector(".camera-header");
  const existingSettings = $("cameraSettingsBtn");

  const topActions = document.createElement("div");
  topActions.className = "ws-camera-top-actions";
  topActions.innerHTML = `
    <button type="button" class="ws-camera-top-btn" id="wsFlashTop" aria-label="Flash">⚡</button>
    <button type="button" class="ws-camera-top-btn" id="wsHdTop" aria-label="HD">HD</button>
    <button type="button" class="ws-camera-top-btn" id="wsMoreTop" aria-label="More">•••</button>
  `;

  if (header) header.appendChild(topActions);

  const sheet = document.createElement("div");
  sheet.className = "ws-mode-sheet";
  sheet.innerHTML = `
    <div class="ws-mode-sheet-title">Scan options</div>
    <div class="ws-mode-grid">
      <button class="ws-mode-option active" data-opt="auto">Auto crop</button>
      <button class="ws-mode-option" data-opt="manual">Full image</button>
      <button class="ws-mode-option" data-opt="reset">Reset frame</button>
    </div>
  `;
  cameraScreen.appendChild(sheet);

  function setStatus(text, type = "") {
    status.className = "ws-live-status " + type;
    status.querySelector("span").textContent = text;
  }

  function cvIsReady() {
    return typeof window.cv !== "undefined" &&
      !!window.cv.Mat &&
      !!window.cv.imread;
  }

  function orderPoints(points) {
    const pts = points.map(p => ({ x: p.x, y: p.y }));
    const sum = pts.map(p => p.x + p.y);
    const diff = pts.map(p => p.x - p.y);

    return [
      pts[sum.indexOf(Math.min(...sum))],   // top-left
      pts[diff.indexOf(Math.max(...diff))], // top-right
      pts[sum.indexOf(Math.max(...sum))],   // bottom-right
      pts[diff.indexOf(Math.min(...diff))]  // bottom-left
    ];
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function polygonArea(p) {
    let area = 0;
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      area += a.x * b.y - b.x * a.y;
    }
    return Math.abs(area / 2);
  }

  function findDocumentCorners(canvas) {
    if (!cvIsReady()) return null;

    let src = null, gray = null, blur = null, edges = null;
    let contours = null, hierarchy = null;

    try {
      src = cv.imread(canvas);
      const maxW = 720;

      if (src.cols > maxW) {
        const scale = maxW / src.cols;
        const resized = new cv.Mat();
        cv.resize(src, resized, new cv.Size(
          Math.round(src.cols * scale),
          Math.round(src.rows * scale)
        ));
        src.delete();
        src = resized;
      }

      gray = new cv.Mat();
      blur = new cv.Mat();
      edges = new cv.Mat();

      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
      cv.Canny(blur, edges, 60, 160);

      contours = new cv.MatVector();
      hierarchy = new cv.Mat();
      cv.findContours(
        edges,
        contours,
        hierarchy,
        cv.RETR_LIST,
        cv.CHAIN_APPROX_SIMPLE
      );

      const imageArea = src.cols * src.rows;
      let best = null;
      let bestScore = 0;

      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const peri = cv.arcLength(contour, true);
        const approx = new cv.Mat();

        cv.approxPolyDP(contour, approx, 0.025 * peri, true);

        if (approx.rows === 4 && cv.isContourConvex(approx)) {
          const area = Math.abs(cv.contourArea(approx));
          const ratio = area / imageArea;

          if (ratio > 0.10 && ratio < 0.98) {
            const pts = [];
            for (let j = 0; j < 4; j++) {
              pts.push({
                x: approx.intPtr(j, 0)[0],
                y: approx.intPtr(j, 0)[1]
              });
            }

            const ordered = orderPoints(pts);
            const areaScore = ratio;
            const rectangularity =
              Math.min(
                distance(ordered[0], ordered[1]),
                distance(ordered[1], ordered[2]),
                distance(ordered[2], ordered[3]),
                distance(ordered[3], ordered[0])
              ) > 20 ? 1 : 0.2;

            const score = areaScore * rectangularity;

            if (score > bestScore) {
              bestScore = score;
              best = ordered.map(p => ({
                x: p.x * (canvas.width / src.cols),
                y: p.y * (canvas.height / src.rows)
              }));
            }
          }
        }

        approx.delete();
        contour.delete();
      }

      return best;
    } catch (error) {
      console.warn("Document detection failed:", error);
      return null;
    } finally {
      [src, gray, blur, edges, contours, hierarchy].forEach(obj => {
        try { obj?.delete(); } catch (_) {}
      });
    }
  }

  function showCorners(corners) {
    if (!corners) {
      lastCorners = null;
      document.querySelectorAll(".ws-live-corner").forEach(el => {
        el.style.display = "none";
      });
      return;
    }

    lastCorners = corners;

    const rect = video.getBoundingClientRect();
    const vw = video.videoWidth || rect.width;
    const vh = video.videoHeight || rect.height;

    corners.forEach((p, i) => {
      const el = document.querySelector(`.ws-live-corner[data-corner="${i}"]`);
      if (!el) return;

      const x = Math.max(0, Math.min(1, p.x / vw));
      const y = Math.max(0, Math.min(1, p.y / vh));

      el.style.left = `${x * 100}%`;
      el.style.top = `${y * 100}%`;
      el.style.display = "block";
    });

    const frame = cameraScreen.querySelector(".scan-frame");
    frame?.classList.add("ws-detected");
  }

  function hideCorners() {
    document.querySelectorAll(".ws-live-corner").forEach(el => {
      el.style.display = "none";
    });
    cameraScreen.querySelector(".scan-frame")?.classList.remove("ws-detected");
  }

  function detectLive() {
    if (detecting || !video.videoWidth || video.readyState < 2) return;
    detecting = true;

    try {
      const c = document.createElement("canvas");
      const targetW = 640;
      const ratio = video.videoHeight / video.videoWidth;
      c.width = targetW;
      c.height = Math.round(targetW * ratio);
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, c.width, c.height);

      const corners = findDocumentCorners(c);

      if (corners) {
        const sx = video.videoWidth / c.width;
        const sy = video.videoHeight / c.height;
        showCorners(corners.map(p => ({ x: p.x * sx, y: p.y * sy })));
        setStatus("Document detected", "ready");
      } else {
        hideCorners();
        setStatus("Looking for document…");
      }
    } catch (e) {
      setStatus("Ready to scan");
    } finally {
      detecting = false;
    }
  }

  function startLiveDetection() {
    if (detectTimer) clearInterval(detectTimer);
    detectTimer = setInterval(detectLive, 450);
  }

  function stopLiveDetection() {
    if (detectTimer) clearInterval(detectTimer);
    detectTimer = null;
  }

  function makeCaptureCanvas() {
    const c = document.createElement("canvas");
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    const ctx = c.getContext("2d");

    // The existing app may mirror the front camera. For document mode
    // we normally use the rear camera, so no horizontal flip is applied.
    ctx.drawImage(video, 0, 0, c.width, c.height);
    return c;
  }

  function warpPerspective(sourceCanvas, corners) {
    if (!cvIsReady() || !corners || corners.length !== 4) {
      return sourceCanvas;
    }

    let src = null, dst = null, srcTri = null, dstTri = null, M = null;

    try {
      const ordered = orderPoints(corners);
      const [tl, tr, br, bl] = ordered;

      const widthA = distance(br, bl);
      const widthB = distance(tr, tl);
      const maxWidth = Math.max(1, Math.round(Math.max(widthA, widthB)));

      const heightA = distance(tr, br);
      const heightB = distance(tl, bl);
      const maxHeight = Math.max(1, Math.round(Math.max(heightA, heightB)));

      const maxOutput = 3000;
      const scale = Math.min(1, maxOutput / Math.max(maxWidth, maxHeight));
      const outW = Math.max(1, Math.round(maxWidth * scale));
      const outH = Math.max(1, Math.round(maxHeight * scale));

      src = cv.imread(sourceCanvas);

      srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        tl.x, tl.y,
        tr.x, tr.y,
        br.x, br.y,
        bl.x, bl.y
      ]);

      dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        0, 0,
        outW - 1, 0,
        outW - 1, outH - 1,
        0, outH - 1
      ]);

      M = cv.getPerspectiveTransform(srcTri, dstTri);
      dst = new cv.Mat();

      cv.warpPerspective(
        src,
        dst,
        M,
        new cv.Size(outW, outH),
        cv.INTER_LINEAR,
        cv.BORDER_REPLICATE,
        new cv.Scalar()
      );

      const out = document.createElement("canvas");
      out.width = outW;
      out.height = outH;
      cv.imshow(out, dst);
      return out;
    } catch (error) {
      console.warn("Perspective correction failed:", error);
      return sourceCanvas;
    } finally {
      [src, dst, srcTri, dstTri, M].forEach(obj => {
        try { obj?.delete(); } catch (_) {}
      });
    }
  }

  async function addProcessedImageToExistingApp(canvas) {
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob(blob => {
          if (!blob) {
            reject(new Error("Could not create scan image."));
            return;
          }

          const file = new File(
            [blob],
            `WebScan_${Date.now()}.jpg`,
            { type: "image/jpeg" }
          );

          const transfer = new DataTransfer();
          transfer.items.add(file);

          if (!fileInput) {
            reject(new Error("File input not found."));
            return;
          }

          const originalValue = fileInput.files;
          fileInput.files = transfer.files;

          // Existing script.js already listens for this event and sends
          // imported images into the normal WebScan editor pipeline.
          fileInput.dispatchEvent(new Event("change", { bubbles: true }));

          setTimeout(() => {
            try {
              fileInput.value = "";
            } catch (_) {}
            resolve();
          }, 80);
        }, "image/jpeg", 0.94);
      } catch (error) {
        reject(error);
      }
    });
  }

  async function enhancedCapture(event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    if (!video.videoWidth) {
      setStatus("Camera is not ready", "error");
      return;
    }

    processing.classList.add("show");
    flash.classList.remove("show");
    void flash.offsetWidth;
    flash.classList.add("show");

    await new Promise(r => setTimeout(r, 40));

    try {
      const raw = makeCaptureCanvas();

      let corners = lastCorners;

      // Run a fresh detection on the full-resolution capture.
      if (autoCrop && cvReady) {
        const fresh = findDocumentCorners(raw);
        if (fresh) corners = fresh;
      }

      const result = autoCrop && corners
        ? warpPerspective(raw, corners)
        : raw;

      await addProcessedImageToExistingApp(result);

      setStatus(
        autoCrop && corners
          ? "Document corrected"
          : "Scan captured",
        "ready"
      );
    } catch (error) {
      console.error(error);
      setStatus("Scan failed — try again", "error");
    } finally {
      processing.classList.remove("show");
    }
  }

  // Capture phase runs before script.js's normal click listener.
  captureBtn.addEventListener("click", enhancedCapture, true);

  document.addEventListener("click", (event) => {
    const btn = event.target.closest?.(".ws-mode");
    if (!btn) return;

    mode = btn.dataset.mode || "Scan";
    document.querySelectorAll(".ws-mode").forEach(el => {
      el.classList.toggle("active", el === btn);
    });

    setStatus(`${mode} mode`, "ready");
  });

  const topFlash = $("wsFlashTop");
  const topHd = $("wsHdTop");
  const topMore = $("wsMoreTop");

  topFlash?.addEventListener("click", async () => {
    const track = video.srcObject?.getVideoTracks?.()[0];
    const caps = track?.getCapabilities?.();

    if (caps?.torch) {
      try {
        const current = track.getSettings?.().torch || false;
        await track.applyConstraints({ advanced: [{ torch: !current }] });
        topFlash.classList.toggle("ws-active", !current);
        setStatus(!current ? "Flash on" : "Flash off", "ready");
        return;
      } catch (_) {}
    }

    setStatus("Flash is not supported by this camera", "error");
  });

  topHd?.addEventListener("click", () => {
    topHd.classList.toggle("ws-active");
    const enabled = topHd.classList.contains("ws-active");
    setStatus(enabled ? "HD mode" : "Standard quality", "ready");
  });

  topMore?.addEventListener("click", () => {
    sheet.classList.toggle("show");
  });

  sheet.addEventListener("click", (event) => {
    const option = event.target.closest?.(".ws-mode-option");
    if (!option) return;

    const value = option.dataset.opt;

    if (value === "auto") {
      autoCrop = true;
      setStatus("Auto crop enabled", "ready");
    }

    if (value === "manual") {
      autoCrop = false;
      setStatus("Full image mode", "ready");
    }

    if (value === "reset") {
      autoCrop = true;
      hideCorners();
      setStatus("Frame reset");
    }

    sheet.querySelectorAll(".ws-mode-option").forEach(el => {
      el.classList.toggle("active", el === option);
    });

    sheet.classList.remove("show");
  });

  window.addEventListener("resize", () => {
    hideCorners();
  });

  function waitForOpenCV() {
    if (cvIsReady()) {
      cvReady = true;
      setStatus("Auto scan ready", "ready");
      startLiveDetection();
      return;
    }

    setTimeout(waitForOpenCV, 250);
  }

  waitForOpenCV();

  // If the camera starts after this engine loads, detection will still
  // begin as soon as video dimensions become available.
  video.addEventListener("loadedmetadata", () => {
    setTimeout(startLiveDetection, 300);
  });

  window.addEventListener("beforeunload", stopLiveDetection);
})();
