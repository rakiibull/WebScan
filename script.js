"use strict";

/* =========================================================
   WebScan Pro
   Step 1 - Stable Scanner Foundation
   ========================================================= */

/* -------------------------
   DOM Elements
------------------------- */

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const filterCanvas = document.getElementById("filterCanvas");

const ctx = canvas.getContext("2d");

const cameraSection = document.getElementById("cameraSection");
const cropSection = document.getElementById("cropSection");
const filterSection = document.getElementById("filterSection");

const cropImage = document.getElementById("cropImage");
const flashEffect = document.getElementById("flashEffect");
const cameraPlaceholder = document.getElementById("cameraPlaceholder");

const captureBtn = document.getElementById("captureBtn");
const pdfBtn = document.getElementById("pdfBtn");

const cancelCropBtn = document.getElementById("cancelCropBtn");
const applyCropBtn = document.getElementById("applyCropBtn");

const backToCropBtn = document.getElementById("backToCropBtn");
const saveFilterBtn = document.getElementById("saveFilterBtn");

const mainControls = document.getElementById("mainControls");
const cropControls = document.getElementById("cropControls");
const filterControls = document.getElementById("filterControls");

const gallery = document.getElementById("gallery");
const pageCount = document.getElementById("pageCount");

const statusDiv = document.getElementById("status");
const errorMessage = document.getElementById("errorMessage");
const errorTitle = document.getElementById("errorTitle");
const errorText = document.getElementById("errorText");
const dismissErrorBtn = document.getElementById("dismissErrorBtn");

const filterBtns = document.querySelectorAll(".filter-btn");

/* PDF Modal */

const pdfNameModal = document.getElementById("pdfNameModal");
const pdfNameInput = document.getElementById("pdfNameInput");

const cancelPdfBtn = document.getElementById("cancelPdfBtn");
const confirmPdfBtn = document.getElementById("confirmPdfBtn");
const closePdfModalBtn = document.getElementById("closePdfModalBtn");

/* -------------------------
   App State
------------------------- */

let scannedImages = [];

let cameraStream = null;

let isCameraReady = false;
let isOpenCvReady = false;

let cropper = null;
let originalCroppedMat = null;

let currentFilter = "magic";

/* -------------------------
   Utility Functions
------------------------- */

function setStatus(type, message, autoHide = false) {
  if (!statusDiv) return;

  statusDiv.className = "status";

  if (type === "loading") {
    statusDiv.classList.add("status-loading");
  } else if (type === "ready") {
    statusDiv.classList.add("status-ready");
  } else if (type === "error") {
    statusDiv.classList.add("status-error");
  }

  statusDiv.innerHTML = message;

  statusDiv.classList.remove("status-hidden");

  if (autoHide) {
    window.setTimeout(() => {
      statusDiv.classList.add("status-hidden");
    }, 3000);
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

function setMainButtonsState(enabled) {
  captureBtn.disabled = !enabled;
}

function isValidCameraEnvironment() {
  if (!navigator.mediaDevices) {
    showError(
      "Camera not supported",
      "এই browser/device camera access support করে না।"
    );

    return false;
  }

  if (!navigator.mediaDevices.getUserMedia) {
    showError(
      "Camera unavailable",
      "এই browser-এ camera access পাওয়া যাচ্ছে না।"
    );

    return false;
  }

  return true;
}

/* -------------------------
   OpenCV
------------------------- */

function onOpenCvReady() {
  try {
    if (typeof cv === "undefined") {
      onOpenCvError();
      return;
    }

    isOpenCvReady = true;

    setStatus(
      "ready",
      '<i class="fas fa-check-circle"></i><span>AI Scanner Ready!</span>',
      true
    );

    updateCaptureAvailability();
  } catch (error) {
    console.error("OpenCV initialization error:", error);

    onOpenCvError();
  }
}

function onOpenCvError() {
  isOpenCvReady = false;

  setStatus(
    "error",
    '<i class="fas fa-triangle-exclamation"></i><span>Scanner Engine Failed</span>'
  );

  showError(
    "Scanner engine unavailable",
    "AI scanner engine load করা যায়নি। Internet connection check করে page reload করুন।"
  );

  updateCaptureAvailability();
}

function updateCaptureAvailability() {
  const ready = isCameraReady && isOpenCvReady;

  setMainButtonsState(ready);
}

/* -------------------------
   Camera
------------------------- */

async function startCamera() {
  hideError();

  if (!isValidCameraEnvironment()) {
    isCameraReady = false;
    updateCaptureAvailability();
    return;
  }

  stopCamera();

  cameraPlaceholder.hidden = false;

  setStatus(
    "loading",
    '<i class="fas fa-spinner fa-spin"></i><span>Camera starting...</span>'
  );

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,

      video: {
        facingMode: {
          ideal: "environment",
        },

        width: {
          ideal: 1920,
        },

        height: {
          ideal: 1080,
        },
      },
    });

    video.srcObject = cameraStream;

    await waitForVideoReady();

    isCameraReady = true;

    cameraPlaceholder.hidden = true;

    setStatus(
      "ready",
      '<i class="fas fa-camera"></i><span>Camera Ready</span>',
      true
    );

    updateCaptureAvailability();
  } catch (error) {
    console.error("Camera error:", error);

    isCameraReady = false;

    updateCaptureAvailability();

    handleCameraError(error);
  }
}

