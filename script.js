"use strict";
/*
=========================================================
 WebScan - Step 3
 Real-time Document Detection
=========================================================
*/
/* =========================================================
   DOM
   ========================================================= */
const video =
  document.getElementById("video");
const canvas =
  document.createElement("canvas");
const filterCanvas =
  document.getElementById("filterCanvas");
const scannerOverlay =
  document.getElementById(
    "scannerOverlay"
  );
const overlayCtx =
  scannerOverlay.getContext("2d");
const cameraSection =
  document.getElementById(
    "cameraSection"
  );
const cropSection =
  document.getElementById(
    "cropSection"
  );
const filterSection =
  document.getElementById(
    "filterSection"
  );
const captureBtn =
  document.getElementById(
    "captureBtn"
  );
const pdfBtn =
  document.getElementById(
    "pdfBtn"
  );
const cancelCropBtn =
  document.getElementById(
    "cancelCropBtn"
  );
const applyCropBtn =
  document.getElementById(
    "applyCropBtn"
  );
const backToCropBtn =
  document.getElementById(
    "backToCropBtn"
  );
const saveFilterBtn =
  document.getElementById(
    "saveFilterBtn"
  );
const mainControls =
  document.getElementById(
    "mainControls"
  );
const cropControls =
  document.getElementById(
    "cropControls"
  );
const filterControls =
  document.getElementById(
    "filterControls"
  );
const gallery =
  document.getElementById(
    "gallery"
  );
const pageCount =
  document.getElementById(
    "pageCount"
  );
const statusDiv =
  document.getElementById(
    "status"
  );
const cameraPlaceholder =
  document.getElementById(
    "cameraPlaceholder"
  );
const flashEffect =
  document.getElementById(
    "flashEffect"
  );
const cropImage =
  document.getElementById(
    "cropImage"
  );
const detectionStatus =
  document.getElementById(
    "detectionStatus"
  );
const detectionDot =
  document.getElementById(
    "detectionDot"
  );
const detectionText =
  document.getElementById(
    "detectionText"
  );
const scannerGuide =
  document.querySelector(
    ".scanner-guide"
  );
const errorMessage =
  document.getElementById(
    "errorMessage"
  );
const errorTitle =
  document.getElementById(
    "errorTitle"
  );
const errorText =
  document.getElementById(
    "errorText"
  );
const dismissErrorBtn =
  document.getElementById(
    "dismissErrorBtn"
  );
const filterBtns =
  document.querySelectorAll(
    ".filter-btn"
  );
const pdfNameModal =
  document.getElementById(
    "pdfNameModal"
  );
const pdfNameInput =
  document.getElementById(
    "pdfNameInput"
  );
const cancelPdfBtn =
  document.getElementById(
    "cancelPdfBtn"
  );
const confirmPdfBtn =
  document.getElementById(
    "confirmPdfBtn"
  );
const closePdfModalBtn =
  document.getElementById(
    "closePdfModalBtn"
  );
/* =========================================================
   STATE
   ========================================================= */
let cameraStream = null;
let isCameraReady = false;
let isOpenCvReady = false;
let detectionTimer = null;
let detectionBusy = false;
let documentDetected = false;
let stableDetectionFrames = 0;
let lastDetectedCorners = null;
let scannedImages = [];
let cropper = null;
let originalCroppedMat = null;
let currentFilter = "magic";
/*
  Detection configuration
*/
const DETECTION_INTERVAL = 180;
const REQUIRED_STABLE_FRAMES = 2;
/* =========================================================
   OPENCV
   ========================================================= */
function onOpenCvReady() {
  if (
    typeof cv ===
    "undefined"
  ) {
    onOpenCvError();
    return;
  }
  /*
    OpenCV sometimes loads the script
    before the WASM runtime is ready.
  */
  if (cv["onRuntimeInitialized"] !== undefined) {
    const previous =
      cv["onRuntimeInitialized"];
    cv["onRuntimeInitialized"] =
      function () {
        if (typeof previous === "function") {
          previous();
        }
        finishOpenCvReady();
      };
  } else {
    finishOpenCvReady();
  }
}
function finishOpenCvReady() {
  if (isOpenCvReady) {
    return;
  }
  isOpenCvReady = true;
  setStatus(
    "ready",
    '<i class="fa-solid fa-check-circle"></i>' +
    "<span>Smart Scanner Ready</span>",
    true
  );
  updateCaptureAvailability();
  if (isCameraReady) {
    startDetectionLoop();
  }
}
function onOpenCvError() {
  isOpenCvReady = false;
  setStatus(
    "error",
    '<i class="fa-solid fa-triangle-exclamation"></i>' +
    "<span>Scanner engine unavailable</span>"
  );
  showError(
    "Scanner engine unavailable",
    "OpenCV load করা যায়নি। Internet connection check করে page reload করুন।"
  );
}
/* =========================================================
   STATUS
   ========================================================= */
