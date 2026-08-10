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
  the script itself finishes before any frame is accepted -- but the
  WASM runtime inside it initialises asynchronously, which is what
  onRuntimeInitialized below actually waits for.

  Served from jsdelivr rather than docs.opencv.org for the same reason
  as index.html's copy: that URL is OpenCV's documentation site, not a
  CDN, and 301-redirects to a versioned path with no long-lived cache
  headers -- slow and occasionally stalling outright on mobile
  networks. jsdelivr serves the identical official build, pinned to a
  fixed version, from an edge CDN.

  This UMD build assigns straight to `cv` in a worker context, not
  `Module`, so readiness is read off `cv.onRuntimeInitialized` after
  the import returns rather than a Module pre-declaration.
*/
try {
  self.importScripts(
    "https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js"
  );

  if (self.cv) {
    self.cv["onRuntimeInitialized"] = () => {
      cvReady = true;
      self.postMessage({ type: "ready" });
    };
  } else {
    self.postMessage({ type: "failed", message: "opencv.js loaded but did not define cv" });
  }
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

/*
  Mirrors the main thread's scoring, including mode profiles.

  The worker draws the live outline, so it has to agree with the mode
  the user selected. If it always scored for paper, ID Card mode would
  outline the wrong object on screen and then capture a different one,
  because capture re-runs detection on the main thread where the
  profile does apply.

  The profile arrives with each frame rather than being stored, so the
  worker holds no state that could drift out of sync with the UI.
*/
function scoreQuad(ordered, imageArea, profile = null) {
  const [tl, tr, br, bl] = ordered;

  const area = polygonArea(ordered);
  const ratio = area / imageArea;

  const minArea = profile?.minScoreAreaRatio ?? 0.08;
  if (ratio < minArea || ratio > 0.97) return 0;

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
    if (angle < 50 || angle > 135) return 0;
    angleError += Math.abs(90 - angle);
  }

  const angleScore = Math.max(0, 1 - (angleError / 160));
  const shapeScore = (horizontalRatio + verticalRatio) / 2;

  const target = profile?.targetRatio;

  // Same weighting as the main thread: shape first when a mode
  // declares a target, area first otherwise.
  if (target) {
    const ratioError = Math.abs(aspect - target) / target;
    const fitScore = Math.max(0, 1 - ratioError);

    return fitScore * 0.5 + angleScore * 0.3
      + shapeScore * 0.15 + ratio * 0.05;
  }

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

function detect(imageData, profile) {
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
      const score = scoreQuad(ordered, imageArea, profile);
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

    const corners = best ? refineCorners(gray, best) : null;

    return { corners, quality };
  } catch (error) {
    return { corners: null, quality: null };
  } finally {
    mats.forEach(mat => {
      try { mat?.delete(); } catch (_) {}
    });
  }
}

/*
  Nudges each corner from its integer approxPolyDP position onto the
  true local gradient. Mirrors the same function on the main thread so
  the live outline and the full-resolution capture agree on where the
  page edges actually are.

  OpenCV.js does not expose cv.cornerSubPix (it is compiled into the
  WASM binary but never registered with embind, so calling it throws
  "not a function"), so this reimplements the same classic algorithm
  directly against the gray Mat's pixel buffer: iteratively move to
  the point, within a small window, where the image gradient is most
  orthogonal to the vector back to the current estimate — the
  textbook sub-pixel corner criterion.
*/
function refineCorners(gray, points) {
  const width = gray.cols;
  const height = gray.rows;
  const data = gray.data; // single-channel 8-bit, row-major

  /*
    Bilinear sample rather than nearest-pixel rounding. The iteration
    below moves the estimate by sub-pixel amounts each step; sampling
    via Math.round() makes the gradient field jump discontinuously as
    that estimate crosses pixel boundaries, which was measured to
    oscillate between two positions forever instead of converging.
    Bilinear sampling keeps the gradient continuous, so the solver
    actually settles.
  */
  const sampleBilinear = (x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const cx0 = Math.min(Math.max(x0, 0), width - 1);
    const cy0 = Math.min(Math.max(y0, 0), height - 1);
    const x1 = Math.min(x0 + 1, width - 1);
    const y1 = Math.min(y0 + 1, height - 1);

    const fx = x - x0;
    const fy = y - y0;

    const v00 = data[cy0 * width + cx0];
    const v10 = data[cy0 * width + x1];
    const v01 = data[y1 * width + cx0];
    const v11 = data[y1 * width + x1];

    return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) +
      v01 * (1 - fx) * fy + v11 * fx * fy;
  };

  const gradientAt = (x, y) => ({
    gx: (sampleBilinear(x + 1, y) - sampleBilinear(x - 1, y)) / 2,
    gy: (sampleBilinear(x, y + 1) - sampleBilinear(x, y - 1)) / 2
  });

  const half = 4;

  const refineOne = (point) => {
    if (
      point.x < half || point.x > width - 1 - half ||
      point.y < half || point.y > height - 1 - half
    ) {
      return point;
    }

    let cx = point.x;
    let cy = point.y;

    for (let iter = 0; iter < 10; iter++) {
      let sumGxGx = 0, sumGxGy = 0, sumGyGy = 0;
      let sumGxB = 0, sumGyB = 0;

      for (let dy = -half; dy <= half; dy++) {
        for (let dx = -half; dx <= half; dx++) {
          if (dx === 0 && dy === 0) continue;

          const px = cx + dx;
          const py = cy + dy;
          const { gx, gy } = gradientAt(px, py);

          if (!gx && !gy) continue;

          sumGxGx += gx * gx;
          sumGxGy += gx * gy;
          sumGyGy += gy * gy;
          sumGxB += gx * gx * px + gx * gy * py;
          sumGyB += gx * gy * px + gy * gy * py;
        }
      }

      const det = sumGxGx * sumGyGy - sumGxGy * sumGxGy;

      if (Math.abs(det) < 1e-6) break;

      const nx = (sumGyGy * sumGxB - sumGxGy * sumGyB) / det;
      const ny = (sumGxGx * sumGyB - sumGxGy * sumGxB) / det;

      const shift = Math.hypot(nx - cx, ny - cy);

      cx = nx;
      cy = ny;

      if (shift < 0.01) break;
    }

    if (!Number.isFinite(cx) || !Number.isFinite(cy) ||
        Math.hypot(cx - point.x, cy - point.y) > 6) {
      return point;
    }

    return { x: cx, y: cy };
  };

  return points.map(refineOne);
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

    /*
      Near-saturation only. At 245 a plain white page registered as 40%
      glare and blocked auto capture; genuine specular highlights clip
      much closer to pure white than paper ever does.
    */
    cv.threshold(gray, glareMask, 252, 255, cv.THRESH_BINARY);
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
  const result = detect(data.imageData, data.profile || null);

  self.postMessage({
    type: "result",
    id: data.id,
    corners: result.corners,
    quality: result.quality,
    elapsed: Date.now() - started
  });
};
