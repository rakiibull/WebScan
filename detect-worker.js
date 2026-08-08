/* =========================================================
   WebScan Detection Worker

   Runs document edge detection and frame-quality analysis off
   the main thread.

   Detection costs roughly 90ms per frame on desktop and several
   times that on a phone. Doing that work inline blocks rendering,
   touch handling and the camera preview, which is what makes a
   scanner feel frozen. Here it runs in parallel and only the
   resulting corner coordinates are posted back.
   ========================================================= */

"use strict";

let cvReady = false;

/*
  OpenCV is loaded inside the worker. importScripts is synchronous, so
  the runtime is initialised before any frame is accepted.
*/
self.Module = {
  onRuntimeInitialized() {
    cvReady = true;
    self.postMessage({ type: "ready" });
  }
};

try {
  self.importScripts("https://docs.opencv.org/4.x/opencv.js");
} catch (error) {
  self.postMessage({
    type: "failed",
    message: String(error && error.message || error)
  });
}

/* ---------------------------------------------------------
   GEOMETRY
   Mirrors the main-thread implementation so both paths agree.
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

function cornerAngle(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y;
  const v2x = c.x - b.x, v2y = c.y - b.y;

  const len1 = Math.hypot(v1x, v1y);
  const len2 = Math.hypot(v2x, v2y);

  if (!len1 || !len2) return 0;

  const cos = (v1x * v2x + v1y * v2y) / (len1 * len2);

  return Math.acos(Math.max(-1, Math.min(1, cos))) * (180 / Math.PI);
}

function scoreQuad(ordered, imageArea) {
  const [tl, tr, br, bl] = ordered;

  const area = polygonArea(ordered);
  const ratio = area / imageArea;

  if (ratio < 0.08 || ratio > 0.97) return 0;

  const top = distance(tl, tr);
  const right = distance(tr, br);
  const bottom = distance(br, bl);
  const left = distance(bl, tl);

  const minSide = Math.min(top, right, bottom, left);
  const maxSide = Math.max(top, right, bottom, left);

  if (minSide < 40) return 0;

  const horizontalRatio = Math.min(top, bottom) / Math.max(top, bottom);
  const verticalRatio = Math.min(left, right) / Math.max(left, right);

  if (horizontalRatio < 0.55 || verticalRatio < 0.55) return 0;

  if (maxSide / minSide > 6) return 0;

  const angles = [
    cornerAngle(bl, tl, tr),
    cornerAngle(tl, tr, br),
    cornerAngle(tr, br, bl),
    cornerAngle(br, bl, tl)
  ];

  let angleError = 0;
  for (const angle of angles) {
    if (angle < 50 || angle > 135) return 0;
    angleError += Math.abs(90 - angle);
  }

  const angleScore = Math.max(0, 1 - (angleError / 160));
  const shapeScore = (horizontalRatio + verticalRatio) / 2;

  return ratio * 0.45 + angleScore * 0.35 + shapeScore * 0.20;
}

function collectCandidates(edges, imageArea, onCandidate) {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  try {
    cv.findContours(
      edges, contours, hierarchy,
      cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE
    );

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);

      try {
        if (Math.abs(cv.contourArea(contour)) < imageArea * 0.05) continue;

        const peri = cv.arcLength(contour, true);

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

/* ---------------------------------------------------------
   DETECTION
   Takes raw pixels rather than a canvas, since a worker has no
   DOM. ImageData is transferred, not copied.
   --------------------------------------------------------- */

function detect(imageData) {
  const mats = [];
  const track = (mat) => { mats.push(mat); return mat; };

  try {
    const src = track(cv.matFromImageData(imageData));
    const imageArea = src.cols * src.rows;

    const gray = track(new cv.Mat());
    const blur = track(new cv.Mat());

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
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

    for (const [low, high] of [[40, 120], [60, 180], [20, 70]]) {
      const edges = track(new cv.Mat());
      cv.Canny(blur, edges, low, high);

      const kernel = track(
        cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5))
      );
      cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel);

      collectCandidates(edges, imageArea, consider);
    }

    const adaptive = track(new cv.Mat());
    cv.adaptiveThreshold(
      blur, adaptive, 255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 15, 8
    );

    const adaptiveKernel = track(
      cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3))
    );
    cv.morphologyEx(adaptive, adaptive, cv.MORPH_CLOSE, adaptiveKernel);
    collectCandidates(adaptive, imageArea, consider);

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

    // Sharpness and exposure, measured while the mats are already built.
    const quality = analyseQuality(gray);

    return { corners: best, quality };
  } catch (error) {
    return { corners: null, quality: null };
  } finally {
    mats.forEach(mat => {
      try { mat?.delete(); } catch (_) {}
    });
  }
}

function analyseQuality(gray) {
  let laplacian = null, mean = null, stddev = null, glareMask = null;

  try {
    laplacian = new cv.Mat();
    cv.Laplacian(gray, laplacian, cv.CV_64F);

    mean = new cv.Mat();
    stddev = new cv.Mat();
    cv.meanStdDev(laplacian, mean, stddev);

    const sd = stddev.doubleAt(0, 0);
    const brightness = cv.mean(gray)[0];

    glareMask = new cv.Mat();
    cv.threshold(gray, glareMask, 245, 255, cv.THRESH_BINARY);
    const glareRatio = cv.countNonZero(glareMask) / (gray.rows * gray.cols);

    return { sharpness: sd * sd, brightness, glareRatio };
  } catch (error) {
    return null;
  } finally {
    [laplacian, mean, stddev, glareMask].forEach(m => {
      try { m?.delete(); } catch (_) {}
    });
  }
}

self.onmessage = (event) => {
  const data = event.data;

  if (!data || data.type !== "detect") return;

  if (!cvReady) {
    // Frames that arrive before OpenCV finishes loading are dropped
    // rather than queued, so the worker never builds a backlog.
    self.postMessage({ type: "result", id: data.id, corners: null, quality: null });
    return;
  }

  const started = Date.now();
  const result = detect(data.imageData);

  self.postMessage({
    type: "result",
    id: data.id,
    corners: result.corners,
    quality: result.quality,
    elapsed: Date.now() - started
  });
};