function setStatus(
  type,
  message,
  autoHide = false
) {
  if (!statusDiv) {
    return;
  }
  statusDiv.className =
    "status";
  if (type === "loading") {
    statusDiv.classList.add(
      "status-loading"
    );
  }
  if (type === "ready") {
    statusDiv.classList.add(
      "status-ready"
    );
  }
  if (type === "error") {
    statusDiv.classList.add(
      "status-error"
    );
  }
  statusDiv.innerHTML =
    message;
  if (autoHide) {
    setTimeout(() => {
      statusDiv.classList.add(
        "status-hidden"
      );
    }, 3000);
  } else {
    statusDiv.classList.remove(
      "status-hidden"
    );
  }
}
function showError(
  title,
  message
) {
  errorTitle.textContent =
    title;
  errorText.textContent =
    message;
  errorMessage.hidden =
    false;
}
function hideError() {
  errorMessage.hidden =
    true;
}
function updateCaptureAvailability() {
  captureBtn.disabled =
    !(
      isCameraReady &&
      isOpenCvReady
    );
}
/* =========================================================
   CAMERA
   ========================================================= */
async function startCamera() {
  hideError();
  if (
    !navigator.mediaDevices ||
    !navigator.mediaDevices.getUserMedia
  ) {
    showError(
      "Camera not supported",
      "এই browser camera access support করে না।"
    );
    return;
  }
  stopCamera();
  cameraPlaceholder.hidden =
    false;
  setStatus(
    "loading",
    '<i class="fa-solid fa-spinner fa-spin"></i>' +
    "<span>Camera starting...</span>"
  );
  try {
    cameraStream =
      await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: {
            ideal: "environment"
          },
          width: {
            ideal: 1920
          },
          height: {
            ideal: 1080
          },
          frameRate: {
            ideal: 30,
            max: 30
          }
        }
      });
    video.srcObject =
      cameraStream;
    await waitForVideoReady();
    isCameraReady =
      true;
    cameraPlaceholder.hidden =
      true;
    setStatus(
      "ready",
      '<i class="fa-solid fa-camera"></i>' +
      "<span>Camera Ready</span>",
      true
    );
    updateCaptureAvailability();
    if (isOpenCvReady) {
      startDetectionLoop();
    }
  } catch (error) {
    console.error(
      "Camera error:",
      error
    );
    isCameraReady =
      false;
    handleCameraError(
      error
    );
    updateCaptureAvailability();
  }
}
function waitForVideoReady() {
  return new Promise(
    (resolve, reject) => {
      if (
        video.readyState >=
        HTMLMediaElement.HAVE_METADATA
      ) {
        resolve();
        return;
      }
      const timeout =
        setTimeout(() => {
          cleanup();
          reject(
            new Error(
              "Camera preview timeout."
            )
          );
        }, 10000);
      function cleanup() {
        clearTimeout(
          timeout
        );
        video.removeEventListener(
          "loadedmetadata",
          loaded
        );
      }
      function loaded() {
        cleanup();
        resolve();
      }
      video.addEventListener(
        "loadedmetadata",
        loaded,
        {
          once: true
        }
      );
    }
  );
}
function handleCameraError(
  error
) {
  cameraPlaceholder.hidden =
    false;
  let title =
    "Camera চালু করা যাচ্ছে না";
  let message =
    "Camera permission check করুন।";
  if (
    error?.name ===
    "NotAllowedError"
  ) {
    title =
      "Camera permission required";
    message =
      "Browser settings থেকে Camera permission Allow করুন।";
  }
  if (
    error?.name ===
    "NotFoundError"
  ) {
    title =
      "Camera পাওয়া যায়নি";
    message =
      "কোনো compatible camera পাওয়া যায়নি।";
  }
  if (
    error?.name ===
    "NotReadableError"
  ) {
    title =
      "Camera busy";
    message =
      "অন্য application camera ব্যবহার করছে। সেটি বন্ধ করে আবার চেষ্টা করুন।";
  }
  if (
    error?.name ===
    "SecurityError"
  ) {
    title =
      "Secure connection required";
    message =
      "Camera ব্যবহারের জন্য HTTPS অথবা localhost ব্যবহার করুন।";
  }
  setStatus(
    "error",
    '<i class="fa-solid fa-camera-slash"></i>' +
    "<span>Camera Error</span>"
  );
  showError(
    title,
    message
  );
}
function stopCamera() {
  stopDetectionLoop();
  if (cameraStream) {
    cameraStream
      .getTracks()
      .forEach(
        (track) => {
          try {
            track.stop();
          } catch (_) {}
        }
      );
  }
  cameraStream =
    null;
  video.srcObject =
    null;
  isCameraReady =
    false;
}
/* =========================================================
   REAL-TIME DETECTION LOOP
   ========================================================= */
