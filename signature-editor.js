/* =========================================================
   WebScan Signature Editor

   Draw a freehand signature, then drag/resize it as a sticker
   over the document and bake it in permanently. Two stages in
   one overlay, mirroring crop-editor.js's shell (full-screen
   div built once, object-fit: contain stage, the same
   window-level mouse/touch drag pattern) so it feels like the
   same "sub-editor" as Crop rather than a bolted-on feature.

   Compositing is a plain 2D canvas draw -- unlike Crop, this
   never touches OpenCV, so it works even if that fails to load.

   Runs entirely on-device.
   ========================================================= */

(() => {
  "use strict";

  /* ---------------------------------------------------------
     UI
     --------------------------------------------------------- */

  const overlay = document.createElement("div");
  overlay.className = "ws-sign-overlay";
  overlay.innerHTML = `
    <section class="ws-sign-draw">
      <header class="ws-sign-header">
        <button type="button" class="ws-sign-cancel">Cancel</button>
        <strong>Draw signature</strong>
        <button type="button" class="ws-sign-clear">Clear</button>
      </header>

      <div class="ws-sign-pad-wrap">
        <canvas class="ws-sign-pad"></canvas>
      </div>

      <footer class="ws-sign-footer">
        <span class="ws-sign-hint">Draw your signature above</span>
        <button type="button" class="ws-sign-draw-done">Done</button>
      </footer>
    </section>

    <section class="ws-sign-place" hidden>
      <header class="ws-sign-header">
        <button type="button" class="ws-sign-back">Back</button>
        <strong>Place signature</strong>
        <span></span>
      </header>

      <div class="ws-sign-stage">
        <img class="ws-sign-doc-image" alt="Document">
        <div class="ws-sign-sticker">
          <img class="ws-sign-sticker-img" alt="Your signature">
          <button type="button" class="ws-sign-resize-handle" aria-label="Resize signature"></button>
        </div>
      </div>

      <footer class="ws-sign-footer">
        <span class="ws-sign-hint">Drag to move, corner to resize</span>
        <button type="button" class="ws-sign-place-done">Done</button>
      </footer>
    </section>
  `;

  document.body.appendChild(overlay);

  const drawSection = overlay.querySelector(".ws-sign-draw");
  const placeSection = overlay.querySelector(".ws-sign-place");

  const padWrap = overlay.querySelector(".ws-sign-pad-wrap");
  const pad = overlay.querySelector(".ws-sign-pad");
  const padCtx = pad.getContext("2d");

  const placeStage = overlay.querySelector(".ws-sign-stage");
  const docImageEl = overlay.querySelector(".ws-sign-doc-image");
  const stickerEl = overlay.querySelector(".ws-sign-sticker");
  const stickerImg = overlay.querySelector(".ws-sign-sticker-img");
  const resizeHandle = overlay.querySelector(".ws-sign-resize-handle");

  /* ---------------------------------------------------------
     DRAW STAGE
     --------------------------------------------------------- */

  let padDpr = 1;
  let padCssW = 0;
  let padCssH = 0;

  let strokeActive = false;
  let lastPoint = null;
  let hasInk = false;

  // Bounding box of every drawn point, tracked as strokes happen rather
  // than found afterward by scanning pixels -- the app already has
  // every coordinate in hand as each stroke segment is drawn.
  let inkMinX = Infinity;
  let inkMinY = Infinity;
  let inkMaxX = -Infinity;
  let inkMaxY = -Infinity;

  function resetInkBounds() {
    inkMinX = Infinity;
    inkMinY = Infinity;
    inkMaxX = -Infinity;
    inkMaxY = -Infinity;
  }

  function trackInk(point) {
    inkMinX = Math.min(inkMinX, point.x);
    inkMinY = Math.min(inkMinY, point.y);
    inkMaxX = Math.max(inkMaxX, point.x);
    inkMaxY = Math.max(inkMaxY, point.y);
  }

  function sizePad() {
    const rect = padWrap.getBoundingClientRect();
    padDpr = window.devicePixelRatio || 1;
    padCssW = rect.width;
    padCssH = rect.height;

    pad.width = Math.max(1, Math.round(padCssW * padDpr));
    pad.height = Math.max(1, Math.round(padCssH * padDpr));

    // Resizing the backing store clears it and drops any transform,
    // which is fine here since this only runs once per fresh open.
    padCtx.scale(padDpr, padDpr);
    padCtx.strokeStyle = "#1c1c1c";
    padCtx.lineWidth = 3;
    padCtx.lineCap = "round";
    padCtx.lineJoin = "round";
  }

  function padPoint(event) {
    const rect = pad.getBoundingClientRect();
    const touch = event.touches?.[0];
    const clientX = touch ? touch.clientX : event.clientX;
    const clientY = touch ? touch.clientY : event.clientY;

    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  function startStroke(event) {
    strokeActive = true;

    const p = padPoint(event);
    lastPoint = p;
    trackInk(p);

    event.preventDefault();
  }

  function moveStroke(event) {
    if (!strokeActive) return;

    const p = padPoint(event);

    padCtx.beginPath();
    padCtx.moveTo(lastPoint.x, lastPoint.y);
    padCtx.lineTo(p.x, p.y);
    padCtx.stroke();

    lastPoint = p;
    trackInk(p);
    hasInk = true;

    event.preventDefault();
  }

  function endStroke() {
    strokeActive = false;
    lastPoint = null;
  }

  pad.addEventListener("mousedown", startStroke);
  pad.addEventListener("touchstart", startStroke, { passive: false });

  window.addEventListener("mousemove", moveStroke);
  window.addEventListener("touchmove", moveStroke, { passive: false });

  window.addEventListener("mouseup", endStroke);
  window.addEventListener("touchend", endStroke);
  window.addEventListener("touchcancel", endStroke);

  overlay.querySelector(".ws-sign-clear").addEventListener("click", () => {
    padCtx.clearRect(0, 0, padCssW, padCssH);
    hasInk = false;
    resetInkBounds();
  });

  overlay.querySelector(".ws-sign-cancel").addEventListener("click", close);

  /* ---------------------------------------------------------
     PLACE STAGE
     --------------------------------------------------------- */

  let docImg = null;
  let docNaturalW = 0;
  let docNaturalH = 0;

  let sigCanvas = null;
  let sigAspect = 1;

  // Sticker position/size, in document natural pixel space -- the same
  // space crop-editor.js's corners live in.
  let stickerX = 0;
  let stickerY = 0;
  let stickerW = 0;
  let stickerH = 0;

  let dragMode = null; // null | "move" | "resize"
  let dragStart = null;

  let onApply = null;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  /*
    The document image uses object-fit: contain, so it's letterboxed
    inside the stage. Sticker coordinates must account for those bars
    the same way crop-editor.js's displayRect() does, or the sticker
    drifts away from the document as soon as the box isn't square.
  */
  function displayRect() {
    const box = placeStage.getBoundingClientRect();

    if (!docNaturalW || !docNaturalH || !box.width || !box.height) {
      return { left: 0, top: 0, width: box.width, height: box.height };
    }

    const scale = Math.min(box.width / docNaturalW, box.height / docNaturalH);
    const width = docNaturalW * scale;
    const height = docNaturalH * scale;

    return {
      left: (box.width - width) / 2,
      top: (box.height - height) / 2,
      width,
      height
    };
  }

  function docPointToStage(x, y) {
    const rect = displayRect();
    return {
      x: rect.left + (x / docNaturalW) * rect.width,
      y: rect.top + (y / docNaturalH) * rect.height
    };
  }

  function docLengthToStage(length) {
    const rect = displayRect();
    return length * (rect.width / docNaturalW);
  }

  function stageDeltaToDoc(dx, dy) {
    const rect = displayRect();
    return {
      x: dx * (docNaturalW / rect.width),
      y: dy * (docNaturalH / rect.height)
    };
  }

  function renderSticker() {
    const topLeft = docPointToStage(stickerX, stickerY);

    stickerEl.style.left = `${topLeft.x}px`;
    stickerEl.style.top = `${topLeft.y}px`;
    stickerEl.style.width = `${docLengthToStage(stickerW)}px`;
    stickerEl.style.height = `${docLengthToStage(stickerH)}px`;
  }

  function eventPoint(event) {
    const touch = event.touches?.[0];
    return {
      x: touch ? touch.clientX : event.clientX,
      y: touch ? touch.clientY : event.clientY
    };
  }

  function startStickerDrag(event) {
    const onHandle = event.target.closest(".ws-sign-resize-handle");
    const point = eventPoint(event);

    dragMode = onHandle ? "resize" : "move";
    dragStart = {
      point,
      stickerX,
      stickerY,
      stickerW,
      stickerH
    };

    stickerEl.classList.add("ws-dragging");

    event.preventDefault();
    event.stopPropagation();
  }

  function moveStickerDrag(event) {
    if (!dragMode) return;

    const point = eventPoint(event);
    const delta = stageDeltaToDoc(
      point.x - dragStart.point.x,
      point.y - dragStart.point.y
    );

    if (dragMode === "move") {

      stickerX = clamp(
        dragStart.stickerX + delta.x,
        0,
        Math.max(0, docNaturalW - stickerW)
      );

      stickerY = clamp(
        dragStart.stickerY + delta.y,
        0,
        Math.max(0, docNaturalH - stickerH)
      );

    } else {

      // Uniform scale from the dragged (bottom-right) corner, aspect
      // locked -- a signature that gets stretched out of proportion
      // reads as illegible rather than as a real signature.
      const newW = clamp(
        dragStart.stickerW + delta.x,
        24,
        docNaturalW * 0.95
      );

      stickerW = newW;
      stickerH = newW / sigAspect;

    }

    renderSticker();
    event.preventDefault();
  }

  function endStickerDrag() {
    if (!dragMode) return;

    dragMode = null;
    dragStart = null;
    stickerEl.classList.remove("ws-dragging");
  }

  stickerEl.addEventListener("mousedown", startStickerDrag);
  stickerEl.addEventListener("touchstart", startStickerDrag, { passive: false });

  window.addEventListener("mousemove", moveStickerDrag);
  window.addEventListener("touchmove", moveStickerDrag, { passive: false });

  window.addEventListener("mouseup", endStickerDrag);
  window.addEventListener("touchend", endStickerDrag);
  window.addEventListener("touchcancel", endStickerDrag);

  window.addEventListener("resize", () => {
    if (overlay.classList.contains("show") && !placeSection.hidden) {
      renderSticker();
    }
  });

  function enterPlaceStage() {
    drawSection.hidden = true;
    placeSection.hidden = false;

    stickerImg.src = sigCanvas.toDataURL("image/png");

    // A reasonable, typical starting size/position: about a quarter of
    // the page's width, sitting in the lower area where a signature is
    // normally placed. The user drags it wherever it actually belongs.
    stickerW = docNaturalW * 0.28;
    stickerH = stickerW / sigAspect;
    stickerX = (docNaturalW - stickerW) / 2;
    stickerY = docNaturalH - stickerH - docNaturalH * 0.08;

    requestAnimationFrame(renderSticker);
  }

  overlay.querySelector(".ws-sign-draw-done").addEventListener("click", () => {
    if (!hasInk) {
      close();
      return;
    }

    // Crop the pad down to the drawn ink's tracked bounds, with a
    // little padding, so the placed sticker isn't a mostly-empty box.
    const padding = 12;

    const cropX = clamp(inkMinX - padding, 0, padCssW);
    const cropY = clamp(inkMinY - padding, 0, padCssH);
    const cropRight = clamp(inkMaxX + padding, 0, padCssW);
    const cropBottom = clamp(inkMaxY + padding, 0, padCssH);

    const cropW = Math.max(1, cropRight - cropX);
    const cropH = Math.max(1, cropBottom - cropY);

    const out = document.createElement("canvas");
    out.width = Math.round(cropW * padDpr);
    out.height = Math.round(cropH * padDpr);

    out.getContext("2d").drawImage(
      pad,
      cropX * padDpr, cropY * padDpr, cropW * padDpr, cropH * padDpr,
      0, 0, out.width, out.height
    );

    sigCanvas = out;
    sigAspect = out.width / out.height;

    enterPlaceStage();
  });

  overlay.querySelector(".ws-sign-back").addEventListener("click", () => {
    placeSection.hidden = true;
    drawSection.hidden = false;
  });

  overlay.querySelector(".ws-sign-place-done").addEventListener("click", () => {
    if (!sigCanvas || !docImg) {
      close();
      return;
    }

    const out = document.createElement("canvas");
    out.width = docNaturalW;
    out.height = docNaturalH;

    const ctx = out.getContext("2d");
    ctx.drawImage(docImg, 0, 0, docNaturalW, docNaturalH);
    ctx.drawImage(sigCanvas, stickerX, stickerY, stickerW, stickerH);

    const callback = onApply;

    close();

    if (typeof callback === "function") {
      callback(out);
    }
  });

  /* ---------------------------------------------------------
     ENTRY POINT
     --------------------------------------------------------- */

  function close() {
    overlay.classList.remove("show");

    drawSection.hidden = false;
    placeSection.hidden = true;

    onApply = null;
    docImg = null;
    sigCanvas = null;
    dragMode = null;
    dragStart = null;
    hasInk = false;

    padCtx.clearRect(0, 0, pad.width, pad.height);
    resetInkBounds();
  }

  /*
    Opens the signature editor for an image.

      dataUrl   the page image the signature will be placed on
      onApply   receives the composited canvas
  */
  function open({ dataUrl, onApply: callback }) {
    onApply = callback;

    drawSection.hidden = false;
    placeSection.hidden = true;

    hasInk = false;
    resetInkBounds();

    overlay.classList.add("show");

    // Layout must settle before the pad's real rendered size is known.
    requestAnimationFrame(sizePad);

    const img = new Image();

    img.onload = () => {
      docImg = img;
      docNaturalW = img.naturalWidth;
      docNaturalH = img.naturalHeight;
      docImageEl.src = dataUrl;
    };

    img.onerror = () => {
      console.warn("Signature editor could not load the document image.");
      close();
    };

    img.src = dataUrl;
  }

  window.WebScanSignature = { open };
})();