function waitForVideoReady() {
  return new Promise((resolve, reject) => {
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      resolve();
      return;
    }

    const timeout = window.setTimeout(() => {
      cleanup();

      reject(
        new Error("Camera preview timed out.")
      );
    }, 10000);

    function handleLoadedMetadata() {
      cleanup();
      resolve();
    }

    function cleanup() {
      window.clearTimeout(timeout);

      video.removeEventListener(
        "loadedmetadata",
        handleLoadedMetadata
      );
    }

    video.addEventListener(
      "loadedmetadata",
      handleLoadedMetadata,
      {
        once: true,
      }
    );
  });
}

function handleCameraError(error) {
  cameraPlaceholder.hidden = false;

  let title = "Camera চালু করা যাচ্ছে না";
  let message = "Camera permission এবং browser settings check করুন।";

  if (error && error.name === "NotAllowedError") {
    title = "Camera permission required";

    message =
      "Camera permission denied হয়েছে। Browser settings থেকে camera permission Allow করে আবার চেষ্টা করুন.";
  } else if (error && error.name === "NotFoundError") {
    title = "Camera পাওয়া যায়নি";

    message =
      "এই device-এ কোনো compatible camera পাওয়া যায়নি.";
  } else if (error && error.name === "NotReadableError") {
    title = "Camera busy";

    message =
      "অন্য কোনো app/browser camera ব্যবহার করছে। সেটি বন্ধ করে আবার চেষ্টা করুন.";
  } else if (error && error.name === "SecurityError") {
    title = "Secure connection required";

    message =
      "Camera access-এর জন্য HTTPS অথবা localhost ব্যবহার করুন.";
  }

  setStatus(
    "error",
    '<i class="fas fa-camera-slash"></i><span>Camera Error</span>'
  );

  showError(title, message);
}

function stopCamera() {
  if (!cameraStream) {
    return;
  }

  cameraStream.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch (error) {
      console.warn("Could not stop camera track:", error);
    }
  });

  cameraStream = null;

  video.srcObject = null;

  isCameraReady = false;

  updateCaptureAvailability();
}

/* -------------------------
   Capture
------------------------- */

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
      "Scanner engine এখনও load হচ্ছে।"
    );

    return;
  }

  if (
    !video.videoWidth ||
    !video.videoHeight
  ) {
    showError(
      "Camera frame unavailable",
      "Camera preview থেকে image পাওয়া যায়নি। আবার চেষ্টা করুন।"
    );

    return;
  }

  try {
    captureBtn.disabled = true;

    flashEffect.classList.remove("flash-active");

    /*
      Force browser to restart animation
      so repeated captures always flash.
    */
    void flashEffect.offsetWidth;

    flashEffect.classList.add("flash-active");

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    ctx.drawImage(
      video,
      0,
      0,
      canvas.width,
      canvas.height
    );

    const imageDataUrl = canvas.toDataURL(
      "image/jpeg",
      0.92
    );

    if (!imageDataUrl || imageDataUrl === "data:,") {
      throw new Error(
        "Could not create captured image."
      );
    }

    cropImage.src = imageDataUrl;

    await waitForImageLoad(cropImage);

    showCropScreen();
  } catch (error) {
    console.error("Capture error:", error);

    showError(
      "Capture failed",
      "ছবি capture করা যায়নি। আবার চেষ্টা করুন।"
    );
  } finally {
    updateCaptureAvailability();
  }
}

