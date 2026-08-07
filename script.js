const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const filterCanvas = document.getElementById("filterCanvas");
const ctx = canvas.getContext("2d");

const cameraSection = document.getElementById("cameraSection");
const cropSection = document.getElementById("cropSection");
const filterSection = document.getElementById("filterSection");
const cropImage = document.getElementById("cropImage");
const flashEffect = document.getElementById("flashEffect");

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
const filterBtns = document.querySelectorAll(".filter-btn");

// Modal Variables
const pdfNameModal = document.getElementById("pdfNameModal");
const pdfNameInput = document.getElementById("pdfNameInput");
const cancelPdfBtn = document.getElementById("cancelPdfBtn");
const confirmPdfBtn = document.getElementById("confirmPdfBtn");

let scannedImages = [];
let isOpenCvReady = false;
let cropper;
let originalCroppedMat = null;

// OpenCV Ready Check
function onOpenCvReady() {
  isOpenCvReady = true;
  statusDiv.style.background = "#27ae60";
  statusDiv.innerHTML = '<i class="fas fa-check-circle"></i> AI Scanner Ready!';
  captureBtn.disabled = false;
  setTimeout(() => (statusDiv.style.display = "none"), 3000);
}

// Start Camera
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    video.srcObject = stream;
  } catch (err) {
    alert("ক্যামেরা চালু করা যাচ্ছে না! পারমিশন চেক করুন।");
  }
}

// 1. Capture Image
captureBtn.addEventListener("click", () => {
  if (!isOpenCvReady) return;

  // Flash Effect
  flashEffect.classList.add("flash-active");
  setTimeout(() => flashEffect.classList.remove("flash-active"), 300);

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  cropImage.src = canvas.toDataURL("image/jpeg");

  cameraSection.style.display = "none";
  mainControls.style.display = "none";
  cropSection.style.display = "flex";
  cropControls.style.display = "flex";

  if (cropper) cropper.destroy();
  cropper = new Cropper(cropImage, {
    viewMode: 1,
    autoCropArea: 0.9,
    background: false,
    zoomable: false,
  });
});

// 2. Cancel Crop
cancelCropBtn.addEventListener("click", () => {
  cropSection.style.display = "none";
  cropControls.style.display = "none";
  cameraSection.style.display = "flex";
  mainControls.style.display = "flex";
  if (cropper) cropper.destroy();
});

// 3. Apply Crop & Go to Filters
applyCropBtn.addEventListener("click", () => {
  const croppedCanvas = cropper.getCroppedCanvas();

  if (originalCroppedMat) originalCroppedMat.delete();
  originalCroppedMat = cv.imread(croppedCanvas);

  cropSection.style.display = "none";
  cropControls.style.display = "none";
  filterSection.style.display = "flex";
  filterControls.style.display = "flex";

  applyFilter("magic");
  setActiveFilterBtn("magic");
});

// 4. Filter Buttons Logic
filterBtns.forEach((btn) => {
  btn.addEventListener("click", (e) => {
    const filterType = e.currentTarget.getAttribute("data-filter");
    applyFilter(filterType);
    setActiveFilterBtn(filterType);
  });
});

function setActiveFilterBtn(type) {
  filterBtns.forEach((btn) => btn.classList.remove("active"));
  document
    .querySelector(`.filter-btn[data-filter="${type}"]`)
    .classList.add("active");
}

function applyFilter(type) {
  let dst = new cv.Mat();

  if (type === "original") {
    originalCroppedMat.copyTo(dst);
  } else if (type === "magic") {
    originalCroppedMat.convertTo(dst, -1, 1.3, 30);
  } else if (type === "bw") {
    cv.cvtColor(originalCroppedMat, dst, cv.COLOR_RGBA2GRAY, 0);
    cv.adaptiveThreshold(
      dst,
      dst,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY,
      11,
      2,
    );
  }

  cv.imshow("filterCanvas", dst);
  dst.delete();
}

// 5. Back to Crop
backToCropBtn.addEventListener("click", () => {
  filterSection.style.display = "none";
  filterControls.style.display = "none";
  cropSection.style.display = "flex";
  cropControls.style.display = "flex";
});

// 6. Save to Gallery
saveFilterBtn.addEventListener("click", () => {
  const imgDataUrl = filterCanvas.toDataURL("image/jpeg", 0.8);
  scannedImages.push(imgDataUrl);
  updateGallery(imgDataUrl);

  filterSection.style.display = "none";
  filterControls.style.display = "none";
  cameraSection.style.display = "flex";
  mainControls.style.display = "flex";

  if (originalCroppedMat) {
    originalCroppedMat.delete();
    originalCroppedMat = null;
  }
  if (cropper) cropper.destroy();
});

function updateGallery(imgSrc) {
  const img = document.createElement("img");
  img.src = imgSrc;
  gallery.appendChild(img);
  pageCount.innerHTML = `<i class="fas fa-copy"></i> Pages: ${scannedImages.length}`;
  pdfBtn.style.display = "flex";
}

// 7. PDF Modal Logic
pdfBtn.addEventListener("click", () => {
  if (scannedImages.length === 0) return;
  pdfNameModal.style.display = "flex";
  pdfNameInput.focus();
});

cancelPdfBtn.addEventListener("click", () => {
  pdfNameModal.style.display = "none";
});

confirmPdfBtn.addEventListener("click", () => {
  let fileName = pdfNameInput.value.trim();
  if (!fileName) fileName = "WebScan_Document";
  if (!fileName.toLowerCase().endsWith(".pdf")) fileName += ".pdf";

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "px",
    format: [filterCanvas.width, filterCanvas.height],
  });

  scannedImages.forEach((img, index) => {
    if (index > 0)
      pdf.addPage([filterCanvas.width, filterCanvas.height], "portrait");
    pdf.addImage(img, "JPEG", 0, 0, filterCanvas.width, filterCanvas.height);
  });

  pdf.save(fileName);

  // Reset App
  scannedImages = [];
  gallery.innerHTML = "";
  pageCount.innerHTML = `<i class="fas fa-copy"></i> Pages: 0`;
  pdfBtn.style.display = "none";
  pdfNameModal.style.display = "none";
});

window.addEventListener("load", startCamera);