function startDetectionLoop() {
  stopDetectionLoop();
  detectionTimer =
    setInterval(
      runRealtimeDetection,
      DETECTION_INTERVAL
    );
}
function stopDetectionLoop() {
  if (detectionTimer) {
    clearInterval(
      detectionTimer
    );
    detectionTimer =
      null;
  }
}
async function runRealtimeDetection() {
  if (
    detectionBusy ||
    !isCameraReady ||
    !isOpenCvReady ||
    cameraSection.hidden
  ) {
    return;
  }
  if (
    !video.videoWidth ||
    !video.videoHeight
  ) {
    return;
  }
  detectionBusy =
    true;
  try {
    const width =
      Math.min(
        960,
        video.videoWidth
      );
    const scale =
      width /
      video.videoWidth;
    const height =
      Math.round(
        video.videoHeight *
        scale
      );
    canvas.width =
      width;
    canvas.height =
      height;
    const tempCtx =
      canvas.getContext(
        "2d",
        {
          willReadFrequently: true
        }
      );
    tempCtx.drawImage(
      video,
      0,
      0,
      width,
      height
    );
    const frame =
      cv.imread(
        canvas
      );
    const detection =
      detectDocument(
        frame
      );
    if (detection) {
      const scaledCorners =
        detection.corners;
      /*
        Convert detection coordinates
        from processing frame to
        displayed video coordinates.
      */
      const displayCorners =
        scaledCorners.map(
          (point) => ({
            x:
              point.x /
              scale,
            y:
              point.y /
              scale
          })
        );
      stableDetectionFrames++;
      if (
        stableDetectionFrames >=
        REQUIRED_STABLE_FRAMES
      ) {
        documentDetected =
          true;
        lastDetectedCorners =
          displayCorners;
        setDetectionReady(
          displayCorners
        );
      }
    } else {
      stableDetectionFrames =
        Math.max(
          0,
          stableDetectionFrames - 1
        );
      if (
        stableDetectionFrames ===
        0
      ) {
        documentDetected =
          false;
        lastDetectedCorners =
          null;
        setDetectionSearching();
      }
    }
    frame.delete();
  } catch (error) {
    console.warn(
      "Realtime detection:",
      error
    );
  } finally {
    detectionBusy =
      false;
  }
}
/* =========================================================
   DETECTION UI
   ========================================================= */
function setDetectionSearching() {
  detectionStatus.classList.remove(
    "ready"
  );
  detectionText.textContent =
    "Looking for document...";
  scannerGuide.classList.remove(
    "detected"
  );
  clearOverlay();
}
function setDetectionReady(
  corners
) {
  detectionStatus.classList.add(
    "ready"
  );
  detectionText.textContent =
    "Document ready";
  scannerGuide.classList.add(
    "detected"
  );
  drawDetectedDocument(
    corners
  );
}
function clearOverlay() {
  overlayCtx.clearRect(
    0,
    0,
    scannerOverlay.width,
    scannerOverlay.height
  );
}
function resizeOverlay() {
  const rect =
    video.getBoundingClientRect();
  const dpr =
    Math.min(
      window.devicePixelRatio || 1,
      2
    );
  scannerOverlay.width =
    Math.round(
      rect.width * dpr
    );
  scannerOverlay.height =
    Math.round(
      rect.height * dpr
    );
  scannerOverlay.style.width =
    `${rect.width}px`;
  scannerOverlay.style.height =
    `${rect.height}px`;
  overlayCtx.setTransform(
    dpr,
    0,
    0,
    dpr,
    0,
    0
  );
}
function drawDetectedDocument(
  corners
) {
  if (
    !corners ||
    corners.length !== 4
  ) {
    return;
  }
  resizeOverlay();
  clearOverlay();
  const videoRect =
    video.getBoundingClientRect();
  const videoWidth =
    video.videoWidth;
  const videoHeight =
    video.videoHeight;
  /*
    Because object-fit: cover is used,
    calculate the visible video crop.
  */
  const scale =
    Math.max(
      videoRect.width /
        videoWidth,
      videoRect.height /
        videoHeight
    );
  const renderedWidth =
    videoWidth *
    scale;
  const renderedHeight =
    videoHeight *
    scale;
  const offsetX =
    (
      videoRect.width -
      renderedWidth
    ) / 2;
  const offsetY =
    (
      videoRect.height -
      renderedHeight
    ) / 2;
  const points =
    corners.map(
      (point) => ({
        x:
          point.x *
            scale +
          offsetX,
        y:
          point.y *
            scale +
          offsetY
      })
    );
  overlayCtx.beginPath();
  overlayCtx.moveTo(
    points[0].x,
    points[0].y
  );
  for (
    let i = 1;
    i < points.length;
    i++
  ) {
    overlayCtx.lineTo(
      points[i].x,
      points[i].y
    );
  }
  overlayCtx.closePath();
  /*
    Soft translucent fill.
  */
  overlayCtx.fillStyle =
    "rgba(53, 232, 155, 0.10)";
  overlayCtx.fill();
  /*
    Document border.
  */
  overlayCtx.strokeStyle =
    "#35e89b";
  overlayCtx.lineWidth =
    3;
  overlayCtx.shadowColor =
    "rgba(53, 232, 155, 0.5)";
  overlayCtx.shadowBlur =
    10;
  overlayCtx.stroke();
  overlayCtx.shadowBlur =
    0;
  /*
    Corner markers.
  */
  points.forEach(
    (point) => {
      overlayCtx.beginPath();
      overlayCtx.arc(
        point.x,
        point.y,
        6,
        0,
        Math.PI * 2
      );
      overlayCtx.fillStyle =
        "#35e89b";
      overlayCtx.fill();
    }
  );
}
/* =========================================================
   DOCUMENT DETECTION
   ========================================================= */