function waitForImageLoad(image) {
  return new Promise((resolve, reject) => {
    if (image.complete && image.naturalWidth > 0) {
      resolve();
      return;
    }

    const timeout = window.setTimeout(() => {
      cleanup();

      reject(
        new Error("Captured image failed to load.")
      );
    }, 5000);

    function handleLoad() {
      cleanup();
      resolve();
    }

    function handleError() {
      cleanup();

      reject(
        new Error("Captured image failed to load.")
      );
    }

    function cleanup() {
      window.clearTimeout(timeout);

      image.removeEventListener(
        "load",
        handleLoad
      );

      image.removeEventListener(
        "error",
        handleError
      );
    }

    image.addEventListener(
      "load",
      handleLoad,
      { once: true }
    );

    image.addEventListener(
      "error",
      handleError,
      { once: true }
    );
  });
}

/* -------------------------
   Crop
------------------------- */

function showCropScreen() {
  cameraSection.hidden = true;
  mainControls.hidden = true;

  cropSection.hidden = false;
  cropControls.hidden = false;

  initializeCropper();
}

function initializeCropper() {
  destroyCropper();

  if (
    typeof Cropper === "undefined"
  ) {
    showError(
      "Cropper unavailable",
      "Crop editor load হয়নি। Page reload করে আবার চেষ্টা করুন।"
    );

    return;
  }

  cropper = new Cropper(
    cropImage,
    {
      viewMode: 1,

      autoCropArea: 0.9,

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

      cropBoxResizable: true,
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
      "Cropper destroy error:",
      error
    );
  }

  cropper = null;
}

function cancelCrop() {
  destroyCropper();

  cropImage.removeAttribute("src");

  cropSection.hidden = true;
  cropControls.hidden = true;

  filterSection.hidden = true;
  filterControls.hidden = true;

  cameraSection.hidden = false;
  mainControls.hidden = false;

  hideError();

  updateCaptureAvailability();
}

function applyCrop() {
  hideError();

  if (!cropper) {
    showError(
      "Crop editor unavailable",
      "Crop editor পাওয়া যাচ্ছে না। আবার capture করুন।"
    );

    return;
  }

  try {
    applyCropBtn.disabled = true;

    const croppedCanvas =
      cropper.getCroppedCanvas({
        imageSmoothingEnabled: true,
        imageSmoothingQuality: "high",
        fillColor: "#ffffff",
      });

    if (
      !croppedCanvas ||
      !croppedCanvas.width ||
      !croppedCanvas.height
    ) {
      throw new Error(
        "Invalid cropped canvas."
      );
    }

    if (originalCroppedMat) {
      originalCroppedMat.delete();

      originalCroppedMat = null;
    }

    originalCroppedMat =
      cv.imread(croppedCanvas);

    if (
      !originalCroppedMat ||
      originalCroppedMat.empty()
    ) {
      throw new Error(
        "OpenCV could not read cropped image."
      );
    }

    destroyCropper();

    cropSection.hidden = true;
    cropControls.hidden = true;

    filterSection.hidden = false;
    filterControls.hidden = false;

    currentFilter = "magic";

    setActiveFilterBtn("magic");

    applyFilter("magic");
  } catch (error) {
    console.error(
      "Crop processing error:",
      error
    );

    showError(
      "Crop processing failed",
      "Document processing করা যায়নি। আবার চেষ্টা করুন।"
    );
  } finally {
    applyCropBtn.disabled = false;
  }
}

/* -------------------------
   Filters
------------------------- */

function setActiveFilterBtn(type) {
  filterBtns.forEach((btn) => {
    btn.classList.toggle(
      "active",
      btn.dataset.filter === type
    );
  });
}

