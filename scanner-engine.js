/* =========================================================
   WebScan Advanced Scanner Engine
   Version 1.0

   Features:
   - Live document edge detection
   - Four corner detection
   - Document boundary overlay
   - Perspective correction
   - Auto crop
   - Capture fallback
========================================================= */

"use strict";


/* =========================================================
   CONFIG
========================================================= */

const WS_SCANNER_CONFIG = {

  detectionInterval: 180,

  minimumAreaRatio: 0.12,

  maximumAreaRatio: 0.95,

  cannyLow: 50,

  cannyHigh: 150,

  blurSize: 5,

  perspectiveMaximumSize: 2400,

  jpegQuality: 0.88

};


let wsDetectionTimer = null;

let wsDetectionRunning = false;

let wsDetectedCorners = null;

let wsOpenCVReady = false;


/* =========================================================
   BASIC HELPERS
========================================================= */

function wsGet(id) {

  return document.getElementById(id);

}


function wsCameraVideo() {

  return wsGet("video");

}


/* =========================================================
   OPEN CV CHECK
========================================================= */

function wsCheckOpenCV() {

  try {

    if (
      typeof cv !== "undefined" &&
      cv &&
      typeof cv.Mat === "function"
    ) {

      wsOpenCVReady = true;

      return true;

    }

  } catch (error) {

    console.error(
      "OpenCV check failed:",
      error
    );

  }

  return false;

}


/* =========================================================
   WAIT FOR OPENCV
========================================================= */

function wsWaitForOpenCV() {

  if (wsCheckOpenCV()) {

    wsUpdateDetectionStatus(
      "Ready to scan",
      false
    );

    return;

  }


  wsUpdateDetectionStatus(
    "Loading scanner…",
    false
  );


  setTimeout(
    wsWaitForOpenCV,
    500
  );

}


/* =========================================================
   CREATE CAMERA UI
========================================================= */

function wsCreateScannerUI() {

  const cameraView =
    document.querySelector(
      "#cameraScreen .camera-view"
    );


  if (!cameraView) {

    return;

  }


  /*
    Overlay
  */

  if (!wsGet("wsScannerOverlay")) {

    const svg =
      document.createElement("svg");

    svg.id =
      "wsScannerOverlay";

    svg.setAttribute(
      "aria-hidden",
      "true"
    );


    const polygon =
      document.createElement("polygon");

    polygon.id =
      "wsScannerPolygon";


    svg.appendChild(
      polygon
    );


    cameraView.appendChild(
      svg
    );

  }


  /*
    Detection badge
  */

  if (!wsGet("wsDetectionBadge")) {

    const badge =
      document.createElement("div");

    badge.id =
      "wsDetectionBadge";


    const dot =
      document.createElement("i");

    dot.id =
      "wsDetectionDot";


    const text =
      document.createElement("span");

    text.id =
      "wsDetectionText";

    text.textContent =
      "Looking for document…";


    badge.appendChild(dot);

    badge.appendChild(text);


    cameraView.appendChild(
      badge
    );

  }

}


/* =========================================================
   DETECTION STATUS
========================================================= */

function wsUpdateDetectionStatus(
  message,
  detected
) {

  const badge =
    wsGet("wsDetectionBadge");

  const text =
    wsGet("wsDetectionText");


  if (!badge || !text) {

    return;

  }


  text.textContent =
    message;


  badge.classList.toggle(
    "detected",
    Boolean(detected)
  );

}


/* =========================================================
   START LIVE DETECTION
========================================================= */

function wsStartDetection() {

  if (wsDetectionRunning) {

    return;

  }


  wsDetectionRunning = true;


  wsCreateScannerUI();

  wsWaitForOpenCV();


  wsDetectionLoop();

}


/* =========================================================
   STOP LIVE DETECTION
========================================================= */

function wsStopDetection() {

  wsDetectionRunning = false;


  if (wsDetectionTimer) {

    clearTimeout(
      wsDetectionTimer
    );

    wsDetectionTimer = null;

  }


  wsDetectedCorners = null;

  wsClearOverlay();

}


/* =========================================================
   DETECTION LOOP
========================================================= */