function detectDocument(
  src
) {
  let working =
    null;
  let gray =
    null;
  let blurred =
    null;
  let edges =
    null;
  let contours =
    null;
  let hierarchy =
    null;
  try {
    working =
      resizeForDetection(
        src,
        900
      );
    gray =
      new cv.Mat();
    blurred =
      new cv.Mat();
    edges =
      new cv.Mat();
    contours =
      new cv.MatVector();
    hierarchy =
      new cv.Mat();
    cv.cvtColor(
      working,
      gray,
      cv.COLOR_RGBA2GRAY
    );
    cv.GaussianBlur(
      gray,
      blurred,
      new cv.Size(
        5,
        5
      ),
      0
    );
    cv.Canny(
      blurred,
      edges,
      50,
      150
    );
    const kernel =
      cv.Mat.ones(
        5,
        5,
        cv.CV_8U
      );
    cv.morphologyEx(
      edges,
      edges,
      cv.MORPH_CLOSE,
      kernel
    );
    kernel.delete();
    cv.findContours(
      edges,
      contours,
      hierarchy,
      cv.RETR_LIST,
      cv.CHAIN_APPROX_SIMPLE
    );
    const imageArea =
      working.rows *
      working.cols;
    let best =
      null;
    const maxContours =
      Math.min(
        contours.size(),
        20
      );
    for (
      let i = 0;
      i < maxContours;
      i++
    ) {
      const contour =
        contours.get(i);
      const area =
        Math.abs(
          cv.contourArea(
            contour
          )
        );
      if (
        area <
        imageArea * 0.08
      ) {
        contour.delete();
        continue;
      }
      const perimeter =
        cv.arcLength(
          contour,
          true
        );
      const approx =
        new cv.Mat();
      cv.approxPolyDP(
        contour,
        approx,
        0.02 *
          perimeter,
        true
      );
      if (
        approx.rows === 4 &&
        cv.isContourConvex(
          approx
        )
      ) {
        const points =
          matToPoints(
            approx
          );
        const ordered =
          orderCorners(
            points
          );
        const polygonAreaValue =
          polygonArea(
            ordered
          );
        const rectangularity =
          calculateRectangularity(
            ordered
          );
        const areaRatio =
          polygonAreaValue /
          imageArea;
        /*
          Ignore tiny or almost-full-frame
          contours.
        */
        if (
          areaRatio >= 0.10 &&
          areaRatio <= 0.92
        ) {
          const score =
            (
              Math.min(
                areaRatio /
                  0.55,
                1
              ) *
              0.7
            ) +
            (
              rectangularity *
              0.3
            );
          if (
            !best ||
            score >
              best.score
          ) {
            best = {
              corners:
                scalePointsToOriginal(
                  ordered,
                  src.cols,
                  src.rows,
                  working.cols,
                  working.rows
                ),
              score
            };
          }
        }
      }
      approx.delete();
      contour.delete();
    }
    return best;
  } catch (error) {
    console.warn(
      "Document detection failed:",
      error
    );
    return null;
  } finally {
    if (working) {
      working.delete();
    }
    if (gray) {
      gray.delete();
    }
    if (blurred) {
      blurred.delete();
    }
    if (edges) {
      edges.delete();
    }
    if (contours) {
      contours.delete();
    }
    if (hierarchy) {
      hierarchy.delete();
    }
  }
}
/* =========================================================
   DETECTION HELPERS
   ========================================================= */
