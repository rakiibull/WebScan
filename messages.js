/* =========================================================
   WebScan Messages

   Every message the user can see, in one place.

   Errors are mapped from what actually went wrong to what the
   person can do about it. A message that only names the fault
   ("Camera unavailable") leaves the user stuck; naming the fix
   ("Allow camera access in your browser settings") does not.
   ========================================================= */

(() => {
  "use strict";

  /*
    getUserMedia rejects with a small set of standard DOMException
    names. Each means something different and needs a different
    remedy, so they are distinguished rather than collapsed into one
    generic failure.
  */
  const CAMERA_ERRORS = {

    NotAllowedError: {
      title: "Camera access is required",
      detail:
        "Camera access is required to scan documents. " +
        "Allow it in your browser settings, then try again.",
      retry: true
    },

    PermissionDeniedError: {
      title: "Camera access is required",
      detail:
        "Camera access is required to scan documents. " +
        "Allow it in your browser settings, then try again.",
      retry: true
    },

    NotFoundError: {
      title: "No camera found",
      detail:
        "This device has no camera available. " +
        "You can still import photos from your gallery.",
      retry: false
    },

    DevicesNotFoundError: {
      title: "No camera found",
      detail:
        "This device has no camera available. " +
        "You can still import photos from your gallery.",
      retry: false
    },

    NotReadableError: {
      title: "Camera is busy",
      detail:
        "Another app is using the camera. " +
        "Close it and try again.",
      retry: true
    },

    TrackStartError: {
      title: "Camera is busy",
      detail:
        "Another app is using the camera. " +
        "Close it and try again.",
      retry: true
    },

    OverconstrainedError: {
      title: "Camera not supported",
      detail:
        "This camera could not be used for scanning. " +
        "Try switching cameras, or import a photo instead.",
      retry: true
    },

    ConstraintNotSatisfiedError: {
      title: "Camera not supported",
      detail:
        "This camera could not be used for scanning. " +
        "Try switching cameras, or import a photo instead.",
      retry: true
    },

    SecurityError: {
      title: "Secure connection needed",
      detail:
        "Camera access needs a secure (https) connection. " +
        "Open the app over https and try again.",
      retry: true
    },

    AbortError: {
      title: "Camera could not start",
      detail:
        "The camera stopped unexpectedly. Try again.",
      retry: true
    }

  };

  const CAMERA_FALLBACK = {
    title: "Camera unavailable",
    detail:
      "The camera could not be started. " +
      "Check that no other app is using it, then try again.",
    retry: true
  };

  /*
    Turns a getUserMedia rejection into something actionable.

    Browsers disagree on which name they use for the same condition, so
    the message is chosen by name first and falls back to inspecting the
    text before giving a generic answer.
  */
  function cameraError(error) {
    if (!error) return CAMERA_FALLBACK;

    // Missing API entirely: not a DOMException, so handled separately.
    if (
      error.message &&
      /unavailable|not supported|getUserMedia/i.test(error.message) &&
      !error.name
    ) {
      return {
        title: "Camera not supported",
        detail:
          "This browser cannot access the camera. " +
          "Try Chrome or Safari, or import a photo instead.",
        retry: false
      };
    }

    const byName = CAMERA_ERRORS[error.name];
    if (byName) return byName;

    // Some browsers only describe the problem in the message text.
    const text = String(error.message || "").toLowerCase();

    if (text.includes("permission") || text.includes("denied")) {
      return CAMERA_ERRORS.NotAllowedError;
    }

    if (text.includes("in use") || text.includes("busy")) {
      return CAMERA_ERRORS.NotReadableError;
    }

    if (text.includes("secure") || text.includes("https")) {
      return CAMERA_ERRORS.SecurityError;
    }

    return CAMERA_FALLBACK;
  }

  /*
    Live guidance shown over the camera preview.

    Phrased as an instruction rather than a diagnosis, so the user knows
    what to change without interpreting the wording.
  */
  const SCAN = {
    searching: "Place the document inside the frame.",
    holdSteady: "Hold your device steady.",
    detected: "Document detected ✓",
    tooFar: "Move closer to the document.",
    partiallyOutside: "Fit the whole document in the frame.",
    tilted: "Hold your device flat above the page.",
    tooDark: "Increase lighting for a clearer scan.",
    tooBright: "Reduce the lighting or move out of direct light.",
    glare: "Glare detected — tilt away from the light.",
    blurry: "Hold your device steady.",
    ready: "Ready to scan.",
    cameraNotReady: "Camera is still starting…",
    detectionUnavailable:
      "Automatic detection is unavailable. Tap the shutter to capture."
  };

  /* Progress wording for operations slow enough to need feedback. */
  const PROGRESS = {
    capturing: "Capturing…",
    enhancing: "Enhancing your scan…",
    detectingEdges: "Detecting edges and correcting perspective…",
    readingText: "Reading document text…",
    buildingPdf: "Preparing your PDF…",
    exporting: "Saving your document…",
    loadingOcr: "Loading the text engine…",
    loadingFont: "Preparing text layer…"
  };

  /* One-off results and failures shown as toasts. */
  const NOTICE = {
    storageFull:
      "Not enough space to save. Delete old documents and try again.",

    exportFailed:
      "Could not create the file. Try a smaller page size or fewer pages.",

    exportEmpty:
      "Add at least one page before exporting.",

    scanFailed:
      "The scan could not be processed. Try capturing again.",

    imageLoadFailed:
      "This image could not be opened. Try a different file.",

    ocrFailed:
      "Text could not be read. Check your connection and try again.",

    ocrEmpty:
      "No readable text was found on this page.",

    ocrUnavailable:
      "Text recognition is unavailable right now.",

    cropUnavailable:
      "Manual crop is unavailable until the image tools finish loading.",

    enhanceFailed:
      "Enhancement could not be applied. The original scan is unchanged.",

    noPages:
      "Capture or import a page first.",

    nameRequired:
      "Enter a name for this document.",

    permissionGallery:
      "Photo access is required to import images."
  };

  window.WebScanMessages = {
    cameraError,
    SCAN,
    PROGRESS,
    NOTICE
  };
})();