function wsDetectionLoop() {

  if (!wsDetectionRunning) {

    return;

  }


  const video =
    wsCameraVideo();


  if (
    !video ||
    !video.videoWidth ||
    !video.videoHeight
  ) {

    wsDetectionTimer =
      setTimeout(
        wsDetectionLoop,
        300
      );

    return;

  }


  if (!wsCheckOpenCV()) {

    wsDetectionTimer =
      setTimeout(
        wsDetectionLoop,
        500
      );

    return;

  }


  try {

    const corners =
      wsDetectDocument(
        video
      );


    if (corners) {

      wsDetectedCorners =
        corners;


      wsUpdateDetectionStatus(
        "Document detected ✓",
        true
      );


      wsDrawOverlay(
        corners
      );

    } else {

      wsDetectedCorners =
        null;


      wsUpdateDetectionStatus(
        "Align document inside frame",
        false
      );


      wsClearOverlay();

    }

  } catch (error) {

    console.error(
      "WebScan detection error:",
      error
    );

  }


  wsDetectionTimer =
    setTimeout(
      wsDetectionLoop,
      WS_SCANNER_CONFIG.detectionInterval
    );

}


/* =========================================================
   DETECT DOCUMENT
========================================================= */

function wsDetectDocument(
  video
) {

  if (!wsCheckOpenCV()) {

    return null;

  }


  const originalWidth =
    video.videoWidth;

  const originalHeight =
    video.videoHeight;


  /*
    Resize processing frame
    for better mobile performance.
  */

  const maxWidth = 900;


  const scale =
    Math.min(
      1,
      maxWidth /
      originalWidth
    );


  const width =
    Math.max(
      1,
      Math.round(
        originalWidth * scale
      )
    );


  const height =
    Math.max(
      1,
      Math.round(
        originalHeight * scale
      )
    );


  const canvas =
    document.createElement(
      "canvas"
    );


  canvas.width =
    width;

  canvas.height =
    height;


  const context =
    canvas.getContext(
      "2d",
      {
        willReadFrequently: true
      }
    );


  context.drawImage(
    video,
    0,
    0,
    width,
    height
  );


  const src =
    cv.imread(canvas);

  const gray =
    new cv.Mat();

  const blur =
    new cv.Mat();

  const edges =
    new cv.Mat();

  const contours =
    new cv.MatVector();

  const hierarchy =
    new cv.Mat();


  let bestContour =
    null;

  let bestArea =
    0;


  try {

    /*
      Grayscale
    */

    cv.cvtColor(
      src,
      gray,
      cv.COLOR_RGBA2GRAY
    );


    /*
      Blur
    */

    cv.GaussianBlur(
      gray,
      blur,
      new cv.Size(
        WS_SCANNER_CONFIG.blurSize,
        WS_SCANNER_CONFIG.blurSize
      ),
      0
    );


    /*
      Edge detection
    */

    cv.Canny(
      blur,
      edges,
      WS_SCANNER_CONFIG.cannyLow,
      WS_SCANNER_CONFIG.cannyHigh
    );


    /*
      Close small gaps
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


    /*
      Find contours
    */

    cv.findContours(
      edges,
      contours,
      hierarchy,
      cv.RETR_LIST,
      cv.CHAIN_APPROX_SIMPLE
    );


    const imageArea =
      width * height;


    /*
      Search largest valid
      four-sided contour.
    */

    for (
      let i = 0;
      i < contours.size();
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
        imageArea *
        WS_SCANNER_CONFIG.minimumAreaRatio
      ) {

        contour.delete();

        continue;

      }


      if (
        area >
        imageArea *
        WS_SCANNER_CONFIG.maximumAreaRatio
      ) {

        contour.delete();

        continue;

      }


      const perimeter =
        cv.arcLength(
          contour,
          true
        );


      const approximation =
        new cv.Mat();


      cv.approxPolyDP(
        contour,
        approximation,
        0.02 *
        perimeter,
        true
      );


      if (
        approximation.rows === 4 &&
        area > bestArea
      ) {

        if (bestContour) {

          bestContour.delete();

        }


        bestContour =
          approximation.clone();

        bestArea =
          area;

      }


      approximation.delete();

      contour.delete();

    }


    if (!bestContour) {

      return null;

    }


    const points = [];


    for (
      let i = 0;
      i < 4;
      i++
    ) {

      points.push({

        x:
          bestContour.intAt(
            i,
            0
          ),

        y:
          bestContour.intAt(
            i,
            1
          )

      });

    }


    /*
      Convert back to
      original video coordinates.
    */

    const originalPoints =
      points.map(
        point => ({

          x:
            point.x /
            scale,

          y:
            point.y /
            scale

        })
      );


    return wsOrderCorners(
      originalPoints
    );

  } finally {

    src.delete();

    gray.delete();

    blur.delete();

    edges.delete();

    contours.delete();

    hierarchy.delete();


    if (bestContour) {

      bestContour.delete();

    }

  }

}