function resizeForDetection(
  src,
  maxDimension
) {
  const scale =
    Math.min(
      1,
      maxDimension /
        Math.max(
          src.cols,
          src.rows
        )
    );
  if (scale >= 1) {
    return src.clone();
  }
  const width =
    Math.max(
      1,
      Math.round(
        src.cols *
          scale
      )
    );
  const height =
    Math.max(
      1,
      Math.round(
        src.rows *
          scale
      )
    );
  const dst =
    new cv.Mat();
  cv.resize(
    src,
    dst,
    new cv.Size(
      width,
      height
    ),
    0,
    0,
    cv.INTER_AREA
  );
  return dst;
}
function matToPoints(
  mat
) {
  const points =
    [];
  for (
    let i = 0;
    i < mat.rows;
    i++
  ) {
    const x =
      mat.intAt(
        i,
        0
      );
    const y =
      mat.intAt(
        i,
        1
      );
    points.push({
      x,
      y
    });
  }
  return points;
}
function orderCorners(
  points
) {
  if (
    !points ||
    points.length !== 4
  ) {
    return null;
  }
  const sums =
    points.map(
      (p) =>
        p.x + p.y
    );
  const diffs =
    points.map(
      (p) =>
        p.x - p.y
    );
  return [
    points[
      indexOfMin(sums)
    ],
    points[
      indexOfMax(diffs)
    ],
    points[
      indexOfMax(sums)
    ],
    points[
      indexOfMin(diffs)
    ]
  ];
}
function indexOfMin(
  array
) {
  let index = 0;
  for (
    let i = 1;
    i < array.length;
    i++
  ) {
    if (
      array[i] <
      array[index]
    ) {
      index = i;
    }
  }
  return index;
}
function indexOfMax(
  array
) {
  let index = 0;
  for (
    let i = 1;
    i < array.length;
    i++
  ) {
    if (
      array[i] >
      array[index]
    ) {
      index = i;
    }
  }
  return index;
}
function distance(
  a,
  b
) {
  return Math.hypot(
    a.x - b.x,
    a.y - b.y
  );
}
function polygonArea(
  points
) {
  if (
    !points ||
    points.length !== 4
  ) {
    return 0;
  }
  let area = 0;
  for (
    let i = 0;
    i < 4;
    i++
  ) {
    const current =
      points[i];
    const next =
      points[
        (i + 1) % 4
      ];
    area +=
      current.x *
        next.y -
      next.x *
        current.y;
  }
  return Math.abs(
    area
  ) / 2;
}
function calculateRectangularity(
  points
) {
  if (
    !points ||
    points.length !== 4
  ) {
    return 0;
  }
  const top =
    distance(
      points[0],
      points[1]
    );
  const right =
    distance(
      points[1],
      points[2]
    );
  const bottom =
    distance(
      points[2],
      points[3]
    );
  const left =
    distance(
      points[3],
      points[0]
    );
  if (
    top <= 0 ||
    right <= 0 ||
    bottom <= 0 ||
    left <= 0
  ) {
    return 0;
  }
  const widthRatio =
    Math.min(
      top,
      bottom
    ) /
    Math.max(
      top,
      bottom
    );
  const heightRatio =
    Math.min(
      left,
      right
    ) /
    Math.max(
      left,
      right
    );
  return (
    widthRatio *
    heightRatio
  );
}
function scalePointsToOriginal(
  points,
  originalWidth,
  originalHeight,
  workingWidth,
  workingHeight
) {
  const scaleX =
    originalWidth /
    workingWidth;
  const scaleY =
    originalHeight /
    workingHeight;
  return points.map(
    (point) => ({
      x:
        point.x *
        scaleX,
      y:
        point.y *
        scaleY
    })
  );
}
/* =========================================================
   CAPTURE
   ========================================================= */
async function captureImage() {
  hideError();
  if (
    !isCameraReady
  ) {
    return;
  }
  try {
    captureBtn.disabled =
      true;
    triggerFlash();
    canvas.width =
      video.videoWidth;
    canvas.height =
      video.videoHeight;
    const context =
      canvas.getContext(
        "2d"
      );
    context.drawImage(
      video,
      0,
      0,
      canvas.width,
      canvas.height
    );
    const captured =
      cv.imread(
        canvas
      );
    if (
      captured.empty()
    ) {
      throw new Error(
        "Camera image unavailable."
      );
    }
    setStatus(
      "loading",
      '<i class="fa-solid fa-spinner fa-spin"></i>' +
      "<span>Processing document...</span>"
    );
    await nextFrame();
    let corners =
      lastDetectedCorners;
    /*
      If real-time detection is
      unavailable, detect again.
    */
    if (
      !corners
    ) {
      const detection =
        detectDocument(
          captured
        );
      if (detection) {
        corners =
          detection.corners;
      }
    }
    if (corners) {
      const corrected =
        perspectiveCorrect(
          captured,
          corners
        );
      captured.delete();
      if (
        !corrected ||
        corrected.empty()
      ) {
        throw new Error(
          "Perspective correction failed."
        );
      }
      const tempCanvas =
        document.createElement(
          "canvas"
        );
      cv.imshow(
        tempCanvas,
        corrected
      );
      const imageUrl =
        tempCanvas.toDataURL(
          "image/jpeg",
          0.94
        );
      corrected.delete();
      await openManualCrop(
        imageUrl,
        true
      );
    } else {
      const imageUrl =
        canvas.toDataURL(
          "image/jpeg",
          0.94
        );
      captured.delete();
      await openManualCrop(
        imageUrl,
        false
      );
    }
  } catch (error) {
    console.error(
      "Capture error:",
      error
    );
    showError(
      "Scan failed",
      "Document scan করা যায়নি। আবার চেষ্টা করুন।"
    );
  } finally {
    updateCaptureAvailability();
  }
}
function triggerFlash() {
  flashEffect.classList.remove(
    "flash-active"
  );
  void flashEffect.offsetWidth;
  flashEffect.classList.add(
    "flash-active"
  );
}
function nextFrame() {
  return new Promise(
    (resolve) => {
      requestAnimationFrame(
        () => {
          requestAnimationFrame(
            resolve
          );
        }
      );
    }
  );
}
/* =========================================================
   PERSPECTIVE
   ========================================================= */
