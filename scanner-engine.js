
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

  /*
    Reads a message from the shared wording module.

    The fallback keeps the scanner working if messages.js fails to load,
    rather than showing "undefined" over the camera preview.
  */
  function msg(key, fallback) {
    return window.WebScanMessages?.SCAN?.[key] || fallback;
  }

  function progressMsg(key, fallback) {
    return window.WebScanMessages?.PROGRESS?.[key] || fallback;
  }

  function noticeMsg(key, fallback) {
    return window.WebScanMessages?.NOTICE?.[key] || fallback;
  }

  /*
    Updates the overlay shown while a capture is being processed.
    Naming the current stage makes a multi-second wait feel accounted
    for instead of looking like the app has hung.
  */
  function setProgress(title, detail) {
    const titleEl = document.getElementById("wsProcessingTitle");
    const subEl = document.getElementById("wsProcessingSub");

    if (titleEl && title) titleEl.textContent = title;
    if (subEl && detail) subEl.textContent = detail;
  }

  let cvReady = false;
  let detecting = false;
  let lastCorners = null;
  let mode = "Scan";
  let autoCrop = true;
  let detectTimer = null;
  let stableSince = null;
  let autoCapturing = false;

  const AUTO_CAPTURE_HOLD_MS = 900;

  // Temporal smoothing state. Detection runs per frame and is noisy, so
  // results are filtered over time before anything reaches the screen.
  let smoothedCorners = null;
  let missStreak = 0;

  // Latest quality reading and whether every capture condition is met.
  let lastQuality = null;
  let captureReady = false;

  /* =========================================================
     PERFORMANCE

     Detection is the most expensive thing the app does per
     frame. It is moved to a worker where possible, and its
     cadence adapts to how long frames actually take, so a slow
     phone simply detects less often instead of stuttering.
     ========================================================= */

  let worker = null;
  let workerReady = false;
  let frameId = 0;
  let pendingFrame = null;

  // Region of the video the last detection frame was taken from.
  let lastSourceRect = null;

  // Reused across frames to avoid per-frame canvas allocation.
  const previewCanvas = document.createElement("canvas");
  const previewCtx = previewCanvas.getContext(
    "2d",
    { willReadFrequently: true }
  );

  /*
    Preview width used for detection.

    Smaller frames are dramatically cheaper (cost scales with pixel
    count) while still resolving page edges. This starts moderate and
    drops on devices that prove slow.
  */
  let detectionWidth = 640;

  // Rolling average of recent frame cost, in milliseconds.
  let averageCost = 0;

  let detectInterval = 450;

  const MIN_INTERVAL = 250;
  const MAX_INTERVAL = 1200;

  function recordFrameCost(elapsed) {
    if (!Number.isFinite(elapsed) || elapsed <= 0) return;

    // Exponential moving average: reacts quickly without being jumpy.
    averageCost = averageCost
      ? averageCost * 0.7 + elapsed * 0.3
      : elapsed;

    adaptPacing();
  }

  /*
    Keeps detection using roughly half the available time, so the device
    always has room for rendering and touch input. Without this a slow
    phone would spend every millisecond detecting and feel frozen.
  */
  function adaptPacing() {
    const target = Math.round(averageCost * 2);

    const next = Math.max(
      MIN_INTERVAL,
      Math.min(MAX_INTERVAL, target)
    );

    if (Math.abs(next - detectInterval) < 60) return;

    detectInterval = next;

    // Drop resolution when even a relaxed cadence cannot keep up; this
    // is the difference between a usable and an unusable low-end device.
    if (averageCost > 260 && detectionWidth > 400) {
      detectionWidth = 480;
    } else if (averageCost < 70 && detectionWidth < 640) {
      detectionWidth = 640;
    }

    if (detectTimer) {
      clearInterval(detectTimer);
      detectTimer = setInterval(detectLive, detectInterval);
    }
  }

  function setupWorker() {
    if (typeof Worker === "undefined") return;

    try {
      worker = new Worker("detect-worker.js");
    } catch (error) {
      console.warn("Detection worker unavailable:", error);
      worker = null;
      return;
    }

    worker.onmessage = (event) => {
      const data = event.data;

      if (data.type === "ready") {
        workerReady = true;
        cvReady = true;
        setStatus("Auto scan ready", "ready");
        startLiveDetection();
        return;
      }

      if (data.type === "failed") {
        // Fall back to the main-thread path rather than losing detection.
        console.warn("Worker OpenCV failed:", data.message);
        worker.terminate();
        worker = null;
        workerReady = false;
        waitForOpenCV();
        return;
      }

      if (data.type === "result") {
        const frame = pendingFrame;
        pendingFrame = null;
        detecting = false;

        recordFrameCost(data.elapsed);

        if (frame) {
          handleDetection(
            data.corners,
            data.quality,
            frame.width,
            frame.height
          );
        }
      }
    };

    worker.onerror = (error) => {
      console.warn("Detection worker error:", error.message);
      worker = null;
      workerReady = false;
      detecting = false;
      waitForOpenCV();
    };
  }

  // Weight of each new measurement. Lower is steadier but slower.
  const SMOOTHING = 0.35;

  // Frames a document may go undetected before the overlay is cleared.
  // Prevents flicker when one frame fails during small hand movements.
  const MAX_MISSES = 3;

  // Fraction of the frame width a corner may jump between updates before
  // the tracker treats it as a different document and snaps to it.
  const SNAP_DISTANCE_RATIO = 0.25;

  /* =========================================================
     FRAME QUALITY ANALYSIS
     Real pixel measurements taken from the live preview. These gate
     auto capture and drive the on-screen guidance messages.
     ========================================================= */

  // Laplacian variance below this means the frame is too soft to read.
  const BLUR_VARIANCE_MIN = 55;

  // Mean luminance bounds (0-255) for a usable exposure.
  const DARK_MEAN_MAX = 55;
  const BRIGHT_MEAN_MIN = 225;

  // Share of near-white pixels that indicates blown-out glare.
  const GLARE_RATIO_MAX = 0.16;

  // Document must fill at least this fraction of the frame.
  const MIN_DOC_AREA_RATIO = 0.16;

  // Corner may not sit closer than this fraction of the frame to an edge.
  const EDGE_MARGIN_RATIO = 0.012;

  /*
    Maximum tolerated deviation from a right angle before the shot is
    considered too skewed to correct cleanly.

    Rotation does not affect this: a rotated page still has 90° corners.
    It only rejects keystoning from shooting at a steep angle, where
    warping would visibly stretch the far edge of the text.
  */
  const MAX_TILT_DEGREES = 25;


  /* ---------------------------------------------------------
     SCAN MODE PROFILES

     A mode is a set of geometry rules, not a label. Each profile
     says what shape the mode is looking for and what shape it
     should produce, and the detection, scoring and warping steps
     all read from the same profile so they cannot disagree.
     --------------------------------------------------------- */

  /*
    ISO/IEC 7810 ID-1: 85.60 x 53.98 mm. Driving licences, national
    ID cards, credit and insurance cards all use it, so a single
    ratio covers the overwhelming majority of what people scan in
    this mode.
  */
  const ID_CARD_RATIO = 85.6 / 53.98;   // ~1.586

  /*
    How far a detected quad's ratio may sit from the card ratio and
    still be snapped to it.

    This has to clear ordinary perspective on a real card without
    swallowing other paper sizes. A4 is the binding constraint: it
    measures 1.414, only 0.17 away from the card's 1.586, and pulling
    an A4 page into card proportions would badly distort a document
    someone scanned while the mode happened to be on.

    0.13 sits below that gap while still accepting a card tilted far
    enough to measure ~1.46-1.72. Anything outside is left at its
    measured ratio rather than being reshaped into a card it is not.
  */
  const ID_CARD_RATIO_TOLERANCE = 0.13;

  const SCAN_MODES = {

    Scan: {
      // Faithful reproduction: whatever shape was detected is kept.
      targetRatio: null,

      // Gate for "move closer" guidance.
      minAreaRatio: MIN_DOC_AREA_RATIO,

      // Floor below which detection will not even consider a shape.
      minScoreAreaRatio: 0.08,

      guide: null,
    },

    "ID Card": {
      /*
        Cards are small objects held close, so they occupy far less of
        the frame than a sheet of paper. Reusing the page thresholds
        here would reject a perfectly framed card as "too far away".

        The two floors differ on purpose: detection considers shapes
        well below the size at which the user is told to move closer,
        so the card is tracked and outlined as they bring it in rather
        than snapping into existence at the threshold.
      */
      targetRatio: ID_CARD_RATIO,
      minAreaRatio: 0.07,
      minScoreAreaRatio: 0.025,
      guide: ID_CARD_RATIO,
    },
  };

  function modeProfile(name = mode) {
    return SCAN_MODES[name] || SCAN_MODES.Scan;
  }

  /*
    Chooses the output shape for a corrected scan.

    Perspective correction has to pick an output size. Measuring it
    from the detected corners is right for paper, but for a card it
    bakes in whatever foreshortening the camera angle introduced --
    a licence shot from slightly above comes out visibly squashed.

    In ID Card mode the measured ratio is replaced by the real card
    ratio when it is close enough to be that card, so the result has
    true proportions instead of the ones the lens happened to see.
    The longer measured edge is preserved so no detail is lost.
  */
  function resolveOutputSize(width, height, profile = modeProfile()) {
    const target = profile?.targetRatio;

    if (!target || width <= 0 || height <= 0) {
      return { width, height, snapped: false };
    }

    // Cards are scanned in either orientation; match whichever the
    // user actually held rather than forcing landscape.
    const portrait = height > width;
    const measured = portrait ? height / width : width / height;

    if (Math.abs(measured - target) > ID_CARD_RATIO_TOLERANCE) {
      return { width, height, snapped: false };
    }

    // Keep the longer side; derive the shorter one from the true ratio.
    if (portrait) {
      return {
        width: Math.max(1, Math.round(height / target)),
        height,
        snapped: true,
      };
    }

    return {
      width,
      height: Math.max(1, Math.round(width / target)),
      snapped: true,
    };
  }

  /*
    Measures sharpness and exposure on the grayscale preview.
    Returns null when OpenCV cannot run, so callers fall back to
    allowing capture rather than blocking the user.
  */
  function analyseFrameQuality(gray) {
    let laplacian = null, mean = null, stddev = null;

    try {
      laplacian = new cv.Mat();
      cv.Laplacian(gray, laplacian, cv.CV_64F);

      mean = new cv.Mat();
      stddev = new cv.Mat();
      cv.meanStdDev(laplacian, mean, stddev);

      // Variance of the Laplacian is the standard sharpness estimator:
      // a blurred image has little high-frequency energy.
      const sd = stddev.doubleAt(0, 0);
      const sharpness = sd * sd;

      const brightness = cv.mean(gray)[0];

      // Count near-white pixels to spot specular glare/reflections.
      const glareMask = new cv.Mat();
      let glareRatio = 0;

      try {
        /*
          Glare means blown-out highlights, not bright paper.

          A threshold of 245 counted the page itself: a plain white sheet
          measured 40% "glare" and was permanently blocked from auto
          capture. Real specular highlights clip essentially to white, so
          the test is raised to near-saturation where paper does not
          reach but a reflection does.
        */
        cv.threshold(gray, glareMask, 252, 255, cv.THRESH_BINARY);
        glareRatio = cv.countNonZero(glareMask) / (gray.rows * gray.cols);
      } finally {
        glareMask.delete();
      }

      return { sharpness, brightness, glareRatio };
    } catch (error) {
      console.warn("Quality analysis failed:", error);
      return null;
    } finally {
      [laplacian, mean, stddev].forEach(m => {
        try { m?.delete(); } catch (_) {}
      });
    }
  }

  /*
    Combines geometry and image quality into a single verdict.
    `ok` gates auto capture; `message` is what the user is told.
    Ordered so the most actionable problem is reported first.
  */
  function evaluateCaptureReadiness(
    corners, quality, frameW, frameH,
    /*
      Minimum share of the frame the subject must fill. Defaults to the
      paper threshold; ID Card mode passes its own smaller value, since
      a card at a natural distance never fills as much as a page and
      would otherwise be told to "move closer" indefinitely.
    */
    minAreaRatio = MIN_DOC_AREA_RATIO
  ) {
    if (!corners) {
      return { ok: false, message: msg("searching", "Place the document inside the frame.") };
    }

    const frameArea = frameW * frameH;
    const areaRatio = polygonArea(corners) / frameArea;

    if (areaRatio < minAreaRatio) {
      return { ok: false, message: msg("tooFar", "Move closer to the document.") };
    }

    // A corner touching the frame edge means part of the page is very
    // likely cut off, which would silently crop content away.
    const marginX = frameW * EDGE_MARGIN_RATIO;
    const marginY = frameH * EDGE_MARGIN_RATIO;

    const clipped = corners.some(p =>
      p.x <= marginX ||
      p.y <= marginY ||
      p.x >= frameW - marginX ||
      p.y >= frameH - marginY
    );

    if (clipped) {
      return { ok: false, message: msg("partiallyOutside", "Fit the whole document in the frame.") };
    }

    const [tl, tr, br, bl] = corners;
    const angles = [
      cornerAngle(bl, tl, tr),
      cornerAngle(tl, tr, br),
      cornerAngle(tr, br, bl),
      cornerAngle(br, bl, tl)
    ];

    const worstTilt = Math.max(...angles.map(a => Math.abs(90 - a)));

    if (worstTilt > MAX_TILT_DEGREES) {
      return { ok: false, message: msg("tilted", "Hold your device flat above the page.") };
    }

    if (quality) {
      if (quality.brightness < DARK_MEAN_MAX) {
        return { ok: false, message: msg("tooDark", "Increase lighting for a clearer scan.") };
      }

      if (quality.brightness > BRIGHT_MEAN_MIN) {
        return { ok: false, message: msg("tooBright", "Reduce the lighting.") };
      }

      if (quality.glareRatio > GLARE_RATIO_MAX) {
        return { ok: false, message: msg("glare", "Glare detected — tilt away from the light.") };
      }

      if (quality.sharpness < BLUR_VARIANCE_MIN) {
        return { ok: false, message: msg("blurry", "Hold your device steady.") };
      }
    }

    return { ok: true, message: msg("detected", "Document detected ✓") };
  }

  // How long the outline must stay still before it is confirmed.
  const STABLE_CONFIRM_MS = 450;

  // Movement below this fraction of frame width counts as "holding still".
  const STABLE_TOLERANCE_RATIO = 0.035;

  let stabilityReference = null;

  function averageCornerShift(a, b) {
    let total = 0;
    for (let i = 0; i < 4; i++) {
      total += distance(a[i], b[i]);
    }
    return total / 4;
  }

  /*
    Blends the newest detection into the tracked quadrilateral.
    Small changes are damped so the outline stays calm while the phone
    moves; a large jump means the user aimed at something else, so the
    tracker snaps rather than sliding across the screen.
  */
  function smoothCorners(corners) {
    if (!smoothedCorners) {
      smoothedCorners = corners;
      return smoothedCorners;
    }

    const frameWidth = video.videoWidth || 1;
    const shift = averageCornerShift(smoothedCorners, corners);

    if (shift > frameWidth * SNAP_DISTANCE_RATIO) {
      smoothedCorners = corners;
      return smoothedCorners;
    }

    smoothedCorners = smoothedCorners.map((prev, i) => ({
      x: prev.x + (corners[i].x - prev.x) * SMOOTHING,
      y: prev.y + (corners[i].y - prev.y) * SMOOTHING
    }));

    return smoothedCorners;
  }

  /*
    Measures how long the raw detection has stayed in one place.
    `stableSince` drives both the confirmation tick and auto capture, so
    neither can trigger while the document is still drifting.
  */
  function trackStability(corners) {
    const frameWidth = video.videoWidth || 1;
    const tolerance = frameWidth * STABLE_TOLERANCE_RATIO;

    if (
      stabilityReference &&
      averageCornerShift(stabilityReference, corners) <= tolerance
    ) {
      if (stableSince === null) {
        stableSince = Date.now();
      }
      return;
    }

    // Moved too much — restart the hold timer from this position.
    stabilityReference = corners;
    stableSince = null;
  }

  const liveOverlay = document.createElement("div");
  liveOverlay.className = "ws-live-corners";
  liveOverlay.innerHTML = `
    <svg class="ws-live-quad" preserveAspectRatio="none" viewBox="0 0 100 100">
      <polygon class="ws-live-quad-shape" points="" />
    </svg>
    <span class="ws-live-corner" data-corner="0"></span>
    <span class="ws-live-corner" data-corner="1"></span>
    <span class="ws-live-corner" data-corner="2"></span>
    <span class="ws-live-corner" data-corner="3"></span>
  `;
  cameraScreen.querySelector(".camera-view")?.appendChild(liveOverlay);

  const quadShape = liveOverlay.querySelector(".ws-live-quad-shape");

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
      <div class="ws-processing-title" id="wsProcessingTitle">Scanning document</div>
      <div class="ws-processing-sub" id="wsProcessingSub">Detecting edges and correcting perspective…</div>
    </div>
  `;
  cameraScreen.querySelector(".camera-view")?.appendChild(processing);

  /*
    Page counter that doubles as the entry point to the page manager.
    The stock thumbnail strip is hidden in this camera layout, so this
    keeps multi-page sessions reachable without leaving the camera.
  */
  const pagesChip = document.createElement("button");
  pagesChip.type = "button";
  pagesChip.className = "ws-pages-chip";
  pagesChip.hidden = true;
  pagesChip.innerHTML = `<span class="ws-pages-count">0</span> pages`;

  pagesChip.addEventListener("click", () => {
    window.WebScanPages?.open();
  });

  cameraScreen.appendChild(pagesChip);

  function syncPagesChip() {
    const count = window.webscanState?.pages?.length || 0;

    pagesChip.hidden = count === 0;
    pagesChip.querySelector(".ws-pages-count").textContent = String(count);
  }

  window.addEventListener("webscan-pages-changed", syncPagesChip);
  syncPagesChip();

  const modeBar = document.createElement("div");
  modeBar.className = "ws-mode-bar";
  modeBar.innerHTML = `
    <button class="ws-mode" data-mode="Text">Text</button>
    <button class="ws-mode" data-mode="ID Card">ID Card</button>
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
    <button
      type="button"
      class="ws-camera-top-btn ws-auto-btn"
      id="wsAutoTop"
      aria-label="Auto capture"
      aria-pressed="false"
    >AUTO</button>
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

  /*
    Interior angle at corner `b`, between segments b->a and b->c.
    A real sheet of paper photographed from a normal angle keeps every
    corner reasonably close to 90°, so this is the main signal used to
    throw away random rectangular clutter in the scene.
  */
  function cornerAngle(a, b, c) {
    const v1x = a.x - b.x, v1y = a.y - b.y;
    const v2x = c.x - b.x, v2y = c.y - b.y;

    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);

    if (!len1 || !len2) return 0;

    const cos = (v1x * v2x + v1y * v2y) / (len1 * len2);

    return Math.acos(Math.max(-1, Math.min(1, cos))) * (180 / Math.PI);
  }

  /*
    Scores an ordered quadrilateral as a document candidate.
    Returns 0 when the shape should be rejected outright, which is what
    keeps false detections off the screen.
  */
  /*
    `profile` is passed explicitly so scoring depends on its arguments
    rather than on module state. It defaults to the active mode, so
    callers in the app are unaffected.
  */
  function scoreQuad(ordered, imageArea, profile = modeProfile()) {
    const [tl, tr, br, bl] = ordered;

    const area = polygonArea(ordered);
    const ratio = area / imageArea;

    /*
      Too small to be the document being scanned, or so large it is
      almost certainly the video frame border itself.

      The lower bound follows the mode: a card held at a comfortable
      distance covers far less of the frame than a sheet of paper, and
      the paper threshold would discard it before scoring ever ran.
    */
    const minArea = profile?.minScoreAreaRatio ?? 0.08;
    if (ratio < minArea || ratio > 0.97) return 0;

    const top = distance(tl, tr);
    const right = distance(tr, br);
    const bottom = distance(br, bl);
    const left = distance(bl, tl);

    const minSide = Math.min(top, right, bottom, left);
    const maxSide = Math.max(top, right, bottom, left);

    if (minSide < 40) return 0;

    // Opposite sides of a document stay similar in length even when the
    // page is tilted. Wildly mismatched pairs mean it is not a rectangle.
    const horizontalRatio = Math.min(top, bottom) / Math.max(top, bottom);
    const verticalRatio = Math.min(left, right) / Math.max(left, right);

    if (horizontalRatio < 0.55 || verticalRatio < 0.55) return 0;

    // Reject extreme slivers, but stay permissive enough for long
    // receipts and ID cards in either orientation.
    const aspect = maxSide / minSide;
    if (aspect > 6) return 0;

    const angles = [
      cornerAngle(bl, tl, tr),
      cornerAngle(tl, tr, br),
      cornerAngle(tr, br, bl),
      cornerAngle(br, bl, tl)
    ];

    let angleError = 0;
    for (const angle of angles) {
      // Perspective can push a corner well away from 90°, but a genuine
      // page never collapses into a very sharp or very flat corner.
      if (angle < 50 || angle > 135) return 0;
      angleError += Math.abs(90 - angle);
    }

    const angleScore = Math.max(0, 1 - (angleError / 160));
    const shapeScore = (horizontalRatio + verticalRatio) / 2;

    const target = profile?.targetRatio;

    /*
      Without a target ratio, larger candidates win. That is correct for
      paper but wrong for a card: a card fills little of the frame, so
      area weighting favours the desk edge or the hand holding it over
      the card itself.

      When a mode declares a target shape, closeness to that shape
      carries most of the weight and area is demoted to a tie-breaker.
    */
    if (target) {
      const ratioError = Math.abs(aspect - target) / target;
      const fitScore = Math.max(0, 1 - ratioError);

      return fitScore * 0.5 + angleScore * 0.3
        + shapeScore * 0.15 + ratio * 0.05;
    }

    // Larger, squarer, better-proportioned candidates win.
    return ratio * 0.45 + angleScore * 0.35 + shapeScore * 0.20;
  }

  /*
    Collects quadrilateral candidates from a single binary edge mask.
    Shared by every detection strategy below.
  */
  function collectCandidates(edges, imageArea, onCandidate) {
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();

    try {
      cv.findContours(
        edges,
        contours,
        hierarchy,
        cv.RETR_LIST,
        cv.CHAIN_APPROX_SIMPLE
      );

      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);

        try {
          // Cheap area gate before the more expensive polygon fit.
          if (Math.abs(cv.contourArea(contour)) < imageArea * 0.05) {
            continue;
          }

          const peri = cv.arcLength(contour, true);

          // Several tolerances, because the ideal simplification level
          // depends on how clean the page edges came out.
          for (const epsilon of [0.02, 0.03, 0.045]) {
            const approx = new cv.Mat();

            try {
              cv.approxPolyDP(contour, approx, epsilon * peri, true);

              if (approx.rows === 4 && cv.isContourConvex(approx)) {
                const pts = [];
                for (let j = 0; j < 4; j++) {
                  pts.push({
                    x: approx.intPtr(j, 0)[0],
                    y: approx.intPtr(j, 0)[1]
                  });
                }

                onCandidate(orderPoints(pts));
                break;
              }
            } finally {
              approx.delete();
            }
          }
        } finally {
          contour.delete();
        }
      }
    } finally {
      contours.delete();
      hierarchy.delete();
    }
  }

  function findDocumentCorners(canvas) {
    if (!cvIsReady()) return null;

    const mats = [];
    const track = (mat) => { mats.push(mat); return mat; };

    try {
      let src = track(cv.imread(canvas));
      const maxW = 720;

      if (src.cols > maxW) {
        const scale = maxW / src.cols;
        const resized = track(new cv.Mat());
        cv.resize(src, resized, new cv.Size(
          Math.round(src.cols * scale),
          Math.round(src.rows * scale)
        ));
        src = resized;
      }

      const imageArea = src.cols * src.rows;

      const gray = track(new cv.Mat());
      const blur = track(new cv.Mat());

      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

      // Edge-preserving smoothing keeps page borders crisp while
      // removing paper texture and print noise that create fake edges.
      cv.bilateralFilter(gray, blur, 9, 60, 60);

      let best = null;
      let bestScore = 0;

      const consider = (ordered) => {
        const score = scoreQuad(ordered, imageArea);
        if (score > bestScore) {
          bestScore = score;
          best = ordered;
        }
      };

      /*
        Strategy 1 — Canny edges at several thresholds.
        Handles the common case of a page on a contrasting surface.
      */
      for (const [low, high] of [[40, 120], [60, 180], [20, 70]]) {
        const edges = track(new cv.Mat());
        cv.Canny(blur, edges, low, high);

        // Close small gaps so a broken border still forms one contour.
        const kernel = track(
          cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5))
        );
        cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel);

        collectCandidates(edges, imageArea, consider);
      }

      /*
        Strategy 2 — adaptive threshold.
        Works when the page and background have similar brightness, and
        for coloured paper where global contrast is weak.
      */
      const adaptive = track(new cv.Mat());
      cv.adaptiveThreshold(
        blur,
        adaptive,
        255,
        cv.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv.THRESH_BINARY,
        15,
        8
      );

      const adaptiveKernel = track(
        cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3))
      );
      cv.morphologyEx(adaptive, adaptive, cv.MORPH_CLOSE, adaptiveKernel);

      collectCandidates(adaptive, imageArea, consider);

      /*
        Strategy 3 — saturation channel.
        A white or light page is much less saturated than a coloured
        desk, table or floor, so this separates them when brightness
        alone cannot.
      */
      const rgb = track(new cv.Mat());
      const hsv = track(new cv.Mat());
      const channels = new cv.MatVector();

      try {
        cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
        cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
        cv.split(hsv, channels);

        const saturation = channels.get(1);

        try {
          const satEdges = track(new cv.Mat());
          cv.Canny(saturation, satEdges, 40, 120);

          const satKernel = track(
            cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5))
          );
          cv.morphologyEx(satEdges, satEdges, cv.MORPH_CLOSE, satKernel);

          collectCandidates(satEdges, imageArea, consider);
        } finally {
          saturation.delete();
        }
      } finally {
        channels.delete();
      }

      if (!best) return null;

      // Map back to the caller's canvas resolution.
      const scaleX = canvas.width / src.cols;
      const scaleY = canvas.height / src.rows;

      return best.map(p => ({
        x: p.x * scaleX,
        y: p.y * scaleY
      }));
    } catch (error) {
      console.warn("Document detection failed:", error);
      return null;
    } finally {
      mats.forEach(mat => {
        try { mat?.delete(); } catch (_) {}
      });
    }
  }

  /*
    The video element is rendered with `object-fit: cover`, so the
    displayed picture is scaled up and cropped. Detection happens in the
    video's intrinsic pixel space, which means raw video coordinates must
    be converted into the on-screen box before the overlay is positioned.
    Without this the markers drift far outside the document.
  */
  function videoPointToOverlayPercent(point) {
    const box = video.getBoundingClientRect();
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    if (!vw || !vh || !box.width || !box.height) {
      return null;
    }

    const scale = Math.max(box.width / vw, box.height / vh);

    const displayedW = vw * scale;
    const displayedH = vh * scale;

    const offsetX = (box.width - displayedW) / 2;
    const offsetY = (box.height - displayedH) / 2;

    return {
      x: ((offsetX + point.x * scale) / box.width) * 100,
      y: ((offsetY + point.y * scale) / box.height) * 100
    };
  }

  function showCorners(corners) {
    if (!corners) {
      hideCorners();
      return;
    }

    const mapped = corners.map(videoPointToOverlayPercent);

    if (mapped.some(p => p === null)) {
      hideCorners();
      return;
    }

    lastCorners = corners;

    mapped.forEach((p, i) => {
      const el = liveOverlay.querySelector(
        `.ws-live-corner[data-corner="${i}"]`
      );
      if (!el) return;

      el.style.left = `${p.x}%`;
      el.style.top = `${p.y}%`;
      el.style.display = "block";
    });

    if (quadShape) {
      quadShape.setAttribute(
        "points",
        mapped.map(p => `${p.x},${p.y}`).join(" ")
      );
      liveOverlay.classList.add("ws-has-quad");
    }

    const frame = cameraScreen.querySelector(".scan-frame");
    frame?.classList.add("ws-detected");
  }

  function hideCorners() {
    lastCorners = null;

    liveOverlay.querySelectorAll(".ws-live-corner").forEach(el => {
      el.style.display = "none";
    });

    liveOverlay.classList.remove("ws-has-quad");
    quadShape?.setAttribute("points", "");

    cameraScreen.querySelector(".scan-frame")?.classList.remove("ws-detected");
  }

  /*
    Grabs the current video frame into the reusable preview canvas.

    The canvas is allocated once instead of per frame: at two frames a
    second a fresh canvas each time produces continuous garbage that
    shows up as periodic stutter on mobile.
  */
  /*
    The region of the video that is actually on screen.

    `object-fit: cover` scales the stream to fill the view and crops the
    overflow. On a portrait phone given a landscape stream this can hide
    most of the frame width. Detecting across the whole frame would find
    documents the user cannot see and draw the outline off-target, so
    detection is limited to the visible rectangle.
  */
  function visibleVideoRect() {
    const box = video.getBoundingClientRect();

    const vw = video.videoWidth;
    const vh = video.videoHeight;

    if (!vw || !vh || !box.width || !box.height) {
      return { x: 0, y: 0, width: vw || 1, height: vh || 1 };
    }

    const scale = Math.max(box.width / vw, box.height / vh);

    // Size of the on-screen box expressed in source pixels.
    const visibleW = Math.min(vw, box.width / scale);
    const visibleH = Math.min(vh, box.height / scale);

    return {
      x: (vw - visibleW) / 2,
      y: (vh - visibleH) / 2,
      width: visibleW,
      height: visibleH
    };
  }

  function capturePreviewFrame() {
    const source = visibleVideoRect();

    // Remembered so detected corners can be mapped back into full-frame
    // coordinates, which is the space the overlay works in.
    lastSourceRect = source;

    const targetW = detectionWidth;
    const ratio = source.height / source.width;

    const width = targetW;
    const height = Math.max(1, Math.round(targetW * ratio));

    if (previewCanvas.width !== width || previewCanvas.height !== height) {
      previewCanvas.width = width;
      previewCanvas.height = height;
    }

    previewCtx.drawImage(
      video,
      source.x, source.y, source.width, source.height,
      0, 0, width, height
    );

    return previewCanvas;
  }

  /* Applies a detection result, whether it came from the worker or not. */
  function handleDetection(corners, quality, frameW, frameH) {
    if (corners) {
      missStreak = 0;

      /*
        Detection ran on the visible crop, so results are scaled by that
        region and shifted by its offset to land in full-frame
        coordinates, which is what the overlay and capture both use.
      */
      const source = lastSourceRect || {
        x: 0,
        y: 0,
        width: video.videoWidth,
        height: video.videoHeight
      };

      const sx = source.width / frameW;
      const sy = source.height / frameH;

      const inVideoSpace = corners.map(p => ({
        x: source.x + p.x * sx,
        y: source.y + p.y * sy
      }));

      showCorners(smoothCorners(inVideoSpace));
      trackStability(inVideoSpace);

      lastQuality = quality;

      const readiness = evaluateCaptureReadiness(
        corners,
        quality,
        frameW,
        frameH,
        modeProfile().minAreaRatio
      );

      // The outline must also have stopped moving. Both conditions are
      // required before the tick — and auto capture — are allowed.
      const settled = stableSince !== null &&
        Date.now() - stableSince >= STABLE_CONFIRM_MS;

      captureReady = readiness.ok && settled;

      if (!readiness.ok) {
        setStatus(readiness.message, "warn");
      } else {
        setStatus(settled ? readiness.message : msg("holdSteady", "Hold your device steady."), "ready");
      }

      liveOverlay.classList.toggle("ws-quad-ready", captureReady);

      maybeAutoCapture();
    } else {
      missStreak++;

      // Tolerate brief detection dropouts instead of flickering off.
      if (missStreak > MAX_MISSES) {
        hideCorners();
        smoothedCorners = null;
        stableSince = null;
        captureReady = false;
        lastQuality = null;
        setStatus(msg("searching", "Place the document inside the frame."));
      }
    }
  }

  function detectLive() {
    if (detecting || !video.videoWidth || video.readyState < 2) return;

    detecting = true;

    try {
      const frame = capturePreviewFrame();

      if (worker && workerReady) {
        /*
          The pixel buffer is transferred rather than copied, so a large
          preview frame costs nothing to hand over.
        */
        const imageData =
          previewCtx.getImageData(0, 0, frame.width, frame.height);

        pendingFrame = { width: frame.width, height: frame.height };

        /*
          The active mode profile travels with the frame so the live
          outline is scored the same way the capture will be. Sending
          it per frame rather than caching it in the worker means a
          mode switch takes effect on the very next frame.
        */
        worker.postMessage(
          { type: "detect", id: ++frameId, imageData, profile: modeProfile() },
          [imageData.data.buffer]
        );

        // `detecting` stays true until the worker replies, which keeps
        // only one frame in flight and prevents a backlog.
        return;
      }

      // Fallback: no worker available, run inline as before.
      const started = Date.now();

      const corners = findDocumentCorners(frame);
      const quality = measurePreviewQuality(frame);

      recordFrameCost(Date.now() - started);

      handleDetection(corners, quality, frame.width, frame.height);
    } catch (error) {
      setStatus("Ready to scan");
      stableSince = null;
      captureReady = false;
    } finally {
      // The worker path returns early and clears this in its callback.
      if (!worker || !workerReady) {
        detecting = false;
      }
    }
  }

  /*
    Runs the sharpness/exposure analysis on a preview canvas.
    Kept separate from findDocumentCorners so detection stays unchanged.
  */
  function measurePreviewQuality(canvas) {
    if (!cvIsReady()) return null;

    let src = null, gray = null;

    try {
      src = cv.imread(canvas);
      gray = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

      return analyseFrameQuality(gray);
    } catch (error) {
      return null;
    } finally {
      [src, gray].forEach(m => {
        try { m?.delete(); } catch (_) {}
      });
    }
  }

  function maybeAutoCapture() {
    if (!window.webscanAutoCapture || autoCapturing) {
      return;
    }

    // Every condition must hold: four corners found, document large
    // enough, fully inside frame, not too skewed, sharp and correctly
    // exposed, and the outline settled.
    if (!captureReady) {
      return;
    }

    // `stableSince` is owned by trackStability(), which only sets it once
    // the document has genuinely stopped moving.
    if (stableSince === null) {
      return;
    }

    if (Date.now() - stableSince < AUTO_CAPTURE_HOLD_MS) {
      return;
    }

    stableSince = null;
    stabilityReference = null;
    autoCapturing = true;

    captureBtn.click();

    setTimeout(() => {
      autoCapturing = false;
    }, 2000);
  }

  function resetTracking() {
    smoothedCorners = null;
    stabilityReference = null;
    stableSince = null;
    missStreak = 0;

    // A frame may still be in flight; its result must not be applied to
    // the next session, and `detecting` must not stay stuck true.
    pendingFrame = null;
    detecting = false;

    hideCorners();
  }

  function startLiveDetection() {
    if (detectTimer) clearInterval(detectTimer);

    // Clear tracking from any previous session so a stale outline is
    // never carried over when the camera reopens.
    resetTracking();

    detectTimer = setInterval(detectLive, detectInterval);
  }

  function stopLiveDetection() {
    if (detectTimer) clearInterval(detectTimer);
    detectTimer = null;
    resetTracking();
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

      /*
        In ID Card mode the measured shape is replaced by the true card
        ratio before scaling, so perspective foreshortening is corrected
        rather than preserved. Other modes are unaffected: their profile
        has no target ratio and the measured size passes straight through.
      */
      const shaped = resolveOutputSize(maxWidth, maxHeight);

      const maxOutput = 3000;
      const scale = Math.min(
        1,
        maxOutput / Math.max(shaped.width, shaped.height)
      );

      const outW = Math.max(1, Math.round(shaped.width * scale));
      const outH = Math.max(1, Math.round(shaped.height * scale));

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
            reject(new Error(noticeMsg("scanFailed", "The scan could not be processed. Try capturing again.")));
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
      setStatus(msg("cameraNotReady", "Camera is still starting…"), "error");
      return;
    }

    processing.classList.add("show");
    flash.classList.remove("show");
    void flash.offsetWidth;
    flash.classList.add("show");

    await new Promise(r => setTimeout(r, 40));

    try {
      setProgress(
        "Scanning document",
        progressMsg("capturing", "Capturing…")
      );

      const raw = makeCaptureCanvas();

      let corners = lastCorners;

      // Run a fresh detection on the full-resolution capture.
      if (autoCrop && cvReady) {
        setProgress(
          "Scanning document",
          progressMsg(
            "detectingEdges",
            "Detecting edges and correcting perspective…"
          )
        );

        // Yields so the message paints before the blocking work starts;
        // otherwise the user sees the previous stage for the whole time.
        await new Promise(r => setTimeout(r, 0));

        const fresh = findDocumentCorners(raw);
        if (fresh) corners = fresh;
      }

      const cropped = autoCrop && corners;
      const result = cropped ? warpPerspective(raw, corners) : raw;

      setProgress(
        "Scanning document",
        progressMsg("enhancing", "Enhancing your scan…")
      );

      /*
        When the image was NOT auto-cropped it still matches the detected
        corners, so they are handed to the editor to pre-fill the manual
        adjustment handles. After warping they no longer apply.
      */
      window.webscanLastCorners = cropped ? null : corners;

      await addProcessedImageToExistingApp(result);

      setStatus(
        autoCrop && corners
          ? "Document corrected"
          : "Scan captured",
        "ready"
      );

      // "To Word" mode automatically runs OCR after the corrected scan.
      // The OCR engine is loaded only when this mode is used.
      if ((mode === "To Word" || mode === "Text") && window.WebScanOCR) {
        setStatus(progressMsg("readingText", "Reading document text…"));

        setProgress(
          "Reading text",
          progressMsg("loadingOcr", "Loading the text engine…")
        );

        await window.WebScanOCR.run(result, "eng+ben", null);

        setStatus("Text recognised", "ready");
      }
    } catch (error) {
      console.error(error);

      setStatus(
        noticeMsg(
          "scanFailed",
          "The scan could not be processed. Try capturing again."
        ),
        "error"
      );
    } finally {
      processing.classList.remove("show");
    }
  }

  // Capture phase runs before script.js's normal click listener.
  captureBtn.addEventListener("click", enhancedCapture, true);

  /*
    Reshapes the on-screen guide to match the mode's target shape.

    The guide is what the user aims with, so in a mode that expects a
    specific shape it has to show that shape. Without this the card
    mode would still draw a portrait page outline and quietly correct
    to a card afterwards, which reads as a bug.
  */
  function applyModeGuide() {
    const frame = cameraScreen.querySelector(".scan-frame");
    if (!frame) return;

    const guide = modeProfile().guide;

    if (guide) {
      // Landscape card: wide and short, centred in the preview.
      frame.style.aspectRatio = String(guide);
      frame.style.width = "min(86%, 380px)";
      frame.style.height = "auto";
      frame.style.top = "";
      frame.classList.add("ws-guide-card");
    } else {
      // Restore the stylesheet's own page-shaped guide.
      frame.style.aspectRatio = "";
      frame.style.width = "";
      frame.style.height = "";
      frame.style.top = "";
      frame.classList.remove("ws-guide-card");
    }
  }

  document.addEventListener("click", (event) => {
    const btn = event.target.closest?.(".ws-mode");
    if (!btn) return;

    mode = btn.dataset.mode || "Scan";
    document.querySelectorAll(".ws-mode").forEach(el => {
      el.classList.toggle("active", el === btn);
    });

    applyModeGuide();

    // Naming what the mode will do is more useful than echoing its name.
    const profile = modeProfile();

    setStatus(
      profile.targetRatio
        ? "ID Card mode — fit the card inside the guide"
        : `${mode} mode`,
      "ready"
    );
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

  const topAuto = $("wsAutoTop");

  /*
    Reflects the shared auto-capture preference on the camera button.
    script.js owns the setting, so both this control and the Settings
    screen toggle always show the same value.
  */
  function syncAutoButton() {
    const on = !!window.webscanAutoCapture;
    topAuto?.classList.toggle("ws-active", on);
    topAuto?.setAttribute("aria-pressed", String(on));
  }

  topAuto?.addEventListener("click", () => {
    const next = !window.webscanAutoCapture;

    // Delegates to script.js so the change is persisted and the Settings
    // screen row updates too, instead of keeping a second source of truth.
    if (typeof window.webscanSetAutoCapture === "function") {
      window.webscanSetAutoCapture(next);
    } else {
      window.webscanAutoCapture = next;
    }

    syncAutoButton();

    if (!next) {
      stableSince = null;
    }

    setStatus(next ? "Auto capture on" : "Auto capture off", "ready");
  });

  window.addEventListener("webscan-autocapture-changed", syncAutoButton);
  syncAutoButton();

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

  /*
    Rotating or resizing changes the visible crop, so any tracked
    outline describes a layout that no longer exists. Clearing the whole
    tracking state avoids a stale quadrilateral sliding across the new
    view, and lets stability build up again from the new geometry.
  */
  let layoutTimer = null;

  function onLayoutChange() {
    lastSourceRect = null;
    resetTracking();

    clearTimeout(layoutTimer);

    layoutTimer = setTimeout(() => {
      // Re-measure once the browser has settled on the new size.
      if (detectTimer) {
        detectLive();
      }
    }, 300);
  }

  window.addEventListener("resize", onLayoutChange);

  window.addEventListener("orientationchange", onLayoutChange);

  function onOpenCVReady() {
    if (cvReady) return;

    cvReady = true;
    setStatus("Auto scan ready", "ready");
    startLiveDetection();
  }

  function waitForOpenCV() {
    if (cvIsReady()) {
      onOpenCVReady();
      return;
    }

    setTimeout(waitForOpenCV, 250);
  }

  // opencv.js signals readiness through Module.onRuntimeInitialized, which
  // index.html forwards as this event. Polling stays as a fallback for the
  // case where the runtime finished before this script ran.
  window.addEventListener("webscan-opencv-ready", onOpenCVReady);

  window.addEventListener("webscan-opencv-failed", () => {
    setStatus(msg("detectionUnavailable", "Automatic detection is unavailable. Tap the shutter to capture."), "error");
  });

  /*
    The worker is preferred because it keeps the ~90ms detection pass off
    the main thread. Its own OpenCV copy loads in parallel; if the worker
    cannot start, the main-thread path takes over automatically.
  */
  setupWorker();

  if (!worker) {
    waitForOpenCV();
  }

  // If the camera starts after this engine loads, detection resumes as
  // soon as video dimensions are available — but only once OpenCV is up,
  // otherwise the detector would run and silently find nothing.
  video.addEventListener("loadedmetadata", () => {
    if (!cvReady) return;
    setTimeout(startLiveDetection, 300);
  });

  // script.js clears the stream when leaving the camera screen. Stopping
  // the detector then keeps it from scanning blank frames in the
  // background, which would waste CPU and battery on mobile.
  video.addEventListener("emptied", stopLiveDetection);

  window.addEventListener("beforeunload", stopLiveDetection);
})();
