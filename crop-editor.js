/* =========================================================
   WebScan Manual Corner Adjustment

   Full-screen editor where the four document corners can be
   dragged by hand. Applying re-runs the same perspective
   correction the automatic path uses, so manual and automatic
   scans produce identical output quality.

   Runs entirely on-device.
   ========================================================= */

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  function cvIsReady() {
    return typeof window.cv !== "undefined" &&
      !!window.cv.Mat &&
      !!window.cv.imread;
  }

  /* ---------------------------------------------------------
     GEOMETRY
     --------------------------------------------------------- */

  function orderPoints(points) {
    const pts = points.map(p => ({ x: p.x, y: p.y }));
    const sum = pts.map(p => p.x + p.y);
    const diff = pts.map(p => p.x - p.y);

    return [
      pts[sum.indexOf(Math.min(...sum))],
      pts[diff.indexOf(Math.max(...diff))],
      pts[sum.indexOf(Math.max(...sum))],
      pts[diff.indexOf(Math.min(...diff))]
    ];
  }

  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  /*
    Perspective-corrects `corners` out of `sourceCanvas`.
    Output size comes from the measured edge lengths so the document
    keeps its real aspect ratio and the content is not stretched.
  */
  function warp(sourceCanvas, corners) {
    if (!cvIsReady()) return null;

    let src = null, dst = null, srcTri = null, dstTri = null, M = null;

    try {
      const [tl, tr, br, bl] = orderPoints(corners);

      const maxWidth = Math.max(1, Math.round(
        Math.max(distance(br, bl), distance(tr, tl))
      ));
      const maxHeight = Math.max(1, Math.round(
        Math.max(distance(tr, br), distance(tl, bl))
      ));

      const limit = 3000;
      const scale = Math.min(1, limit / Math.max(maxWidth, maxHeight));
      const outW = Math.max(1, Math.round(maxWidth * scale));
      const outH = Math.max(1, Math.round(maxHeight * scale));

      src = cv.imread(sourceCanvas);

      srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y
      ]);

      dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        0, 0, outW - 1, 0, outW - 1, outH - 1, 0, outH - 1
      ]);

      M = cv.getPerspectiveTransform(srcTri, dstTri);
      dst = new cv.Mat();

      cv.warpPerspective(
        src, dst, M, new cv.Size(outW, outH),
        cv.INTER_CUBIC, cv.BORDER_REPLICATE, new cv.Scalar()
      );

      const out = document.createElement("canvas");
      out.width = outW;
      out.height = outH;
      cv.imshow(out, dst);
      return out;
    } catch (error) {
      console.warn("Manual perspective correction failed:", error);
      return null;
    } finally {
      [src, dst, srcTri, dstTri, M].forEach(m => {
        try { m?.delete(); } catch (_) {}
      });
    }
  }

  /* ---------------------------------------------------------
     UI
     --------------------------------------------------------- */

  const overlay = document.createElement("div");
  overlay.className = "ws-crop-overlay";
  overlay.innerHTML = `
    <header class="ws-crop-header">
      <button type="button" class="ws-crop-cancel">Cancel</button>
      <strong>Adjust corners</strong>
      <button type="button" class="ws-crop-reset">Reset</button>
    </header>

    <div class="ws-crop-stage">
      <img class="ws-crop-image" alt="Document being adjusted">
      <svg class="ws-crop-svg" preserveAspectRatio="none" viewBox="0 0 100 100">
        <polygon class="ws-crop-poly" points="" />
      </svg>
      <div class="ws-crop-handles"></div>
    </div>

    <footer class="ws-crop-footer">
      <span class="ws-crop-hint">Drag the corners to match the document</span>
      <button type="button" class="ws-crop-apply">Apply</button>
    </footer>
  `;

  document.body.appendChild(overlay);

  const stage = overlay.querySelector(".ws-crop-stage");
  const image = overlay.querySelector(".ws-crop-image");
  const poly = overlay.querySelector(".ws-crop-poly");
  const handleBox = overlay.querySelector(".ws-crop-handles");

  const handles = [];
  for (let i = 0; i < 4; i++) {
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "ws-crop-handle";
    handle.dataset.corner = String(i);
    handle.setAttribute("aria-label", `Corner ${i + 1}`);
    handleBox.appendChild(handle);
    handles.push(handle);
  }

  // Corners in natural image pixel space.
  let corners = null;
  let naturalW = 0;
  let naturalH = 0;
  let sourceCanvas = null;
  let onApply = null;
  let dragging = null;

  /*
    The image uses object-fit: contain, so the rendered picture is
    letterboxed inside the stage. Overlay coordinates must account for
    those bars or the handles drift away from the document.
  */
  function displayRect() {
    const box = stage.getBoundingClientRect();

    if (!naturalW || !naturalH || !box.width || !box.height) {
      return { left: 0, top: 0, width: box.width, height: box.height };
    }

    const scale = Math.min(box.width / naturalW, box.height / naturalH);
    const width = naturalW * scale;
    const height = naturalH * scale;

    return {
      left: (box.width - width) / 2,
      top: (box.height - height) / 2,
      width,
      height
    };
  }

  function imageToStage(point) {
    const rect = displayRect();
    return {
      x: rect.left + (point.x / naturalW) * rect.width,
      y: rect.top + (point.y / naturalH) * rect.height
    };
  }

  function stageToImage(clientX, clientY) {
    const box = stage.getBoundingClientRect();
    const rect = displayRect();

    const x = ((clientX - box.left - rect.left) / rect.width) * naturalW;
    const y = ((clientY - box.top - rect.top) / rect.height) * naturalH;

    // Clamping keeps corners on the photo, so warping can never sample
    // outside the image and produce black wedges.
    return {
      x: Math.max(0, Math.min(naturalW, x)),
      y: Math.max(0, Math.min(naturalH, y))
    };
  }

  function render() {
    if (!corners) return;

    const box = stage.getBoundingClientRect();
    if (!box.width || !box.height) return;

    const points = corners.map(imageToStage);

    poly.setAttribute(
      "points",
      points
        .map(p => `${(p.x / box.width) * 100},${(p.y / box.height) * 100}`)
        .join(" ")
    );

    points.forEach((p, i) => {
      handles[i].style.left = `${p.x}px`;
      handles[i].style.top = `${p.y}px`;
    });
  }

  function startDrag(event) {
    const handle = event.target.closest(".ws-crop-handle");
    if (!handle) return;

    dragging = Number(handle.dataset.corner);
    handle.classList.add("ws-dragging");
    event.preventDefault();
  }

  function moveDrag(event) {
    if (dragging === null || !corners) return;

    const touch = event.touches?.[0];
    const clientX = touch ? touch.clientX : event.clientX;
    const clientY = touch ? touch.clientY : event.clientY;

    corners[dragging] = stageToImage(clientX, clientY);

    // Redrawn every move so the outline tracks the finger in real time.
    render();
    event.preventDefault();
  }

  function endDrag() {
    if (dragging === null) return;
    handles[dragging]?.classList.remove("ws-dragging");
    dragging = null;
  }

  handleBox.addEventListener("mousedown", startDrag);
  handleBox.addEventListener("touchstart", startDrag, { passive: false });

  window.addEventListener("mousemove", moveDrag);
  window.addEventListener("touchmove", moveDrag, { passive: false });

  window.addEventListener("mouseup", endDrag);
  window.addEventListener("touchend", endDrag);
  window.addEventListener("touchcancel", endDrag);

  window.addEventListener("resize", render);

  function defaultCorners() {
    // Slight inset rather than the exact border, so the handles are
    // visible and grabbable when no detection is available.
    const insetX = naturalW * 0.08;
    const insetY = naturalH * 0.08;

    return [
      { x: insetX, y: insetY },
      { x: naturalW - insetX, y: insetY },
      { x: naturalW - insetX, y: naturalH - insetY },
      { x: insetX, y: naturalH - insetY }
    ];
  }

  overlay.querySelector(".ws-crop-reset").addEventListener("click", () => {
    corners = defaultCorners();
    render();
  });

  overlay.querySelector(".ws-crop-cancel").addEventListener("click", close);

  overlay.querySelector(".ws-crop-apply").addEventListener("click", () => {
    if (!corners || !sourceCanvas) {
      close();
      return;
    }

    const result = warp(sourceCanvas, corners);
    const callback = onApply;

    close();

    if (result && typeof callback === "function") {
      callback(result);
    }
  });

  function close() {
    overlay.classList.remove("show");
    dragging = null;
    onApply = null;
    sourceCanvas = null;
    corners = null;
  }

  /*
    Opens the editor for an image.

      dataUrl        the page image to adjust
      initialCorners optional detected corners, in image pixels
      onApply        receives the corrected canvas
  */
  function open({ dataUrl, initialCorners, onApply: callback }) {
    onApply = callback;

    const img = new Image();

    img.onload = () => {
      naturalW = img.naturalWidth;
      naturalH = img.naturalHeight;

      sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = naturalW;
      sourceCanvas.height = naturalH;
      sourceCanvas.getContext("2d").drawImage(img, 0, 0);

      corners = Array.isArray(initialCorners) && initialCorners.length === 4
        ? orderPoints(initialCorners)
        : defaultCorners();

      image.src = dataUrl;
      overlay.classList.add("show");

      // Layout must settle before the handles can be positioned.
      requestAnimationFrame(render);
    };

    img.onerror = () => {
      console.warn("Crop editor could not load the image.");
      close();
    };

    img.src = dataUrl;
  }

  window.WebScanCrop = { open, warp };
})();