function perspectiveCorrect(
  src,
  corners
) {
  const tl =
    corners[0];
  const tr =
    corners[1];
  const br =
    corners[2];
  const bl =
    corners[3];
  const topWidth =
    distance(
      tl,
      tr
    );
  const bottomWidth =
    distance(
      bl,
      br
    );
  const leftHeight =
    distance(
      tl,
      bl
    );
  const rightHeight =
    distance(
      tr,
      br
    );
  let width =
    Math.round(
      Math.max(
        topWidth,
        bottomWidth
      )
    );
  let height =
    Math.round(
      Math.max(
        leftHeight,
        rightHeight
      )
    );
  const maxSize =
    2200;
  const scale =
    Math.min(
      1,
      maxSize /
        Math.max(
          width,
          height
        )
    );
  width =
    Math.max(
      1,
      Math.round(
        width * scale
      )
    );
  height =
    Math.max(
      1,
      Math.round(
        height * scale
      )
    );
  const srcPoints =
    cv.matFromArray(
      4,
      1,
      cv.CV_32FC2,
      [
        tl.x,
        tl.y,
        tr.x,
        tr.y,
        br.x,
        br.y,
        bl.x,
        bl.y
      ]
    );
  const dstPoints =
    cv.matFromArray(
      4,
      1,
      cv.CV_32FC2,
      [
        0,
        0,
        width,
        0,
        width,
        height,
        0,
        height
      ]
    );
  const matrix =
    cv.getPerspectiveTransform(
      srcPoints,
      dstPoints
    );
  const result =
    new cv.Mat();
  cv.warpPerspective(
    src,
    result,
    matrix,
    new cv.Size(
      width,
      height
    ),
    cv.INTER_LINEAR,
    cv.BORDER_CONSTANT,
    new cv.Scalar(
      255,
      255,
      255,
      255
    )
  );
  srcPoints.delete();
  dstPoints.delete();
  matrix.delete();
  return result;
}
/* =========================================================
   CROP
   ========================================================= */
async function openManualCrop(
  imageUrl,
  autoDetected
) {
  stopDetectionLoop();
  cropImage.src =
    imageUrl;
  await waitForImageLoad(
    cropImage
  );
  cameraSection.hidden =
    true;
  mainControls.hidden =
    true;
  cropSection.hidden =
    false;
  cropControls.hidden =
    false;
  initializeCropper(
    autoDetected
  );
}
function initializeCropper(
  autoDetected
) {
  destroyCropper();
  if (
    typeof Cropper ===
    "undefined"
  ) {
    showError(
      "Cropper unavailable",
      "Cropper.js load হয়নি।"
    );
    return;
  }
  cropper =
    new Cropper(
      cropImage,
      {
        viewMode: 1,
        autoCropArea:
          autoDetected
            ? 0.98
            : 0.90,
        background: false,
        responsive: true,
        guides: true,
        center: true,
        highlight: true,
        movable: true,
        zoomable: true,
        cropBoxMovable: true,
        cropBoxResizable: true
      }
    );
}
function destroyCropper() {
  if (!cropper) {
    return;
  }
  try {
    cropper.destroy();
  } catch (_) {}
  cropper =
    null;
}
/* =========================================================
   APPLY CROP
   ========================================================= */
function applyCrop() {
  if (!cropper) {
    return;
  }
  try {
    const cropped =
      cropper.getCroppedCanvas({
        imageSmoothingEnabled:
          true,
        imageSmoothingQuality:
          "high",
        fillColor:
          "#ffffff"
      });
    cleanupOriginalMat();
    originalCroppedMat =
      cv.imread(
        cropped
      );
    destroyCropper();
    cropSection.hidden =
      true;
    cropControls.hidden =
      true;
    filterSection.hidden =
      false;
    filterControls.hidden =
      false;
    setActiveFilterBtn(
      "magic"
    );
    applyFilter(
      "magic"
    );
  } catch (error) {
    console.error(
      "Crop error:",
      error
    );
    showError(
      "Crop failed",
      "Document crop করা যায়নি।"
    );
  }
}
/* =========================================================
   FILTER
   ========================================================= */