function applyFilter(type) {
  if (!originalCroppedMat) {
    showError(
      "Image unavailable",
      "Filter করার জন্য image পাওয়া যাচ্ছে না।"
    );

    return;
  }

  if (!isOpenCvReady) {
    showError(
      "Scanner engine unavailable",
      "OpenCV scanner engine এখনও ready নয়।"
    );

    return;
  }

  let dst = null;

  try {
    currentFilter = type;

    dst = new cv.Mat();

    if (type === "original") {
      originalCroppedMat.copyTo(dst);
    } else if (type === "magic") {
      /*
        Moderate enhancement.
        Keeps the document natural while
        improving brightness and contrast.
      */
      originalCroppedMat.convertTo(
        dst,
        -1,
        1.25,
        20
      );
    } else if (type === "bw") {
      const gray = new cv.Mat();

      try {
        cv.cvtColor(
          originalCroppedMat,
          gray,
          cv.COLOR_RGBA2GRAY
        );

        cv.adaptiveThreshold(
          gray,
          dst,
          255,
          cv.ADAPTIVE_THRESH_GAUSSIAN_C,
          cv.THRESH_BINARY,
          11,
          2
        );
      } finally {
        gray.delete();
      }
    } else {
      originalCroppedMat.copyTo(dst);
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
      "এই filter apply করা যায়নি। অন্য filter চেষ্টা করুন।"
    );
  } finally {
    if (dst) {
      dst.delete();
    }
  }
}

/* -------------------------
   Back to Crop
------------------------- */

function backToCrop() {
  filterSection.hidden = true;
  filterControls.hidden = true;

  cropSection.hidden = false;
  cropControls.hidden = false;

  if (cropImage.src) {
    initializeCropper();
  }
}

/* -------------------------
   Save Scanned Page
------------------------- */

function saveCurrentScan() {
  hideError();

  if (!filterCanvas.width || !filterCanvas.height) {
    showError(
      "Nothing to save",
      "Save করার মতো কোনো scanned image নেই।"
    );

    return;
  }

  try {
    saveFilterBtn.disabled = true;

    const imgDataUrl =
      filterCanvas.toDataURL(
        "image/jpeg",
        0.9
      );

    if (
      !imgDataUrl ||
      imgDataUrl === "data:,"
    ) {
      throw new Error(
        "Could not create scan image."
      );
    }

    scannedImages.push(imgDataUrl);

    updateGallery(imgDataUrl);

    cleanupCurrentEditingState();

    cameraSection.hidden = false;
    mainControls.hidden = false;

    setStatus(
      "ready",
      `<i class="fas fa-check-circle"></i><span>Page ${scannedImages.length} saved</span>`,
      true
    );
  } catch (error) {
    console.error(
      "Save scan error:",
      error
    );

    showError(
      "Save failed",
      "Scanned page save করা যায়নি। আবার চেষ্টা করুন।"
    );
  } finally {
    saveFilterBtn.disabled = false;

    updateCaptureAvailability();
  }
}

function cleanupCurrentEditingState() {
  filterSection.hidden = true;
  filterControls.hidden = true;

  cropSection.hidden = true;
  cropControls.hidden = true;

  destroyCropper();

  if (originalCroppedMat) {
    try {
      originalCroppedMat.delete();
    } catch (error) {
      console.warn(
        "OpenCV Mat cleanup error:",
        error
      );
    }

    originalCroppedMat = null;
  }

  cropImage.removeAttribute("src");

  filterCanvas.width = 1;
  filterCanvas.height = 1;
}

/* -------------------------
   Gallery
------------------------- */

function updateGallery(imgSrc) {
  const wrapper =
    document.createElement("div");

  wrapper.className =
    "gallery-item";

  const img =
    document.createElement("img");

  img.src = imgSrc;

  img.alt =
    `Scanned page ${scannedImages.length}`;

  gallery.appendChild(img);

  pageCount.innerHTML =
    `<i class="fas fa-copy"></i> Pages: ${scannedImages.length}`;

  pdfBtn.hidden = false;

  gallery.scrollLeft =
    gallery.scrollWidth;
}

/* -------------------------
   PDF
------------------------- */

function openPdfModal() {
  if (scannedImages.length === 0) {
    return;
  }

  pdfNameModal.hidden = false;

  window.setTimeout(() => {
    pdfNameInput.focus();
    pdfNameInput.select();
  }, 50);
}

function closePdfModal() {
  pdfNameModal.hidden = true;
}

function sanitizeFileName(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_\s]+|[_\s]+$/g, "")
    .slice(0, 100);
}

