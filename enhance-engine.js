/* =========================================================
   WebScan Enhancement Engine

   Pixel-level document enhancement: shadow removal, adaptive
   contrast and the scan presets used by the editor.

   Everything runs locally on a canvas. No image ever leaves the
   device. OpenCV is used when available; each operation also has a
   plain-canvas fallback so enhancement still works without it.
   ========================================================= */

(() => {
  "use strict";

  function cvIsReady() {
    return typeof window.cv !== "undefined" &&
      !!window.cv.Mat &&
      !!window.cv.imread;
  }

  function makeCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  /* ---------------------------------------------------------
     SHADOW REMOVAL

     A photographed page carries slow brightness gradients from
     overhead light, the phone itself and the user's hand. Dividing
     the image by a heavily blurred copy of itself estimates that
     illumination and flattens it, which lifts dark corners and edge
     shadows without touching fine text detail.
     --------------------------------------------------------- */

  function removeShadowsCv(srcMat, strength) {
    const rgb = new cv.Mat();
    const planes = new cv.MatVector();
    const output = new cv.MatVector();
    const result = new cv.Mat();

    try {
      cv.cvtColor(srcMat, rgb, cv.COLOR_RGBA2RGB);
      cv.split(rgb, planes);

      // Kernel scales with the image so behaviour is resolution
      // independent, and stays odd as getStructuringElement requires.
      const base = Math.max(srcMat.cols, srcMat.rows);
      let radius = Math.round(base * 0.045);
      if (radius % 2 === 0) radius += 1;
      radius = Math.max(21, Math.min(151, radius));

      for (let i = 0; i < 3; i++) {
        const channel = planes.get(i);
        const background = new cv.Mat();
        const normalized = new cv.Mat();

        try {
          // Dilate first so glyphs are replaced by nearby paper before
          // blurring; otherwise dense text darkens its own background
          // estimate and comes out washed toward grey.
          const kernel = cv.getStructuringElement(
            cv.MORPH_RECT,
            new cv.Size(9, 9)
          );

          try {
            cv.dilate(channel, background, kernel);
          } finally {
            kernel.delete();
          }

          cv.GaussianBlur(
            background,
            background,
            new cv.Size(radius, radius),
            0
          );

          // channel / background * 255 -> flat illumination.
          channel.convertTo(normalized, cv.CV_32F);
          const bg32 = new cv.Mat();

          try {
            background.convertTo(bg32, cv.CV_32F);

            // Guard against divide-by-zero in fully black regions.
            cv.add(bg32, new cv.Mat(bg32.rows, bg32.cols, bg32.type(),
              new cv.Scalar(1)), bg32);

            cv.divide(normalized, bg32, normalized, 255);
          } finally {
            bg32.delete();
          }

          normalized.convertTo(normalized, cv.CV_8U);

          // Blend back toward the original so the correction can be
          // dialled down instead of always being fully applied.
          if (strength < 1) {
            cv.addWeighted(
              normalized, strength,
              channel, 1 - strength,
              0, normalized
            );
          }

          output.push_back(normalized);
        } finally {
          channel.delete();
          background.delete();
          normalized.delete();
        }
      }

      cv.merge(output, result);
      cv.cvtColor(result, result, cv.COLOR_RGB2RGBA);

      return result;
    } catch (error) {
      result.delete();
      throw error;
    } finally {
      rgb.delete();
      planes.delete();
      output.delete();
    }
  }

  /*
    Fallback illumination correction using only 2D canvas.
    Estimates a coarse brightness map with a downscale/upscale blur and
    divides it out. Cruder than the OpenCV path but the same idea.
  */
  function removeShadowsCanvas(canvas, strength) {
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const image = ctx.getImageData(0, 0, w, h);

    // Small proxy acts as the blurred illumination estimate.
    const small = makeCanvas(
      Math.max(1, Math.round(w / 24)),
      Math.max(1, Math.round(h / 24))
    );
    const sctx = small.getContext("2d", { willReadFrequently: true });
    sctx.filter = "blur(2px)";
    sctx.drawImage(canvas, 0, 0, small.width, small.height);

    const bg = sctx.getImageData(0, 0, small.width, small.height);
    const data = image.data;

    for (let y = 0; y < h; y++) {
      const by = Math.min(small.height - 1, (y * small.height / h) | 0);

      for (let x = 0; x < w; x++) {
        const bx = Math.min(small.width - 1, (x * small.width / w) | 0);
        const bi = (by * small.width + bx) * 4;
        const i = (y * w + x) * 4;

        for (let c = 0; c < 3; c++) {
          const background = bg.data[bi + c] || 1;
          const corrected = (data[i + c] / background) * 255;

          data[i + c] = Math.max(0, Math.min(255,
            corrected * strength + data[i + c] * (1 - strength)
          ));
        }
      }
    }

    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  /* ---------------------------------------------------------
     ENHANCEMENT MODES
     --------------------------------------------------------- */

  function applyModeCv(mat, mode) {
    switch (mode) {
      case "magic": {
        // Keeps colour but lifts illumination and local contrast, so
        // coloured forms and highlighted text stay readable.
        const lab = new cv.Mat();
        const planes = new cv.MatVector();

        try {
          cv.cvtColor(mat, lab, cv.COLOR_RGBA2RGB);
          cv.cvtColor(lab, lab, cv.COLOR_RGB2Lab);
          cv.split(lab, planes);

          const l = planes.get(0);
          const clahe = new cv.CLAHE(2.4, new cv.Size(8, 8));

          try {
            clahe.apply(l, l);
            planes.set(0, l);
          } finally {
            clahe.delete();
          }

          cv.merge(planes, lab);
          cv.cvtColor(lab, lab, cv.COLOR_Lab2RGB);
          cv.cvtColor(lab, lab, cv.COLOR_RGB2RGBA);

          l.delete();
          return lab;
        } catch (error) {
          lab.delete();
          throw error;
        } finally {
          planes.delete();
        }
      }

      case "gray": {
        const out = new cv.Mat();
        cv.cvtColor(mat, out, cv.COLOR_RGBA2GRAY);
        cv.cvtColor(out, out, cv.COLOR_GRAY2RGBA);
        return out;
      }

      case "bw": {
        // Adaptive threshold rather than a global one, so a page that is
        // brighter on one side does not lose text on the darker side.
        const gray = new cv.Mat();
        const out = new cv.Mat();

        try {
          cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
          cv.medianBlur(gray, gray, 3);

          cv.adaptiveThreshold(
            gray, out, 255,
            cv.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv.THRESH_BINARY,
            25, 12
          );

          cv.cvtColor(out, out, cv.COLOR_GRAY2RGBA);
          return out;
        } catch (error) {
          out.delete();
          throw error;
        } finally {
          gray.delete();
        }
      }

      case "document": {
        // Greyscale with a strong contrast curve: text goes properly
        // dark and paper properly white, without the hard edges of B&W.
        const gray = new cv.Mat();

        try {
          cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);

          const clahe = new cv.CLAHE(3.0, new cv.Size(8, 8));
          try {
            clahe.apply(gray, gray);
          } finally {
            clahe.delete();
          }

          gray.convertTo(gray, -1, 1.25, -22);
          cv.cvtColor(gray, gray, cv.COLOR_GRAY2RGBA);
          return gray;
        } catch (error) {
          gray.delete();
          throw error;
        }
      }

      case "auto":
      default: {
        const rgb = new cv.Mat();
        const planes = new cv.MatVector();

        try {
          cv.cvtColor(mat, rgb, cv.COLOR_RGBA2RGB);
          cv.cvtColor(rgb, rgb, cv.COLOR_RGB2Lab);
          cv.split(rgb, planes);

          const l = planes.get(0);
          const clahe = new cv.CLAHE(1.8, new cv.Size(8, 8));

          try {
            clahe.apply(l, l);
            planes.set(0, l);
          } finally {
            clahe.delete();
          }

          cv.merge(planes, rgb);
          cv.cvtColor(rgb, rgb, cv.COLOR_Lab2RGB);
          cv.cvtColor(rgb, rgb, cv.COLOR_RGB2RGBA);

          l.delete();
          return rgb;
        } catch (error) {
          rgb.delete();
          throw error;
        } finally {
          planes.delete();
        }
      }
    }
  }

  /* ---------------------------------------------------------
     PUBLIC API
     --------------------------------------------------------- */

  /*
    Enhances a source canvas and returns a NEW canvas.
    The input is never modified, so "Original" always remains available.

      mode        original | auto | magic | gray | bw | document
      shadowFix   remove uneven lighting before the mode is applied
    */
  function enhance(sourceCanvas, options = {}) {
    const mode = options.mode || "original";
    const shadowFix = options.shadowRemoval !== false;

    const out = makeCanvas(sourceCanvas.width, sourceCanvas.height);
    const ctx = out.getContext("2d");
    ctx.drawImage(sourceCanvas, 0, 0);

    if (mode === "original" && !shadowFix) {
      return out;
    }

    if (!cvIsReady()) {
      // Without OpenCV, still offer shadow correction; mode styling is
      // then left to the editor's existing CSS filters.
      if (shadowFix && mode !== "original") {
        try {
          removeShadowsCanvas(out, 0.7);
        } catch (error) {
          console.warn("Shadow removal fallback failed:", error);
        }
      }
      return out;
    }

    let src = null, shadowless = null, enhanced = null;

    try {
      src = cv.imread(out);

      let working = src;

      if (shadowFix && mode !== "original") {
        try {
          // B&W and Document already normalise locally, so a lighter
          // correction avoids over-flattening and losing faint strokes.
          const strength = (mode === "bw" || mode === "document") ? 0.6 : 0.85;
          shadowless = removeShadowsCv(src, strength);
          working = shadowless;
        } catch (error) {
          console.warn("Shadow removal failed:", error);
        }
      }

      if (mode === "original") {
        cv.imshow(out, working);
        return out;
      }

      enhanced = applyModeCv(working, mode);
      cv.imshow(out, enhanced);

      return out;
    } catch (error) {
      console.warn("Enhancement failed:", error);
      // Fall back to the untouched copy rather than returning nothing.
      const safe = makeCanvas(sourceCanvas.width, sourceCanvas.height);
      safe.getContext("2d").drawImage(sourceCanvas, 0, 0);
      return safe;
    } finally {
      [src, shadowless, enhanced].forEach(mat => {
        try { mat?.delete(); } catch (_) {}
      });
    }
  }

  window.WebScanEnhance = {
    enhance,
    isAccelerated: cvIsReady
  };
})();