function setActiveFilterBtn(
  type
) {
  filterBtns.forEach(
    (button) => {
      button.classList.toggle(
        "active",
        button.dataset.filter ===
          type
      );
    }
  );
}
function applyFilter(
  type
) {
  if (
    !originalCroppedMat
  ) {
    return;
  }
  let output =
    null;
  try {
    output =
      new cv.Mat();
    if (
      type ===
      "original"
    ) {
      originalCroppedMat.copyTo(
        output
      );
    }
    else if (
      type ===
      "magic"
    ) {
      applyMagicColor(
        originalCroppedMat,
        output
      );
    }
    else if (
      type ===
      "bw"
    ) {
      applyBlackWhite(
        originalCroppedMat,
        output
      );
    }
    cv.imshow(
      filterCanvas,
      output
    );
    currentFilter =
      type;
  } catch (error) {
    console.error(
      "Filter error:",
      error
    );
  } finally {
    if (output) {
      output.delete();
    }
  }
}
function applyMagicColor(
  src,
  dst
) {
  const lab =
    new cv.Mat();
  const channels =
    new cv.MatVector();
  const clahe =
    new cv.CLAHE(
      2.0,
      new cv.Size(
        8,
        8
      )
    );
  try {
    cv.cvtColor(
      src,
      lab,
      cv.COLOR_RGBA2LAB
    );
    cv.split(
      lab,
      channels
    );
    const light =
      channels.get(0);
    clahe.apply(
      light,
      light
    );
    cv.merge(
      channels,
      lab
    );
    cv.cvtColor(
      lab,
      dst,
      cv.COLOR_LAB2RGBA
    );
  } finally {
    lab.delete();
    channels.delete();
    clahe.delete();
  }
}
function applyBlackWhite(
  src,
  dst
) {
  const gray =
    new cv.Mat();
  const blurred =
    new cv.Mat();
  try {
    cv.cvtColor(
      src,
      gray,
      cv.COLOR_RGBA2GRAY
    );
    cv.GaussianBlur(
      gray,
      blurred,
      new cv.Size(
        3,
        3
      ),
      0
    );
    cv.adaptiveThreshold(
      blurred,
      dst,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY,
      21,
      8
    );
  } finally {
    gray.delete();
    blurred.delete();
  }
}
/* =========================================================
   SAVE
   ========================================================= */
function saveCurrentScan() {
  try {
    const image =
      filterCanvas.toDataURL(
        "image/jpeg",
        0.92
      );
    scannedImages.push(
      image
    );
    const img =
      document.createElement(
        "img"
      );
    img.src =
      image;
    img.alt =
      `Scanned page ${scannedImages.length}`;
    gallery.appendChild(
      img
    );
    pageCount.innerHTML =
      '<i class="fa-solid fa-copy"></i>' +
      ` Pages: ${scannedImages.length}`;
    pdfBtn.hidden =
      false;
    cleanupEditing();
    cameraSection.hidden =
      false;
    mainControls.hidden =
      false;
    isCameraReady =
      false;
    startCamera();
  } catch (error) {
    console.error(
      "Save error:",
      error
    );
    showError(
      "Save failed",
      "Page save করা যায়নি।"
    );
  }
}
/* =========================================================
   CLEANUP
   ========================================================= */
function cleanupEditing() {
  destroyCropper();
  cleanupOriginalMat();
  cropImage.removeAttribute(
    "src"
  );
  cropSection.hidden =
    true;
  cropControls.hidden =
    true;
  filterSection.hidden =
    true;
  filterControls.hidden =
    true;
}
function cleanupOriginalMat() {
  if (
    originalCroppedMat
  ) {
    try {
      originalCroppedMat.delete();
    } catch (_) {}
    originalCroppedMat =
      null;
  }
}
/* =========================================================
   PDF
   ========================================================= */
