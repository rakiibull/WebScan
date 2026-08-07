"use strict";

/* =========================================================
   WebScan Pro
   Step 2 - Smart Document Scanner Engine

   Features:
   - Camera handling
   - OpenCV readiness
   - Automatic document detection
   - 4-corner detection
   - Perspective correction
   - Manual crop fallback
   - Magic Color / Original / B&W
   - Multi-page gallery
   - PDF export
   ========================================================= */


/* =========================================================
   DOM
   ========================================================= */

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const filterCanvas = document.getElementById("filterCanvas");

const ctx = canvas.getContext("2d");

const cameraSection = document.getElementById("cameraSection");
const cropSection = document.getElementById("cropSection");
const filterSection = document.getElementById("filterSection");

const cropImage = document.getElementById("cropImage");
const flashEffect = document.getElementById("flashEffect");
const cameraPlaceholder =
  document.getElementById("cameraPlaceholder");

const captureBtn = document.getElementById("captureBtn");
const pdfBtn = document.getElementById("pdfBtn");

const cancelCropBtn =
  document.getElementById("cancelCropBtn");

const applyCropBtn =
  document.getElementById("applyCropBtn");

const backToCropBtn =
  document.getElementById("backToCropBtn");

const saveFilterBtn =
  document.getElementById("saveFilterBtn");

const mainControls =
  document.getElementById("mainControls");

const cropControls =
  document.getElementById("cropControls");

const filterControls =
  document.getElementById("filterControls");

const gallery =
  document.getElementById("gallery");

const pageCount =
  document.getElementById("pageCount");

const statusDiv =
  document.getElementById("status");

const errorMessage =
  document.getElementById("errorMessage");

const errorTitle =
  document.getElementById("errorTitle");

const errorText =
  document.getElementById("errorText");

const dismissErrorBtn =
  document.getElementById("dismissErrorBtn");

const filterBtns =
  document.querySelectorAll(".filter-btn");


/* PDF */

const pdfNameModal =
  document.getElementById("pdfNameModal");

const pdfNameInput =
  document.getElementById("pdfNameInput");

const cancelPdfBtn =
  document.getElementById("cancelPdfBtn");

const confirmPdfBtn =
  document.getElementById("confirmPdfBtn");

const closePdfModalBtn =
  document.getElementById("closePdfModalBtn");


/* =========================================================
   STATE
   ========================================================= */

let scannedImages = [];

let cameraStream = null;

let isCameraReady = false;
let isOpenCvReady = false;

let cropper = null;

let originalCroppedMat = null;

let currentFilter = "magic";

let lastDetectedCorners = null;


/* =========================================================
   STATUS / ERROR
   ========================================================= */

function setStatus(type, message, autoHide = false) {
  if (!statusDiv) return;

  statusDiv.className = "status";

  if (type === "loading") {
    statusDiv.classList.add("status-loading");
  }

  if (type === "ready") {
    statusDiv.classList.add("status-ready");
  }

  if (type === "error") {
    statusDiv.classList.add("status-error");
  }

  statusDiv.innerHTML = message;

  if (autoHide) {
    setTimeout(() => {
      statusDiv.classList.add("status-hidden");
    }, 3000);
  } else {
    statusDiv.classList.remove("status-hidden");
  }
}


function showError(title, message) {
  errorTitle.textContent = title;
  errorText.textContent = message;
  errorMessage.hidden = false;
}


function hideError() {
  errorMessage.hidden = true;
}


function updateCaptureAvailability() {
  captureBtn.disabled =
    !(isCameraReady && isOpenCvReady);
}


/* =========================================================
   OPENCV
   ========================================================= */

function onOpenCvReady() {
  try {
    if (typeof cv === "undefined") {
      onOpenCvError();
      return;
    }

    isOpenCvReady = true;

    setStatus(
      "ready",
      '<i class="fas fa-check-circle"></i>' +
      "<span>Smart Scanner Ready</span>",
      true
    );

    updateCaptureAvailability();

  } catch (error) {
    console.error(
      "OpenCV initialization error:",
      error
    );

    onOpenCvError();
  }
}