/* =========================================================
   ORDER FOUR CORNERS
========================================================= */

function wsOrderCorners(
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
      point =>
        point.x +
        point.y
    );


  const differences =
    points.map(
      point =>
        point.x -
        point.y
    );


  const topLeft =
    points[
      sums.indexOf(
        Math.min(
          ...sums
        )
      )
    ];


  const bottomRight =
    points[
      sums.indexOf(
        Math.max(
          ...sums
        )
      )
    ];


  const topRight =
    points[
      differences.indexOf(
        Math.max(
          ...differences
        )
      )
    ];


  const bottomLeft =
    points[
      differences.indexOf(
        Math.min(
          ...differences
        )
      )
    ];


  return [
    topLeft,
    topRight,
    bottomRight,
    bottomLeft
  ];

}


/* =========================================================
   DRAW LIVE OVERLAY
========================================================= */

function wsDrawOverlay(
  corners
) {

  const polygon =
    wsGet(
      "wsScannerPolygon"
    );


  const overlay =
    wsGet(
      "wsScannerOverlay"
    );


  const video =
    wsCameraVideo();


  if (
    !polygon ||
    !overlay ||
    !video ||
    !video.videoWidth
  ) {

    return;

  }


  const rect =
    video.getBoundingClientRect();


  const videoWidth =
    video.videoWidth;

  const videoHeight =
    video.videoHeight;


  /*
    object-fit: cover
    calculation.
  */

  const scale =
    Math.max(
      rect.width /
      videoWidth,

      rect.height /
      videoHeight
    );


  const displayWidth =
    videoWidth *
    scale;


  const displayHeight =
    videoHeight *
    scale;


  const offsetX =
    (
      rect.width -
      displayWidth
    ) / 2;


  const offsetY =
    (
      rect.height -
      displayHeight
    ) / 2;


  const points =
    corners
      .map(
        point =>
          `${

            point.x *
            scale +
            offsetX

          },${

            point.y *
            scale +
            offsetY

          }`
      )
      .join(" ");


  overlay.setAttribute(
    "viewBox",
    `0 0 ${rect.width} ${rect.height}`
  );


  polygon.setAttribute(
    "points",
    points
  );

}


/* =========================================================
   CLEAR OVERLAY
========================================================= */

function wsClearOverlay() {

  const polygon =
    wsGet(
      "wsScannerPolygon"
    );


  if (polygon) {

    polygon.setAttribute(
      "points",
      ""
    );

  }

}


/* =========================================================
   DISTANCE
========================================================= */

function wsDistance(
  a,
  b
) {

  return Math.sqrt(

    Math.pow(
      b.x - a.x,
      2
    )

    +

    Math.pow(
      b.y - a.y,
      2
    )

  );

}


/* =========================================================
   PERSPECTIVE CORRECTION
========================================================= */