function openPdfModal() {
  if (
    scannedImages.length ===
    0
  ) {
    return;
  }
  pdfNameModal.hidden =
    false;
  setTimeout(
    () => {
      pdfNameInput.focus();
      pdfNameInput.select();
    },
    50
  );
}
function closePdfModal() {
  pdfNameModal.hidden =
    true;
}
function sanitizeFileName(
  name
) {
  return name
    .replace(
      /[<>:"/\\|?*\x00-\x1F]/g,
      "_"
    )
    .replace(
      /\s+/g,
      "_"
    )
    .replace(
      /_+/g,
      "_"
    )
    .replace(
      /^[_\s]+|[_\s]+$/g,
      ""
    )
    .slice(
      0,
      100
    );
}
async function createPdf() {
  if (
    scannedImages.length ===
    0
  ) {
    return;
  }
  if (
    typeof window.jspdf ===
    "undefined"
  ) {
    showError(
      "PDF engine unavailable",
      "jsPDF load হয়নি।"
    );
    return;
  }
  try {
    confirmPdfBtn.disabled =
      true;
    let name =
      sanitizeFileName(
        pdfNameInput.value.trim()
      );
    if (!name) {
      name =
        "WebScan_Document";
    }
    if (
      !name
        .toLowerCase()
        .endsWith(".pdf")
    ) {
      name += ".pdf";
    }
    const {
      jsPDF
    } =
      window.jspdf;
    const first =
      await loadImage(
        scannedImages[0]
      );
    const firstWidth =
      first.naturalWidth ||
      first.width;
    const firstHeight =
      first.naturalHeight ||
      first.height;
    const pdf =
      new jsPDF({
        orientation:
          firstWidth >=
          firstHeight
            ? "landscape"
            : "portrait",
        unit: "px",
        format: [
          firstWidth,
          firstHeight
        ],
        compress: true
      });
    for (
      let i = 0;
      i <
      scannedImages.length;
      i++
    ) {
      const image =
        await loadImage(
          scannedImages[i]
        );
      const width =
        image.naturalWidth ||
        image.width;
      const height =
        image.naturalHeight ||
        image.height;
      if (i > 0) {
        pdf.addPage(
          [
            width,
            height
          ],
          width >= height
            ? "landscape"
            : "portrait"
        );
      }
      pdf.addImage(
        scannedImages[i],
        "JPEG",
        0,
        0,
        width,
        height
      );
    }
    pdf.save(
      name
    );
    closePdfModal();
  } catch (error) {
    console.error(
      "PDF error:",
      error
    );
    showError(
      "PDF failed",
      "PDF তৈরি করা যায়নি।"
    );
  } finally {
    confirmPdfBtn.disabled =
      false;
  }
}
function loadImage(
  src
) {
  return new Promise(
    (resolve, reject) => {
      const image =
        new Image();
      image.onload =
        () =>
          resolve(
            image
          );
      image.onerror =
        () =>
          reject(
            new Error(
              "Image load failed."
            )
          );
      image.src =
        src;
    }
  );
}
/* =========================================================
   EVENTS
   ========================================================= */
captureBtn.addEventListener(
  "click",
  captureImage
);
cancelCropBtn.addEventListener(
  "click",
  () => {
    cleanupEditing();
    cameraSection.hidden =
      false;
    mainControls.hidden =
      false;
    startCamera();
  }
);
applyCropBtn.addEventListener(
  "click",
  applyCrop
);
backToCropBtn.addEventListener(
  "click",
  () => {
    filterSection.hidden =
      true;
    filterControls.hidden =
      true;
    cropSection.hidden =
      false;
    cropControls.hidden =
      false;
    initializeCropper(
      false
    );
  }
);
saveFilterBtn.addEventListener(
  "click",
  saveCurrentScan
);
filterBtns.forEach(
  (button) => {
    button.addEventListener(
      "click",
      () => {
        const type =
          button.dataset.filter;
        setActiveFilterBtn(
          type
        );
        applyFilter(
          type
        );
      }
    );
  }
);
pdfBtn.addEventListener(
  "click",
  openPdfModal
);
cancelPdfBtn.addEventListener(
  "click",
  closePdfModal
);
closePdfModalBtn.addEventListener(
  "click",
  closePdfModal
);
dismissErrorBtn.addEventListener(
  "click",
  hideError
);
confirmPdfBtn.addEventListener(
  "click",
  createPdf
);
pdfNameInput.addEventListener(
  "keydown",
  (event) => {
    if (
      event.key ===
      "Enter"
    ) {
      createPdf();
    }
    if (
      event.key ===
      "Escape"
    ) {
      closePdfModal();
    }
  }
);
/* =========================================================
   RESIZE / VISIBILITY
   ========================================================= */
window.addEventListener(
  "resize",
  () => {
    if (
      documentDetected &&
      lastDetectedCorners
    ) {
      drawDetectedDocument(
        lastDetectedCorners
      );
    }
  }
);
document.addEventListener(
  "visibilitychange",
  () => {
    if (
      document.visibilityState ===
      "hidden"
    ) {
      stopCamera();
    }
    else if (
      document.visibilityState ===
        "visible" &&
      !cameraSection.hidden
    ) {
      startCamera();
    }
  }
);
window.addEventListener(
  "beforeunload",
  () => {
    stopCamera();
    destroyCropper();
    cleanupOriginalMat();
  }
);
/* =========================================================
   IMAGE LOAD
   ========================================================= */
function waitForImageLoad(
  image
) {
  return new Promise(
    (resolve, reject) => {
      if (
        image.complete &&
        image.naturalWidth
      ) {
        resolve();
        return;
      }
      image.onload =
        () => resolve();
      image.onerror =
        () =>
          reject(
            new Error(
              "Image load failed."
            )
          );
    }
  );
}
/* =========================================================
   INITIAL
   ========================================================= */
captureBtn.disabled =
  true;
setDetectionSearching();
setStatus(
  "loading",
  '<i class="fa-solid fa-spinner fa-spin"></i>' +
  "<span>Loading Smart Scanner...</span>"
);
/*
  Start camera after DOM is ready.
*/
window.addEventListener(
  "load",
  () => {
    startCamera();
  }
);