function onOpenCvError() {
  isOpenCvReady = false;

  setStatus(
    "error",
    '<i class="fas fa-triangle-exclamation"></i>' +
    "<span>Scanner Engine Failed</span>"
  );

  showError(
    "Scanner engine unavailable",
    "OpenCV load করা যায়নি। Internet connection check করে page reload করুন।"
  );

  updateCaptureAvailability();
}


/* =========================================================
   CAMERA
   ========================================================= */

function isValidCameraEnvironment() {
  if (
    !navigator.mediaDevices ||
    !navigator.mediaDevices.getUserMedia
  ) {
    showError(
      "Camera not supported",
      "এই browser/device camera access support করে না।"
    );

    return false;
  }

  return true;
}


async function startCamera() {
  hideError();

  if (!isValidCameraEnvironment()) {
    return;
  }

  stopCamera();

  cameraPlaceholder.hidden = false;

  setStatus(
    "loading",
    '<i class="fas fa-spinner fa-spin"></i>' +
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

    video.srcObject = cameraStream;

    await waitForVideoReady();

    isCameraReady = true;

    cameraPlaceholder.hidden = true;

    setStatus(
      "ready",
      '<i class="fas fa-camera"></i>' +
      "<span>Camera Ready</span>",
      true
    );

    updateCaptureAvailability();

  } catch (error) {
    console.error(
      "Camera error:",
      error
    );

    isCameraReady = false;

    handleCameraError(error);

    updateCaptureAvailability();
  }
}


function waitForVideoReady() {
  return new Promise((resolve, reject) => {
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
      clearTimeout(timeout);

      video.removeEventListener(
        "loadedmetadata",
        handleLoadedMetadata
      );
    }

    function handleLoadedMetadata() {
      cleanup();
      resolve();
    }

    video.addEventListener(
      "loadedmetadata",
      handleLoadedMetadata,
      { once: true }
    );
  });
}


function handleCameraError(error) {
  cameraPlaceholder.hidden = false;

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
      "Camera permission denied হয়েছে। Browser settings থেকে Camera permission Allow করুন।";
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
      "অন্য কোনো application camera ব্যবহার করছে। সেটি বন্ধ করে আবার চেষ্টা করুন।";
  }

  if (
    error?.name ===
    "SecurityError"
  ) {
    title =
      "Secure connection required";

    message =
      "Camera ব্যবহার করার জন্য HTTPS অথবা localhost ব্যবহার করুন।";
  }

  setStatus(
    "error",
    '<i class="fas fa-camera-slash"></i>' +
    "<span>Camera Error</span>"
  );

  showError(
    title,
    message
  );
}


function stopCamera() {
  if (cameraStream) {
    cameraStream
      .getTracks()
      .forEach((track) => {
        try {
          track.stop();
        } catch (error) {
          console.warn(
            "Camera track cleanup failed:",
            error
          );
        }
      });
  }

  cameraStream = null;

  video.srcObject = null;

  isCameraReady = false;

  updateCaptureAvailability();
}


/* =========================================================
   CAPTURE
   ========================================================= */