async function createPdf() {
  hideError();

  if (scannedImages.length === 0) {
    return;
  }

  if (
    typeof window.jspdf ===
    "undefined"
  ) {
    showError(
      "PDF engine unavailable",
      "jsPDF load হয়নি। Internet connection check করে page reload করুন।"
    );

    return;
  }

  try {
    confirmPdfBtn.disabled = true;

    let fileName =
      pdfNameInput.value.trim();

    fileName =
      sanitizeFileName(fileName);

    if (!fileName) {
      fileName =
        "WebScan_Document";
    }

    if (
      !fileName
        .toLowerCase()
        .endsWith(".pdf")
    ) {
      fileName += ".pdf";
    }

    const { jsPDF } =
      window.jspdf;

    /*
      Use first scanned image dimensions
      instead of relying on the current filter canvas.
    */
    const firstImage =
      await loadImage(
        scannedImages[0]
      );

    const imageWidth =
      firstImage.naturalWidth ||
      firstImage.width;

    const imageHeight =
      firstImage.naturalHeight ||
      firstImage.height;

    const pdf =
      new jsPDF({
        orientation:
          imageWidth >= imageHeight
            ? "landscape"
            : "portrait",

        unit: "px",

        format: [
          imageWidth,
          imageHeight,
        ],

        compress: true,
      });

    for (
      let index = 0;
      index < scannedImages.length;
      index++
    ) {
      if (index > 0) {
        const image =
          await loadImage(
            scannedImages[index]
          );

        const width =
          image.naturalWidth ||
          image.width;

        const height =
          image.naturalHeight ||
          image.height;

        pdf.addPage(
          [width, height],
          width >= height
            ? "landscape"
            : "portrait"
        );

        pdf.addImage(
          scannedImages[index],
          "JPEG",
          0,
          0,
          width,
          height
        );
      } else {
        pdf.addImage(
          scannedImages[index],
          "JPEG",
          0,
          0,
          imageWidth,
          imageHeight
        );
      }
    }

    pdf.save(fileName);

    resetScans();

    closePdfModal();

    setStatus(
      "ready",
      '<i class="fas fa-check-circle"></i><span>PDF saved successfully</span>',
      true
    );
  } catch (error) {
    console.error(
      "PDF generation error:",
      error
    );

    showError(
      "PDF generation failed",
      "PDF তৈরি করা যায়নি। আবার চেষ্টা করুন।"
    );
  } finally {
    confirmPdfBtn.disabled = false;
  }
}

function loadImage(src) {
  return new Promise(
    (resolve, reject) => {
      const image =
        new Image();

      image.onload = () =>
        resolve(image);

      image.onerror = () =>
        reject(
          new Error(
            "Image could not be loaded."
          )
        );

      image.src = src;
    }
  );
}

function resetScans() {
  scannedImages = [];

  gallery.innerHTML = "";

  pageCount.innerHTML =
    '<i class="fas fa-copy"></i> Pages: 0';

  pdfBtn.hidden = true;
}

/* -------------------------
   Event Listeners
------------------------- */

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

filterBtns.forEach((btn) => {
  btn.addEventListener(
    "click",
    () => {
      const filterType =
        btn.dataset.filter;

      setActiveFilterBtn(
        filterType
      );

      applyFilter(
        filterType
      );
    }
  );
});

confirmPdfBtn.addEventListener(
  "click",
  createPdf
);

/* Enter key in PDF modal */

pdfNameInput.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Enter") {
      event.preventDefault();

      createPdf();
    }

    if (event.key === "Escape") {
      closePdfModal();
    }
  }
);

/* Click outside modal */

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

/* -------------------------
   Page Lifecycle
------------------------- */

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

    if (originalCroppedMat) {
      try {
        originalCroppedMat.delete();
      } catch (error) {
        console.warn(
          "Final OpenCV cleanup error:",
          error
        );
      }

      originalCroppedMat = null;
    }
  }
);

/*
  When page becomes hidden, stop camera.
  When visible again, restart it.
  This is especially useful on mobile.
*/

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

/* -------------------------
   Initial State
------------------------- */

setMainButtonsState(false);

setStatus(
  "loading",
  '<i class="fas fa-spinner fa-spin"></i><span>AI Scanner Engine Loading...</span>'
);