async function wsPerspectiveCorrect(
  sourceCanvas,
  corners
) {

  if (
    !wsCheckOpenCV() ||
    !corners ||
    corners.length !== 4
  ) {

    return sourceCanvas;

  }


  const ordered =
    wsOrderCorners(
      corners
    );


  if (!ordered) {

    return sourceCanvas;

  }


  const topLeft =
    ordered[0];

  const topRight =
    ordered[1];

  const bottomRight =
    ordered[2];

  const bottomLeft =
    ordered[3];


  const topWidth =
    wsDistance(
      topLeft,
      topRight
    );


  const bottomWidth =
    wsDistance(
      bottomLeft,
      bottomRight
    );


  const leftHeight =
    wsDistance(
      topLeft,
      bottomLeft
    );


  const rightHeight =
    wsDistance(
      topRight,
      bottomRight
    );


  const outputWidth =
    Math.max(
      topWidth,
      bottomWidth
    );


  const outputHeight =
    Math.max(
      leftHeight,
      rightHeight
    );


  /*
    Limit output size.
  */

  const maxSize =
    WS_SCANNER_CONFIG
      .perspectiveMaximumSize;


  const scale =
    Math.min(
      1,
      maxSize /
      Math.max(
        outputWidth,
        outputHeight
      )
    );


  const finalWidth =
    Math.max(
      1,
      Math.round(
        outputWidth *
        scale
      )
    );


  const finalHeight =
    Math.max(
      1,
      Math.round(
        outputHeight *
        scale
      )
    );


  const src =
    cv.imread(
      sourceCanvas
    );


  const srcPoints =
    cv.matFromArray(
      4,
      1,
      cv.CV_32FC2,
      [

        topLeft.x,
        topLeft.y,

        topRight.x,
        topRight.y,

        bottomRight.x,
        bottomRight.y,

        bottomLeft.x,
        bottomLeft.y

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

        finalWidth,
        0,

        finalWidth,
        finalHeight,

        0,
        finalHeight

      ]
    );


  const transform =
    cv.getPerspectiveTransform(
      srcPoints,
      dstPoints
    );


  const output =
    new cv.Mat();


  cv.warpPerspective(
    src,
    output,
    transform,
    new cv.Size(
      finalWidth,
      finalHeight
    ),
    cv.INTER_CUBIC,
    cv.BORDER_REPLICATE
  );


  const canvas =
    document.createElement(
      "canvas"
    );


  canvas.width =
    finalWidth;

  canvas.height =
    finalHeight;


  cv.imshow(
    canvas,
    output
  );


  src.delete();

  srcPoints.delete();

  dstPoints.delete();

  transform.delete();

  output.delete();


  return canvas;

}


/* =========================================================
   CAMERA FLASH EFFECT
========================================================= */

function wsCaptureFlash() {

  const cameraView =
    document.querySelector(
      "#cameraScreen .camera-view"
    );


  if (!cameraView) {

    return;

  }


  const flash =
    document.createElement(
      "div"
    );


  flash.className =
    "ws-capture-flash";


  cameraView.appendChild(
    flash
  );


  setTimeout(
    () => {

      flash.remove();

    },
    250
  );

}


/* =========================================================
   PROCESSING UI
========================================================= */

function wsProcessingStart() {

  const cameraView =
    document.querySelector(
      "#cameraScreen .camera-view"
    );


  if (!cameraView) {

    return;

  }


  if (
    wsGet(
      "wsCaptureProcessing"
    )
  ) {

    return;

  }


  const box =
    document.createElement(
      "div"
    );


  box.id =
    "wsCaptureProcessing";


  box.className =
    "ws-capture-processing";


  box.innerHTML = `

    <span class="ws-processing-spinner"></span>

    <span>
      Straightening document…
    </span>

  `;


  cameraView.appendChild(
    box
  );

}


function wsProcessingStop() {

  const box =
    wsGet(
      "wsCaptureProcessing"
    );


  if (box) {

    box.remove();

  }

}


/* =========================================================
   ADVANCED CAPTURE
========================================================= */