async function captureImage() {
  hideError();

  if (!isCameraReady) {
    showError(
      "Camera not ready",
      "Camera প্রস্তুত হওয়া পর্যন্ত অপেক্ষা করুন।"
    );

    return;
  }

  if (!isOpenCvReady) {
    showError(
      "Scanner engine not ready",
      "Smart scanner engine এখনও প্রস্তুত হচ্ছে।"
    );

    return;
  }

  if (
    !video.videoWidth ||
    !video.videoHeight
  ) {
    showError(
      "Camera frame unavailable",
      "Camera frame পাওয়া যায়নি। আবার চেষ্টা করুন।"
    );

    return;
  }

  try {
    captureBtn.disabled = true;

    triggerFlash();

    canvas.width =
      video.videoWidth;

    canvas.height =
      video.videoHeight;

    ctx.drawImage(
      video,
      0,
      0,
      canvas.width,
      canvas.height
    );

    const capturedMat =
      cv.imread(canvas);

    if (
      !capturedMat ||
      capturedMat.empty()
    ) {
      throw new Error(
        "Could not read camera image."
      );
    }

    setStatus(
      "loading",
      '<i class="fas fa-spinner fa-spin"></i>' +
      "<span>Document detecting...</span>"
    );

    /*
      Give the browser a small amount of time
      before heavy OpenCV processing.
    */
    await nextFrame();

    const detection =
      detectDocument(capturedMat);

    if (detection) {
      lastDetectedCorners =
        detection.corners;

      setStatus(
        "ready",
        '<i class="fas fa-border-all"></i>' +
        "<span>Document detected</span>",
        true
      );

      const correctedMat =
        perspectiveCorrect(
          capturedMat,
          detection.corners
        );

      capturedMat.delete();

      if (
        !correctedMat ||
        correctedMat.empty()
      ) {
        throw new Error(
          "Perspective correction failed."
        );
      }

      showCorrectedDocument(
        correctedMat
      );

      correctedMat.delete();

    } else {
      /*
        Fallback:
        If automatic detection fails,
        open the normal manual crop editor.
      */

      setStatus(
        "ready",
        '<i class="fas fa-crop-simple"></i>' +
        "<span>Manual crop mode</span>",
        true
      );

      const fallbackUrl =
        canvas.toDataURL(
          "image/jpeg",
          0.92
        );

      capturedMat.delete();

      await openManualCrop(
        fallbackUrl
      );
    }

  } catch (error) {
    console.error(
      "Capture processing error:",
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
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    });
  });
}


/* =========================================================
   DOCUMENT DETECTION
   ========================================================= */