async function wsAdvancedCapture() {

  const video =
    wsCameraVideo();


  if (
    !video ||
    !video.videoWidth
  ) {

    if (
      typeof showToast ===
      "function"
    ) {

      showToast(
        "Camera is not ready",
        "!"
      );

    }

    return;

  }


  wsCaptureFlash();


  /*
    Capture original camera frame.
  */

  const canvas =
    document.createElement(
      "canvas"
    );


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


  let finalCanvas =
    canvas;


  /*
    Perspective correction.
  */

  if (
    wsDetectedCorners
  ) {

    try {

      wsProcessingStart();


      finalCanvas =
        await wsPerspectiveCorrect(
          canvas,
          wsDetectedCorners
        );


      wsProcessingStop();


    } catch (error) {

      console.error(
        "Perspective correction failed:",
        error
      );


      wsProcessingStop();

      finalCanvas =
        canvas;

    }

  }


  const data =
    finalCanvas.toDataURL(
      "image/jpeg",
      WS_SCANNER_CONFIG
        .jpegQuality
    );


  /*
    Add page directly to the
    existing WebScan state.
  */

  if (
    typeof state !== "undefined" &&
    Array.isArray(state.pages)
  ) {

    state.pages.push({

      id:
        Date.now() +
        Math.random(),

      src:
        data,

      filter:
        "original",

      brightness:
        0,

      contrast:
        0,

      rotation:
        0,

      autoCropped:
        Boolean(
          wsDetectedCorners
        )

    });


    state.currentPage =
      state.pages.length - 1;


    if (
      typeof updatePages ===
      "function"
    ) {

      updatePages();

    }


    if (
      typeof showToast ===
      "function"
    ) {

      showToast(

        wsDetectedCorners

          ? `Page ${state.pages.length} scanned ✓`

          : `Page ${state.pages.length} captured`

      );

    }

  }


  wsDetectedCorners =
    null;


  wsClearOverlay();

}


/* =========================================================
   INTERCEPT EXISTING CAPTURE BUTTON
=========================================================

   IMPORTANT:

   Existing script.js already has a click
   listener on #captureBtn.

   We use capture phase so this handler
   runs before the old handler.
========================================================= */

function wsInstallCaptureHandler() {

  const button =
    wsGet(
      "captureBtn"
    );


  if (!button) {

    return;

  }


  if (
    button.dataset
      .webscanAdvancedInstalled
  ) {

    return;

  }


  button.dataset
    .webscanAdvancedInstalled =
    "true";


  button.addEventListener(

    "click",

    async event => {

      /*
        Stop old capturePhoto()
        from running.
      */

      event.preventDefault();

      event.stopImmediatePropagation();


      await wsAdvancedCapture();

    },

    true

  );

}


/* =========================================================
   CAMERA SCREEN OBSERVER
========================================================= */

function wsObserveCameraScreen() {

  const cameraScreen =
    wsGet(
      "cameraScreen"
    );


  if (!cameraScreen) {

    return;

  }


  const observer =
    new MutationObserver(
      mutations => {

        for (
          const mutation of mutations
        ) {

          if (
            mutation.attributeName ===
            "class"
          ) {

            const active =
              cameraScreen.classList
                .contains(
                  "active"
                );


            if (active) {

              setTimeout(
                () => {

                  wsCreateScannerUI();

                  wsStartDetection();

                  wsInstallCaptureHandler();

                },
                250
              );

            } else {

              wsStopDetection();

            }

          }

        }

      }
    );


  observer.observe(
    cameraScreen,
    {
      attributes: true
    }
  );


  /*
    In case camera screen
    is already active.
  */

  if (
    cameraScreen.classList
      .contains("active")
  ) {

    setTimeout(
      () => {

        wsCreateScannerUI();

        wsStartDetection();

        wsInstallCaptureHandler();

      },
      250
    );

  }

}


/* =========================================================
   RESIZE HANDLER
========================================================= */

window.addEventListener(
  "resize",
  () => {

    if (
      wsDetectedCorners
    ) {

      wsDrawOverlay(
        wsDetectedCorners
      );

    }

  }
);


/* =========================================================
   INITIALIZE
========================================================= */

function wsInitializeScanner() {

  wsCreateScannerUI();

  wsObserveCameraScreen();

  wsInstallCaptureHandler();

}


/*
  Wait until existing WebScan
  script has finished initializing.
*/

if (
  document.readyState ===
  "loading"
) {

  document.addEventListener(
    "DOMContentLoaded",
    wsInitializeScanner
  );

} else {

  wsInitializeScanner();

}


/* =========================================================
   PUBLIC DEBUG HELPERS
========================================================= */

window.WebScanScanner = {

  start:
    wsStartDetection,

  stop:
    wsStopDetection,

  detect:
    () => {

      const video =
        wsCameraVideo();

      if (!video) {
        return null;
      }

      return wsDetectDocument(
        video
      );

    },

  getCorners:
    () =>
      wsDetectedCorners

};