function detectDocument(src) {
  let gray = null;
  let blurred = null;
  let edges = null;
  let contours = null;
  let hierarchy = null;

  try {
    /*
      Resize large images before detection.
      This makes mobile processing much faster.
    */

    const working =
      resizeForDetection(
        src,
        1200
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
      new cv.Size(5, 5),
      0
    );

    cv.Canny(
      blurred,
      edges,
      50,
      150
    );

    /*
      Slightly connect document edges.
    */

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

    let bestCandidate = null;

    /*
      Inspect larger contours first.
    */

    const candidates = [];

    for (
      let i = 0;
      i < contours.size();
      i++
    ) {
      const contour =
        contours.get(i);

      const area =
        Math.abs(
          cv.contourArea(contour)
        );

      if (
        area <
        imageArea * 0.08
      ) {
        contour.delete();
        continue;
      }

      candidates.push({
        contour,
        area
      });
    }

    candidates.sort(
      (a, b) =>
        b.area - a.area
    );

    /*
      Check only the largest candidates.
    */

    const maxCandidates =
      Math.min(
        candidates.length,
        25
      );

    for (
      let i = 0;
      i < maxCandidates;
      i++
    ) {
      const contour =
        candidates[i].contour;

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
        0.02 * perimeter,
        true
      );

      /*
        A document should generally
        produce a quadrilateral.
      */

      if (
        approx.rows === 4 &&
        cv.isContourConvex(approx)
      ) {
        const points =
          matToPoints(approx);

        const ordered =
          orderCorners(points);

        const area =
          polygonArea(ordered);

        const rectangularity =
          calculateRectangularity(
            ordered
          );

        const score =
          scoreDocumentCandidate(
            area,
            imageArea,
            rectangularity
          );

        if (
          !bestCandidate ||
          score >
          bestCandidate.score
        ) {
          bestCandidate = {
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

      approx.delete();
    }

    candidates.forEach(
      (item) => {
        try {
          item.contour.delete();
        } catch (_) {}
      }
    );

    working.delete();

    return bestCandidate;

  } catch (error) {
    console.error(
      "Document detection error:",
      error
    );

    return null;

  } finally {
    if (gray) gray.delete();
    if (blurred) blurred.delete();
    if (edges) edges.delete();
    if (contours) contours.delete();
    if (hierarchy) hierarchy.delete();
  }
}


/* =========================================================
   RESIZE FOR DETECTION
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
        src.cols * scale
      )
    );

  const height =
    Math.max(
      1,
      Math.round(
        src.rows * scale
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


/* =========================================================
   POINT HELPERS
   ========================================================= */

function matToPoints(mat) {
  const points = [];

  for (
    let i = 0;
    i < mat.rows;
    i++
  ) {
    let x = 0;
    let y = 0;

    /*
      OpenCV.js contour matrix
      usually stores points as:
      [x, y]
    */

    try {
      x =
        mat.intAt(
          i,
          0
        );

      y =
        mat.intAt(
          i,
          1
        );
    } catch (_) {
      /*
        Alternative representation.
      */

      const data =
        mat.data32S;

      x =
        data[i * 2];

      y =
        data[i * 2 + 1];
    }

    points.push({
      x,
      y
    });
  }

  return points;
}


function orderCorners(points) {
  if (points.length !== 4) {
    return null;
  }

  const sums =
    points.map(
      (p) => p.x + p.y
    );

  const diffs =
    points.map(
      (p) => p.x - p.y
    );

  const topLeftIndex =
    indexOfMin(sums);

  const bottomRightIndex =
    indexOfMax(sums);

  const topRightIndex =
    indexOfMax(diffs);

  const bottomLeftIndex =
    indexOfMin(diffs);

  return [
    points[topLeftIndex],
    points[topRightIndex],
    points[bottomRightIndex],
    points[bottomLeftIndex]
  ];
}


function indexOfMin(array) {
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


function indexOfMax(array) {
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


/* =========================================================
   GEOMETRY
   ========================================================= */

function polygonArea(points) {
  if (!points || points.length !== 4) {
    return 0;
  }

  let area = 0;

  for (
    let i = 0;
    i < points.length;
    i++
  ) {
    const current =
      points[i];

    const next =
      points[
        (i + 1) %
          points.length
      ];

    area +=
      current.x * next.y -
      next.x * current.y;
  }

  return Math.abs(area) / 2;
}


function distance(a, b) {
  return Math.hypot(
    a.x - b.x,
    a.y - b.y
  );
}


function calculateRectangularity(
  points
) {
  if (!points || points.length !== 4) {
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

  const width =
    (top + bottom) / 2;

  const height =
    (left + right) / 2;

  if (
    width <= 0 ||
    height <= 0
  ) {
    return 0;
  }

  /*
    Compare opposite sides.
  */

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


function scoreDocumentCandidate(
  area,
  imageArea,
  rectangularity
) {
  const areaRatio =
    area / imageArea;

  /*
    Prefer large documents but
    avoid selecting almost the
    entire image border.
  */

  let areaScore =
    Math.min(
      areaRatio / 0.65,
      1
    );

  if (
    areaRatio > 0.95
  ) {
    areaScore *= 0.5;
  }

  return (
    areaScore * 0.7 +
    rectangularity * 0.3
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
   PERSPECTIVE CORRECTION
   ========================================================= */

function perspectiveCorrect(
  src,
  corners
) {
  if (
    !corners ||
    corners.length !== 4
  ) {
    throw new Error(
      "Invalid document corners."
    );
  }

  const tl = corners[0];
  const tr = corners[1];
  const br = corners[2];
  const bl = corners[3];

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

  const maxWidth =
    Math.max(
      topWidth,
      bottomWidth
    );

  const maxHeight =
    Math.max(
      leftHeight,
      rightHeight
    );

  /*
    Prevent extremely large output.
  */

  const MAX_OUTPUT =
    2200;

  let outputWidth =
    Math.round(
      maxWidth
    );

  let outputHeight =
    Math.round(
      maxHeight
    );

  const scale =
    Math.min(
      1,
      MAX_OUTPUT /
        Math.max(
          outputWidth,
          outputHeight
        )
    );

  outputWidth =
    Math.max(
      1,
      Math.round(
        outputWidth * scale
      )
    );

  outputHeight =
    Math.max(
      1,
      Math.round(
        outputHeight * scale
      )
    );

  const srcTri =
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

  const dstTri =
    cv.matFromArray(
      4,
      1,
      cv.CV_32FC2,
      [
        0,
        0,

        outputWidth,
        0,

        outputWidth,
        outputHeight,

        0,
        outputHeight
      ]
    );

  const matrix =
    cv.getPerspectiveTransform(
      srcTri,
      dstTri
    );

  const dst =
    new cv.Mat();

  cv.warpPerspective(
    src,
    dst,
    matrix,
    new cv.Size(
      outputWidth,
      outputHeight
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

  srcTri.delete();
  dstTri.delete();
  matrix.delete();

  return dst;
}


/* =========================================================
   SHOW CORRECTED DOCUMENT
   ========================================================= */

function showCorrectedDocument(
  mat
) {
  const tempCanvas =
    document.createElement(
      "canvas"
    );

  cv.imshow(
    tempCanvas,
    mat
  );

  const dataUrl =
    tempCanvas.toDataURL(
      "image/jpeg",
      0.94
    );

  openManualCrop(
    dataUrl,
    true
  );
}


/* =========================================================
   MANUAL CROP
   ========================================================= */

async function openManualCrop(
  imageUrl,
  autoDetected = false
) {
  cropImage.src =
    imageUrl;

  await waitForImageLoad(
    cropImage
  );

  cameraSection.hidden = true;

  mainControls.hidden = true;

  filterSection.hidden = true;
  filterControls.hidden = true;

  cropSection.hidden = false;
  cropControls.hidden = false;

  initializeCropper(
    autoDetected
  );
}


function initializeCropper(
  autoDetected = false
) {
  destroyCropper();

  if (
    typeof Cropper ===
    "undefined"
  ) {
    showError(
      "Cropper unavailable",
      "Crop editor load হয়নি। Page reload করে আবার চেষ্টা করুন।"
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
            : 0.9,

        background: false,

        responsive: true,

        restore: false,

        guides: true,

        center: true,

        highlight: true,

        movable: true,

        zoomable: true,

        rotatable: false,

        scalable: false,

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
  } catch (error) {
    console.warn(
      "Cropper cleanup failed:",
      error
    );
  }

  cropper = null;
}


/* =========================================================
   APPLY MANUAL CROP
   ========================================================= */

function applyCrop() {
  hideError();

  if (!cropper) {
    showError(
      "Crop editor unavailable",
      "Crop editor পাওয়া যাচ্ছে না।"
    );

    return;
  }

  try {
    applyCropBtn.disabled =
      true;

    const croppedCanvas =
      cropper.getCroppedCanvas({
        imageSmoothingEnabled:
          true,

        imageSmoothingQuality:
          "high",

        fillColor:
          "#ffffff"
      });

    if (
      !croppedCanvas ||
      !croppedCanvas.width ||
      !croppedCanvas.height
    ) {
      throw new Error(
        "Invalid crop canvas."
      );
    }

    cleanupOriginalMat();

    originalCroppedMat =
      cv.imread(
        croppedCanvas
      );

    if (
      originalCroppedMat.empty()
    ) {
      throw new Error(
        "OpenCV image read failed."
      );
    }

    destroyCropper();

    cropSection.hidden =
      true;

    cropControls.hidden =
      true;

    filterSection.hidden =
      false;

    filterControls.hidden =
      false;

    currentFilter =
      "magic";

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
      "Crop processing failed",
      "Document crop করা যায়নি। আবার চেষ্টা করুন।"
    );

  } finally {
    applyCropBtn.disabled =
      false;
  }
}


/* =========================================================
   FILTERS
   ========================================================= */

function setActiveFilterBtn(
  type
) {
  filterBtns.forEach(
    (btn) => {
      btn.classList.toggle(
        "active",
        btn.dataset.filter ===
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
    showError(
      "Image unavailable",
      "Filter করার জন্য image পাওয়া যাচ্ছে না।"
    );

    return;
  }

  let dst = null;

  try {
    currentFilter =
      type;

    dst =
      new cv.Mat();

    if (
      type ===
      "original"
    ) {
      originalCroppedMat.copyTo(
        dst
      );
    }

    else if (
      type ===
      "magic"
    ) {
      applyMagicColor(
        originalCroppedMat,
        dst
      );
    }

    else if (
      type ===
      "bw"
    ) {
      applyBlackWhite(
        originalCroppedMat,
        dst
      );
    }

    else {
      originalCroppedMat.copyTo(
        dst
      );
    }

    cv.imshow(
      filterCanvas,
      dst
    );

  } catch (error) {
    console.error(
      "Filter error:",
      error
    );

    showError(
      "Filter failed",
      "Filter apply করা যায়নি।"
    );

  } finally {
    if (dst) {
      dst.delete();
    }
  }
}


/* =========================================================
   MAGIC COLOR
   ========================================================= */

function applyMagicColor(
  src,
  dst
) {
  /*
    Mild contrast + brightness
    enhancement.

    This intentionally avoids
    aggressive processing so that
    photos remain natural.
  */

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


/* =========================================================
   BLACK & WHITE
   ========================================================= */

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
   BACK TO CROP
   ========================================================= */

function backToCrop() {
  filterSection.hidden =
    true;

  filterControls.hidden =
    true;

  cropSection.hidden =
    false;

  cropControls.hidden =
    false;

  if (
    cropImage.src
  ) {
    initializeCropper();
  }
}


/* =========================================================
   CANCEL CROP
   ========================================================= */

function cancelCrop() {
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

  cameraSection.hidden =
    false;

  mainControls.hidden =
    false;

  hideError();

  updateCaptureAvailability();
}


/* =========================================================
   SAVE PAGE
   ========================================================= */

function saveCurrentScan() {
  hideError();

  if (
    !filterCanvas.width ||
    !filterCanvas.height
  ) {
    showError(
      "Nothing to save",
      "Scanned image পাওয়া যাচ্ছে না।"
    );

    return;
  }

  try {
    saveFilterBtn.disabled =
      true;

    const imageData =
      filterCanvas.toDataURL(
        "image/jpeg",
        0.92
      );

    if (
      !imageData ||
      imageData ===
        "data:,"
    ) {
      throw new Error(
        "Invalid image data."
      );
    }

    scannedImages.push(
      imageData
    );

    updateGallery(
      imageData
    );

    cleanupEditing();

    cameraSection.hidden =
      false;

    mainControls.hidden =
      false;

    setStatus(
      "ready",
      `<i class="fas fa-check-circle"></i>` +
      `<span>Page ${scannedImages.length} saved</span>`,
      true
    );

  } catch (error) {
    console.error(
      "Save error:",
      error
    );

    showError(
      "Save failed",
      "Scanned page save করা যায়নি।"
    );

  } finally {
    saveFilterBtn.disabled =
      false;

    updateCaptureAvailability();
  }
}


function cleanupEditing() {
  filterSection.hidden =
    true;

  filterControls.hidden =
    true;

  cropSection.hidden =
    true;

  cropControls.hidden =
    true;

  destroyCropper();

  cleanupOriginalMat();

  cropImage.removeAttribute(
    "src"
  );

  filterCanvas.width =
    1;

  filterCanvas.height =
    1;
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
   GALLERY
   ========================================================= */

function updateGallery(
  imageSrc
) {
  const img =
    document.createElement(
      "img"
    );

  img.src =
    imageSrc;

  img.alt =
    `Scanned page ${scannedImages.length}`;

  gallery.appendChild(
    img
  );

  pageCount.innerHTML =
    `<i class="fas fa-copy"></i>` +
    ` Pages: ${scannedImages.length}`;

  pdfBtn.hidden =
    false;

  gallery.scrollLeft =
    gallery.scrollWidth;
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

  setTimeout(() => {
    pdfNameInput.focus();
    pdfNameInput.select();
  }, 50);
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
  hideError();

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
      "jsPDF load হয়নি। Page reload করে আবার চেষ্টা করুন।"
    );

    return;
  }

  try {
    confirmPdfBtn.disabled =
      true;

    let fileName =
      sanitizeFileName(
        pdfNameInput.value.trim()
      );

    if (!fileName) {
      fileName =
        "WebScan_Document";
    }

    if (
      !fileName
        .toLowerCase()
        .endsWith(".pdf")
    ) {
      fileName +=
        ".pdf";
    }

    const {
      jsPDF
    } =
      window.jspdf;

    const firstImage =
      await loadImage(
        scannedImages[0]
      );

    const firstWidth =
      firstImage.naturalWidth ||
      firstImage.width;

    const firstHeight =
      firstImage.naturalHeight ||
      firstImage.height;

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
      fileName
    );

    resetScans();

    closePdfModal();

    setStatus(
      "ready",
      '<i class="fas fa-check-circle"></i>' +
      "<span>PDF saved successfully</span>",
      true
    );

  } catch (error) {
    console.error(
      "PDF error:",
      error
    );

    showError(
      "PDF generation failed",
      "PDF তৈরি করা যায়নি। আবার চেষ্টা করুন।"
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
        () => resolve(image);

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


function resetScans() {
  scannedImages = [];

  gallery.innerHTML =
    "";

  pageCount.innerHTML =
    '<i class="fas fa-copy"></i> Pages: 0';

  pdfBtn.hidden =
    true;
}


/* =========================================================
   EVENT LISTENERS
   ========================================================= */

captureBtn.addEventListener(
  "click",
  captureImage
);

cancelCropBtn.addEventListener(
  "click",
  cancelCrop
);

applyCropBtn.addEventListener(
  "click",
  applyCrop
);

backToCropBtn.addEventListener(
  "click",
  backToCrop
);

saveFilterBtn.addEventListener(
  "click",
  saveCurrentScan
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


filterBtns.forEach(
  (btn) => {
    btn.addEventListener(
      "click",
      () => {
        const type =
          btn.dataset.filter;

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
      event.preventDefault();

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


pdfNameModal.addEventListener(
  "click",
  (event) => {
    if (
      event.target ===
      pdfNameModal
    ) {
      closePdfModal();
    }
  }
);


/* =========================================================
   LIFECYCLE
   ========================================================= */

window.addEventListener(
  "load",
  () => {
    startCamera();
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


document.addEventListener(
  "visibilitychange",
  async () => {
    if (
      document.visibilityState ===
      "hidden"
    ) {
      stopCamera();

      return;
    }

    if (
      document.visibilityState ===
        "visible" &&
      !cameraSection.hidden
    ) {
      if (!isCameraReady) {
        await startCamera();
      }
    }
  }
);


/* =========================================================
   INITIAL STATE
   ========================================================= */

captureBtn.disabled =
  true;

setStatus(
  "loading",
  '<i class="fas fa-spinner fa-spin"></i>' +
  "<span>Smart Scanner Engine Loading...</span>"
);
