/* =====================================================
   WebScan Pro
   Professional Scanner Engine
===================================================== */

"use strict";


/* =====================================================
   STATE
===================================================== */

const state = {

  stream: null,

  facingMode: "environment",

  flash: false,

  zoom: 1,

  pages: [],

  currentPage: 0,

  documents: [],

  editing: false,

  filter: "original",

  brightness: 0,

  contrast: 0,

  rotation: 0,

  exportFormat: "pdf",

  quality: "medium",

  documentName: "My Document",

  favorite: false,

  sharpness: 0,

  saturation: 0,

  exposure: 0,

  darkMode: true,

  autoCapture: false,

  showScanFrame: true
};


/* =====================================================
   ELEMENTS
===================================================== */

const $ = id => document.getElementById(id);

const screens = {

  home: $("homeScreen"),

  camera: $("cameraScreen"),

  editor: $("editorScreen"),

  export: $("exportScreen"),

  documents: $("documentsScreen"),

  pages: $("pagesScreen"),

  settings: $("settingsScreen")
};

const video = $("video");

const cameraCanvas = $("cameraCanvas");

const editorCanvas = $("editorCanvas");

const fileInput = $("fileInput");



/* =====================================================
   STORAGE
===================================================== */

function loadDocuments() {

  try {

    const saved =
      localStorage.getItem("webscan_documents");

    if (saved) {

      state.documents =
        JSON.parse(saved);

    }

  } catch (error) {

    console.error(error);

    state.documents = [];

  }

  renderRecent();

  renderDocuments();
}


function saveDocuments() {

  try {

    localStorage.setItem(
      "webscan_documents",
      JSON.stringify(state.documents)
    );

  } catch (error) {

    console.error(error);

    showToast(
      "Storage is full",
      "!"
    );
  }
}


function loadPreferences() {

  try {

    const saved =
      localStorage.getItem("webscan_preferences");

    if (saved) {

      Object.assign(
        state,
        JSON.parse(saved)
      );

    }

  } catch (error) {

    console.error(error);

  }
}


function savePreferences() {

  try {

    localStorage.setItem(
      "webscan_preferences",
      JSON.stringify({
        darkMode: state.darkMode,
        autoCapture: state.autoCapture,
        showScanFrame: state.showScanFrame
      })
    );

  } catch (error) {

    console.error(error);

  }
}



/* =====================================================
   SCREEN NAVIGATION
===================================================== */

function showScreen(name) {

  Object.values(screens)
    .forEach(screen => {

      screen.classList.remove("active");

    });

  screens[name].classList.add("active");

  window.scrollTo(0, 0);

}


function goHome() {

  stopCamera();

  showScreen("home");

  renderRecent();

}


function goDocuments() {

  stopCamera();

  showScreen("documents");

  renderDocuments();

}


function goSettings() {

  stopCamera();

  showScreen("settings");

}



/* =====================================================
   CAMERA
===================================================== */

async function startCamera() {

  stopCamera();

  $("cameraLoading")
    .classList.remove("hidden");

  $("cameraError")
    .classList.add("hidden");


  try {

    if (!navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia) {

      throw new Error(
        "Camera API unavailable"
      );

    }


    const constraints = {

      audio: false,

      video: {

        facingMode: {
          ideal: state.facingMode
        },

        width: {
          ideal: 1920
        },

        height: {
          ideal: 1080
        }
      }

    };


    state.stream =
      await navigator.mediaDevices
        .getUserMedia(constraints);


    video.srcObject = state.stream;

    await video.play();


    $("cameraLoading")
      .classList.add("hidden");


    $("cameraStatusText").textContent =
      "Ready to scan";


  } catch (error) {

    console.error(error);

    $("cameraLoading")
      .classList.add("hidden");

    $("cameraError")
      .classList.remove("hidden");

    $("cameraStatusText").textContent =
      "Camera unavailable";

  }

}


function stopCamera() {

  if (state.stream) {

    state.stream
      .getTracks()
      .forEach(track => track.stop());

    state.stream = null;

  }

  video.srcObject = null;

}



/* =====================================================
   OPEN CAMERA
===================================================== */

async function openCamera() {

  state.pages = [];

  state.currentPage = 0;

  updatePages();

  showScreen("camera");

  await startCamera();

}



/* =====================================================
   CAPTURE
===================================================== */

function capturePhoto() {

  if (!video.videoWidth) {

    showToast(
      "Camera is not ready",
      "!"
    );

    return;

  }


  cameraCanvas.width =
    video.videoWidth;

  cameraCanvas.height =
    video.videoHeight;


  const ctx =
    cameraCanvas.getContext("2d");


  ctx.drawImage(
    video,
    0,
    0,
    cameraCanvas.width,
    cameraCanvas.height
  );


  const data =
    cameraCanvas.toDataURL(
      "image/jpeg",
      qualityValue()
    );


  state.pages.push(
    createPage(data)
  );


  state.currentPage =
    state.pages.length - 1;


  updatePages();

  showToast(
    `Page ${state.pages.length} captured`
  );

}



/* =====================================================
   IMAGE IMPORT
===================================================== */

function openFilePicker() {

  fileInput.value = "";

  fileInput.click();

}


async function handleFiles(files) {

  if (!files || !files.length) {

    return;

  }


  const imageFiles =
    Array.from(files)
      .filter(file =>
        file.type.startsWith("image/")
      );


  for (const file of imageFiles) {

    try {

      const data =
        await fileToDataURL(file);


      // Corners detected at capture time pre-fill the manual crop
      // handles. Null for gallery imports and already-cropped scans.
      state.pages.push(
        createPage(
          data,
          window.webscanLastCorners || null
        )
      );


      window.webscanLastCorners = null;

    } catch (error) {

      console.error(error);

    }

  }


  state.currentPage =
    Math.max(0, state.pages.length - 1);


  updatePages();


  if (state.pages.length) {

    showScreen("editor");

    openEditor(
      state.currentPage
    );

  }

}


/*
  Builds a page with the full non-destructive edit model.

  `originalSrc` is written once here and never again, so the untouched
  capture is always recoverable no matter how the page is later cropped
  or adjusted.
*/
function createPage(data, corners = null) {

  return {

    id: Date.now() + Math.random(),

    src: data,

    originalSrc: data,

    corners: corners,

    originalCorners: corners
      ? corners.map(p => ({ ...p }))
      : null,

    filter: "original",

    brightness: 0,

    contrast: 0,

    sharpness: 0,

    saturation: 0,

    exposure: 0,

    rotation: 0

  };

}


function fileToDataURL(file) {

  return new Promise(
    (resolve, reject) => {

      const reader =
        new FileReader();

      reader.onload =
        () => resolve(reader.result);

      reader.onerror =
        reject;

      reader.readAsDataURL(file);

    }
  );

}



/* =====================================================
   PAGE UI
===================================================== */

function updatePages() {

  const count =
    state.pages.length;


  $("pageCount").textContent =
    `${count} ${count === 1 ? "page" : "pages"}`;


  $("scanPageLabel").textContent =
    `Page ${Math.max(1, count + 1)}`;


  const strip =
    $("pageStrip");

  strip.innerHTML = "";


  state.pages.forEach(
    (page, index) => {

      const wrapper =
        document.createElement("div");

      wrapper.className =
        "page-thumb";


      const img =
        document.createElement("img");

      img.src = page.src;


      const number =
        document.createElement("span");

      number.className =
        "page-thumb-number";

      number.textContent =
        index + 1;


      const del =
        document.createElement("button");

      del.className =
        "page-delete";

      del.textContent = "×";


      del.addEventListener(
        "click",
        event => {

          event.stopPropagation();

          deletePage(index);

        }
      );


      wrapper.appendChild(img);

      wrapper.appendChild(number);

      wrapper.appendChild(del);


      wrapper.addEventListener(
        "click",
        () => {

          openEditor(index);

        }
      );


      strip.appendChild(wrapper);

    }
  );


  // Keeps the page manager grid current when pages change elsewhere
  // (capture, import, delete) while it is open.
  window.WebScanPages?.refresh();


  // Lets the camera screen update its page counter chip.
  window.dispatchEvent(
    new Event("webscan-pages-changed")
  );

}


function deletePage(index) {

  if (!state.pages[index]) {

    return;

  }


  state.pages.splice(index, 1);


  if (!state.pages.length) {

    state.currentPage = 0;

    updatePages();

    showToast("All pages removed");

    return;

  }


  state.currentPage =
    Math.min(
      index,
      state.pages.length - 1
    );


  updatePages();

  showToast("Page deleted");

}



/* =====================================================
   EDITOR
===================================================== */

function openEditor(index = 0) {

  if (!state.pages.length) {

    showToast(
      "Capture a page first",
      "!"
    );

    return;

  }


  state.currentPage =
    Math.max(
      0,
      Math.min(
        index,
        state.pages.length - 1
      )
    );


  const page =
    state.pages[state.currentPage];


  loadPageIntoState(page);


  showScreen("editor");


  $("editorPageLabel").textContent =
    `Page ${state.currentPage + 1} of ${state.pages.length}`;


  // Seeds the history stack for this page on first open, so its
  // untouched state is the baseline undo returns to.
  window.WebScanHistory?.commit(page);

  updateHistoryButtons();


  renderEditor();

}


/*
  Copies a page's stored edits into the working state the editor
  renders from. Missing values fall back to defaults so pages saved by
  older versions still open correctly.
*/
function loadPageIntoState(page) {

  state.filter =
    page.filter || "original";

  state.brightness =
    page.brightness || 0;

  state.contrast =
    page.contrast || 0;

  state.sharpness =
    page.sharpness || 0;

  state.saturation =
    page.saturation || 0;

  state.exposure =
    page.exposure || 0;

  state.rotation =
    page.rotation || 0;

}


/*
  Writes the working state back onto the page. Every adjustment goes
  through here so nothing is stored in only one of the two places.
*/
function storeStateIntoPage(page) {

  if (!page) {

    return;

  }


  page.filter = state.filter;

  page.brightness = state.brightness;

  page.contrast = state.contrast;

  page.sharpness = state.sharpness;

  page.saturation = state.saturation;

  page.exposure = state.exposure;

  page.rotation = state.rotation;

}


function renderEditor() {

  const page =
    state.pages[state.currentPage];


  if (!page) {

    return;

  }


  const img =
    new Image();


  img.onload = () => {

    drawProcessedImage(
      img,
      editorCanvas
    );

  };


  img.src = page.src;


  document
    .querySelectorAll(".filter-btn")
    .forEach(btn => {

      btn.classList.toggle(
        "active",
        btn.dataset.filter === state.filter
      );

    });


  $("sliderValue").textContent =
    state.brightness;


  $("adjustSlider").value =
    state.brightness;

}


function drawProcessedImage(
  img,
  canvas
) {

  let width =
    img.naturalWidth;

  let height =
    img.naturalHeight;


  const rotation =
    ((state.rotation % 360) + 360) % 360;


  if (
    rotation === 90 ||
    rotation === 270
  ) {

    [width, height] =
      [height, width];

  }


  canvas.width = width;

  canvas.height = height;


  const ctx =
    canvas.getContext("2d");


  ctx.save();


  ctx.translate(
    width / 2,
    height / 2
  );


  ctx.rotate(
    rotation * Math.PI / 180
  );


  /*
    Pixel-level enhancement (shadow removal, adaptive thresholding)
    produces far better scans than CSS filters can, so it is used when
    the engine is available. Brightness/contrast sliders still apply on
    top as a canvas filter, and everything falls back to the original
    CSS-filter path if the engine or OpenCV is missing.
  */
  let source = img;

  const enhanced = enhanceSource(img);

  if (enhanced) {
    source = enhanced;
  }


  ctx.filter =
    enhanced
      ? buildSliderFilter()
      : buildCanvasFilter();


  ctx.drawImage(
    source,
    -img.naturalWidth / 2,
    -img.naturalHeight / 2
  );


  ctx.restore();


  ctx.filter = "none";

}


/*
  Runs the enhancement engine for the active filter and caches the
  result. Without the cache every brightness/contrast slider step would
  redo the full pixel pass and make dragging stutter.
*/
let enhanceCache = {
  key: null,
  canvas: null
};


function enhanceSource(img) {

  if (!window.WebScanEnhance) {

    return null;

  }


  // Nothing to do when the photo is untouched and unsharpened.
  if (
    state.filter === "original" &&
    !state.sharpness
  ) {

    return null;

  }


  const page =
    state.pages[state.currentPage];


  // Sharpness is part of the key because it changes pixels, unlike the
  // brightness/contrast sliders which are applied as a cheap filter.
  const key =
    `${page ? page.id : "none"}|${state.filter}|${state.sharpness}|${page ? page.src.length : 0}`;


  if (
    enhanceCache.key === key &&
    enhanceCache.canvas
  ) {

    return enhanceCache.canvas;

  }


  try {

    const base =
      document.createElement("canvas");

    base.width = img.naturalWidth;

    base.height = img.naturalHeight;

    base
      .getContext("2d")
      .drawImage(img, 0, 0);


    const result =
      window.WebScanEnhance.enhance(
        base,
        {
          mode: state.filter,

          shadowRemoval: true,

          // Slider is -100..100; only positive values sharpen. Mapped
          // to 0..0.5, the range where sharpening still adds real edge
          // detail before dark strokes begin to clip.
          sharpness:
            Math.max(0, state.sharpness) / 100 * 0.5
        }
      );


    enhanceCache = {
      key,
      canvas: result
    };


    return result;

  } catch (error) {

    console.warn(error);

    return null;

  }

}


/*
  Manual adjustments only. Used when the enhancement engine has already
  applied the filter mode, so the look is not doubled up.

  Exposure multiplies brightness rather than adding to it, matching how
  camera exposure behaves: it scales light instead of shifting levels.
*/
function buildSliderFilter() {

  const exposureFactor =
    1 + (state.exposure / 100) * 0.6;


  const brightness =
    (100 + state.brightness) * exposureFactor;


  return `
    brightness(${brightness.toFixed(1)}%)
    contrast(${100 + state.contrast}%)
    saturate(${100 + state.saturation}%)
  `;

}


function buildCanvasFilter() {

  // Exposure scales brightness the way a camera does, so it stacks with
  // the brightness slider instead of competing with it.
  const exposureFactor =
    1 + (state.exposure / 100) * 0.6;


  let brightness =
    (100 + state.brightness) * exposureFactor;

  let contrast =
    100 + state.contrast;


  // Appended to whichever preset is chosen below. Grayscale presets
  // deliberately ignore it, since saturating a grey image does nothing.
  const extra =
    ` saturate(${100 + state.saturation}%)`;


  switch (state.filter) {

    case "bw":

      return `
        grayscale(1)
        brightness(${brightness}%)
        contrast(${contrast}%)
      `;


    case "gray":

      return `
        grayscale(.85)
        brightness(${brightness}%)
        contrast(${contrast}%)
      `;


    case "document":

      return `
        grayscale(.35)
        brightness(${Math.min(145, brightness + 10)}%)
        contrast(${Math.min(180, contrast + 35)}%)
      `;


    case "auto":

      return `
        brightness(${Math.min(135, brightness + 8)}%)
        contrast(${Math.min(145, contrast + 15)}%)
      ` + extra;


    case "magic":

      // Fallback only. The real Magic Color runs in the enhancement
      // engine; this keeps colours sensible if that is unavailable.
      return `
        saturate(${140 + state.saturation}%)
        brightness(${Math.min(130, brightness + 6)}%)
        contrast(${Math.min(150, contrast + 20)}%)
      `;


    default:

      return `
        brightness(${brightness}%)
        contrast(${contrast}%)
      ` + extra;

  }

}



/* =====================================================
   EDITOR ACTIONS
===================================================== */

function applyFilter(filter) {

  state.filter = filter;

  state.pages[state.currentPage].filter =
    filter;

  renderEditor();

  // Each filter choice is one discrete undo step.
  commitEditorHistory();

}


function rotateImage() {

  state.rotation =
    (state.rotation + 90) % 360;


  state.pages[state.currentPage].rotation =
    state.rotation;


  renderEditor();

  commitEditorHistory();

}


function resetEditor() {

  const page =
    state.pages[state.currentPage];


  if (!page) {

    return;

  }


  // Restores the defaults AND the untouched capture, so a crop is
  // undone too. Recorded as a step, so Reset itself can be undone.
  window.WebScanHistory?.reset(page);


  afterHistoryChange(page);


  showToast("Edits reset");

}


function saveEditorChanges() {

  const page =
    state.pages[state.currentPage];


  if (!page) {

    return;

  }


  page.filter =
    state.filter;

  page.brightness =
    state.brightness;

  page.contrast =
    state.contrast;

  page.rotation =
    state.rotation;


  showToast("Changes saved");

}



/* =====================================================
   EDIT HISTORY
===================================================== */

function commitEditorHistory() {

  const page =
    state.pages[state.currentPage];


  if (!page) {

    return;

  }


  storeStateIntoPage(page);

  window.WebScanHistory?.commit(page);

  updateHistoryButtons();

}


function updateHistoryButtons() {

  const page =
    state.pages[state.currentPage];


  const history =
    window.WebScanHistory;


  $("undoBtn").disabled =
    !history || !history.canUndo(page);


  $("redoBtn").disabled =
    !history || !history.canRedo(page);

}


/*
  Applies a history step and refreshes everything that reflects it.
  Used by undo, redo and reset so they cannot drift apart.
*/
function afterHistoryChange(page) {

  loadPageIntoState(page);

  enhanceCache = { key: null, canvas: null };

  renderEditor();

  updatePages();

  updateHistoryButtons();

}



/* =====================================================
   SLIDER
===================================================== */

// Every slider-driven adjustment, keyed by the button's data-tool.
const ADJUST_TOOLS = {

  brightness: { label: "Brightness" },

  contrast: { label: "Contrast" },

  exposure: { label: "Exposure" },

  saturation: { label: "Saturation" },

  sharpness: { label: "Sharpness" }

};


function activateAdjust(tool) {

  const config =
    ADJUST_TOOLS[tool];


  if (!config) {

    return;

  }


  const box =
    $("adjustSliderBox");

  const slider =
    $("adjustSlider");


  box.classList.remove("hidden");


  $("sliderLabel").textContent =
    config.label;


  slider.value =
    state[tool];


  slider.dataset.tool =
    tool;


  $("sliderValue").textContent =
    slider.value;

}


$("adjustSlider").addEventListener(
  "input",
  () => {

    const slider =
      $("adjustSlider");


    const tool =
      slider.dataset.tool;


    if (!ADJUST_TOOLS[tool]) {

      return;

    }


    const value =
      Number(slider.value);


    $("sliderValue").textContent =
      value;


    state[tool] = value;


    storeStateIntoPage(
      state.pages[state.currentPage]
    );


    renderEditor();

  }
);


/*
  History is recorded when the drag ends, not on every input event, so
  one slider gesture becomes a single undo step instead of hundreds.
*/
["change", "pointerup", "touchend"].forEach(event => {

  $("adjustSlider").addEventListener(
    event,
    commitEditorHistory
  );

});



/* =====================================================
   FINISH SCAN
===================================================== */

function finishScan() {

  if (!state.pages.length) {

    showToast(
      "Scan at least one page",
      "!"
    );

    return;

  }


  stopCamera();


  state.documentName =
    `Scan ${new Date().toLocaleDateString()}`;


  state.favorite = false;


  $("documentNameInput").value =
    state.documentName;


  $("exportName").textContent =
    state.documentName;


  $("exportPages").textContent =
    `${state.pages.length} ${
      state.pages.length === 1
        ? "page"
        : "pages"
    }`;


  showScreen("export");

}



/* =====================================================
   EXPORT SETTINGS
===================================================== */

function qualityValue() {

  switch (state.quality) {

    case "low":
      return .65;

    case "high":
      return .95;

    default:
      return .85;

  }

}


document
  .querySelectorAll(".format-btn")
  .forEach(btn => {

    btn.addEventListener(
      "click",
      () => {

        document
          .querySelectorAll(".format-btn")
          .forEach(x =>
            x.classList.remove("active")
          );


        btn.classList.add("active");


        state.exportFormat =
          btn.dataset.format;

      }
    );

  });


document
  .querySelectorAll(".quality-btn")
  .forEach(btn => {

    btn.addEventListener(
      "click",
      () => {

        document
          .querySelectorAll(".quality-btn")
          .forEach(x =>
            x.classList.remove("active")
          );


        btn.classList.add("active");


        state.quality =
          btn.dataset.quality;

      }
    );

  });



/* =====================================================
   CREATE PROCESSED IMAGE
===================================================== */

async function createProcessedData(
  page
) {

  const img =
    await loadImage(page.src);


  const oldFilter =
    state.filter;

  const oldBrightness =
    state.brightness;

  const oldContrast =
    state.contrast;

  const oldRotation =
    state.rotation;


  state.filter =
    page.filter || "original";

  state.brightness =
    page.brightness || 0;

  state.contrast =
    page.contrast || 0;

  state.rotation =
    page.rotation || 0;


  const canvas =
    document.createElement("canvas");


  drawProcessedImage(
    img,
    canvas
  );


  const data =
    canvas.toDataURL(
      "image/jpeg",
      qualityValue()
    );


  state.filter =
    oldFilter;

  state.brightness =
    oldBrightness;

  state.contrast =
    oldContrast;

  state.rotation =
    oldRotation;


  return data;

}


function loadImage(src) {

  return new Promise(
    (resolve, reject) => {

      const img =
        new Image();

      img.onload =
        () => resolve(img);

      img.onerror =
        reject;

      img.src = src;

    }
  );

}



/* =====================================================
   EXPORT JPG
===================================================== */

async function exportJPG() {

  const page =
    state.pages[0];


  if (!page) {

    return;

  }


  const data =
    await createProcessedData(page);


  const link =
    document.createElement("a");


  link.href = data;

  link.download =
    `${safeFilename(state.documentName)}.jpg`;


  link.click();

}



/* =====================================================
   SIMPLE PDF GENERATOR
===================================================== */

async function exportPDF() {

  const images = [];


  for (
    const page of state.pages
  ) {

    images.push(
      await createProcessedData(page)
    );

  }


  const pdf =
    buildPDF(images);


  const blob =
    new Blob(
      [pdf],
      {
        type: "application/pdf"
      }
    );


  const url =
    URL.createObjectURL(blob);


  const link =
    document.createElement("a");


  link.href = url;

  link.download =
    `${safeFilename(state.documentName)}.pdf`;


  document.body.appendChild(link);

  link.click();

  link.remove();


  setTimeout(
    () => URL.revokeObjectURL(url),
    1000
  );

}


function buildPDF(dataUrls) {

  const objects = [];

  const pages = [];

  let objectNumber = 3;


  dataUrls.forEach(
    dataUrl => {

      const binary =
        dataUrlToBinary(dataUrl);


      const dimensions =
        getJpegDimensions(binary);


      const imageObject =
        objectNumber++;


      const contentObject =
        objectNumber++;


      const pageObject =
        objectNumber++;


      objects.push({

        number: imageObject,

        body:
`<<
/Type /XObject
/Subtype /Image
/Width ${dimensions.width}
/Height ${dimensions.height}
/ColorSpace /DeviceRGB
/BitsPerComponent 8
/Filter /DCTDecode
/Length ${binary.length}
>>
stream
${binary}
endstream`

      });


      const pageWidth = 595;

      const pageHeight = 842;


      const scale =
        Math.min(
          pageWidth / dimensions.width,
          pageHeight / dimensions.height
        );


      const drawWidth =
        dimensions.width * scale;

      const drawHeight =
        dimensions.height * scale;


      const x =
        (pageWidth - drawWidth) / 2;

      const y =
        (pageHeight - drawHeight) / 2;


      const content =
`q
${drawWidth} 0 0 ${drawHeight} ${x} ${y} cm
/Im1 Do
Q`;


      objects.push({

        number: contentObject,

        body:
`<<
/Length ${content.length}
>>
stream
${content}
endstream`

      });


      objects.push({

        number: pageObject,

        body:
`<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 ${pageWidth} ${pageHeight}]
/Resources <<
/XObject <<
/Im1 ${imageObject} 0 R
>>
>>
/Contents ${contentObject} 0 R
>>`

      });


      pages.push(
        `${pageObject} 0 R`
      );

    }
  );


  objects.unshift({

    number: 2,

    body:
`<<
/Type /Pages
/Count ${pages.length}
/Kids [${pages.join(" ")}]
>>`

  });


  objects.unshift({

    number: 1,

    body:
`<<
/Type /Catalog
/Pages 2 0 R
>>`

  });


  let pdf =
    "%PDF-1.3\n";


  const offsets = [0];


  objects.forEach(
    object => {

      offsets[object.number] =
        pdf.length;


      pdf +=
        `${object.number} 0 obj\n`;


      pdf +=
        object.body;


      pdf +=
        "\nendobj\n";

    }
  );


  const xref =
    pdf.length;


  pdf +=
`xref
0 ${objectNumber}
0000000000 65535 f
`;


  for (
    let i = 1;
    i < objectNumber;
    i++
  ) {

    pdf +=
      String(
        offsets[i] || 0
      )
      .padStart(10, "0")
      +
      " 00000 n\n";

  }


  pdf +=
`trailer
<<
/Size ${objectNumber}
/Root 1 0 R
>>
startxref
${xref}
%%EOF`;


  return pdf;

}


function dataUrlToBinary(dataUrl) {

  const base64 =
    dataUrl.split(",")[1];

  const raw =
    atob(base64);


  let binary = "";

  for (
    let i = 0;
    i < raw.length;
    i++
  ) {

    binary += raw[i];

  }


  return binary;

}


function getJpegDimensions(binary) {

  let offset = 2;


  while (
    offset < binary.length
  ) {

    if (
      binary.charCodeAt(offset) !== 0xFF
    ) {

      offset++;

      continue;

    }


    const marker =
      binary.charCodeAt(offset + 1);


    const length =
      (binary.charCodeAt(offset + 2) << 8)
      +
      binary.charCodeAt(offset + 3);


    if (
      marker >= 0xC0 &&
      marker <= 0xC3
    ) {

      return {

        height:
          (binary.charCodeAt(offset + 5) << 8)
          +
          binary.charCodeAt(offset + 6),

        width:
          (binary.charCodeAt(offset + 7) << 8)
          +
          binary.charCodeAt(offset + 8)

      };

    }


    offset +=
      2 + length;

  }


  return {
    width: 1000,
    height: 1400
  };

}



/* =====================================================
   SAVE DOCUMENT
===================================================== */

async function exportDocument() {

  state.documentName =
    $("documentNameInput")
      .value
      .trim()
      ||
      "My Document";


  if (!state.pages.length) {

    showToast(
      "No pages to export",
      "!"
    );

    return;

  }


  const documentItem = {

    id:
      Date.now(),

    name:
      state.documentName,

    date:
      new Date().toISOString(),

    favorite:
      state.favorite,

    /*
      `originalSrc` exists so edits stay reversible during a session.
      Once a document is saved the edits are final, so it is dropped
      here — keeping it would double every document's storage cost
      against a localStorage quota that is already limited.
    */
    pages:
      state.pages.map(page => {

        const copy = { ...page };

        delete copy.originalSrc;

        delete copy.originalCorners;

        return copy;

      })

  };


  state.documents.unshift(
    documentItem
  );


  saveDocuments();


  try {

    if (
      state.exportFormat === "jpg"
    ) {

      await exportJPG();

    } else {

      await exportPDF();

    }


    showToast(
      "Document exported"
    );


    setTimeout(
      () => {

        state.pages = [];

        goHome();

      },
      700
    );


  } catch (error) {

    console.error(error);

    showToast(
      "Export failed",
      "!"
    );

  }

}



/* =====================================================
   DOCUMENT LIST
===================================================== */

function renderRecent() {

  const list =
    $("recentList");


  const recent =
    state.documents.slice(0, 5);


  if (!recent.length) {

    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📄</div>
        <strong>No scans yet</strong>
        <span>
          Your scanned documents will appear here.
        </span>
      </div>
    `;

    return;

  }


  list.innerHTML =
    recent
      .map(documentCardHTML)
      .join("");

}


function renderDocuments() {

  const list =
    $("documentsList");


  $("documentsCount").textContent =
    `${state.documents.length} ${
      state.documents.length === 1
        ? "document"
        : "documents"
    }`;


  if (!state.documents.length) {

    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📄</div>
        <strong>No documents</strong>
        <span>
          Start scanning to create your first document.
        </span>
      </div>
    `;

    return;

  }


  list.innerHTML =
    state.documents
      .map(documentCardHTML)
      .join("");

}


function documentCardHTML(doc) {

  const firstPage =
    doc.pages &&
    doc.pages[0];


  const image =
    firstPage
      ? firstPage.src
      : "";


  const date =
    new Date(doc.date)
      .toLocaleDateString();


  const favorite =
    doc.favorite
      ? "⭐"
      : "";


  return `
    <div
      class="document-card"
      data-id="${doc.id}"
    >

      <div class="document-thumb">
        ${
          image
            ? `<img src="${image}" alt="">`
            : "📄"
        }
      </div>

      <div class="document-info">

        <strong>
          ${escapeHTML(doc.name)}
        </strong>

        <span>
          ${doc.pages.length} ${
            doc.pages.length === 1
              ? "page"
              : "pages"
          }
          •
          ${date}
          ${favorite}
        </span>

      </div>

      <button
        class="document-menu"
        data-menu="${doc.id}"
      >
        ⋮
      </button>

    </div>
  `;

}



/* =====================================================
   FAVORITE
===================================================== */

function toggleFavorite() {

  state.favorite =
    !state.favorite;


  $("favoriteBtn").textContent =
    state.favorite
      ? "★"
      : "☆";

}


function toggleSavedFavorite(id) {

  const doc =
    state.documents.find(
      x => x.id == id
    );


  if (!doc) {

    return;

  }


  doc.favorite =
    !doc.favorite;


  saveDocuments();

  renderDocuments();

  renderRecent();

}



/* =====================================================
   SAFE FILENAME
===================================================== */

function safeFilename(name) {

  return name
    .replace(/[<>:"/\\|?*]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 80)
    ||
    "WebScan_Document";

}


function escapeHTML(text) {

  const div =
    document.createElement("div");

  div.textContent =
    text;

  return div.innerHTML;

}



/* =====================================================
   TOAST
===================================================== */

let toastTimer;


function showToast(
  message,
  icon = "✓"
) {

  $("toastText").textContent =
    message;

  $("toastIcon").textContent =
    icon;


  const toast =
    $("toast");


  toast.classList.add("show");


  clearTimeout(toastTimer);


  toastTimer =
    setTimeout(
      () => {

        toast.classList.remove("show");

      },
      2200
    );

}



/* =====================================================
   EVENT LISTENERS
===================================================== */


/* HOME */

$("scanBtn")
  .addEventListener(
    "click",
    openCamera
  );


$("bottomScanBtn")
  .addEventListener(
    "click",
    openCamera
  );


$("importBtn")
  .addEventListener(
    "click",
    openFilePicker
  );


$("fileInput")
  .addEventListener(
    "change",
    event =>
      handleFiles(event.target.files)
  );


$("settingsBtn")
  .addEventListener(
    "click",
    goSettings
  );


$("viewAllBtn")
  .addEventListener(
    "click",
    goDocuments
  );



/* QUICK */

document
  .querySelectorAll(".quick-card")
  .forEach(card => {

    card.addEventListener(
      "click",
      () => {

        const action =
          card.dataset.action;


        if (action === "camera") {

          openCamera();

        }

        if (action === "gallery") {

          openFilePicker();

        }

        if (action === "documents") {

          goDocuments();

        }

        if (action === "favorites") {

          goDocuments();

        }

      }
    );

  });



/* CAMERA */

$("closeCameraBtn")
  .addEventListener(
    "click",
    goHome
  );


$("retryCameraBtn")
  .addEventListener(
    "click",
    startCamera
  );


$("captureBtn")
  .addEventListener(
    "click",
    capturePhoto
  );


$("finishScanBtn")
  .addEventListener(
    "click",
    finishScan
  );


$("switchCameraBtn")
  .addEventListener(
    "click",
    async () => {

      state.facingMode =
        state.facingMode === "environment"
          ? "user"
          : "environment";


      await startCamera();

    }
  );


$("flashBtn")
  .addEventListener(
    "click",
    () => {

      state.flash =
        !state.flash;


      $("flashBtn")
        .classList.toggle(
          "active",
          state.flash
        );


      /*
        Browser camera flash support depends
        on the device/browser.
      */

      if (state.stream) {

        const track =
          state.stream
            .getVideoTracks()[0];


        const capabilities =
          track.getCapabilities
            ? track.getCapabilities()
            : {};


        if (
          capabilities.torch
        ) {

          track.applyConstraints({
            advanced: [
              {
                torch:
                  state.flash
              }
            ]
          })
          .catch(() => {});

        }

      }

    }
  );


$("zoomInBtn")
  .addEventListener(
    "click",
    () => {

      state.zoom =
        Math.min(
          3,
          state.zoom + .25
        );


      video.style.transform =
        `scale(${state.zoom})`;

    }
  );


$("zoomOutBtn")
  .addEventListener(
    "click",
    () => {

      state.zoom =
        Math.max(
          1,
          state.zoom - .25
        );


      video.style.transform =
        `scale(${state.zoom})`;

    }
  );



/* EDITOR */

$("editorBackBtn")
  .addEventListener(
    "click",
    () => {

      showScreen("camera");

    }
  );


$("editorDoneBtn")
  .addEventListener(
    "click",
    saveEditorChanges
  );


$("saveEditedBtn")
  .addEventListener(
    "click",
    () => {

      saveEditorChanges();

      showScreen("camera");

      updatePages();

    }
  );


$("rotateBtn")
  .addEventListener(
    "click",
    rotateImage
  );


$("undoBtn")
  .addEventListener(
    "click",
    () => {

      const page =
        state.pages[state.currentPage];


      if (window.WebScanHistory?.undo(page)) {

        afterHistoryChange(page);

        showToast("Undone");

      }

    }
  );


$("redoBtn")
  .addEventListener(
    "click",
    () => {

      const page =
        state.pages[state.currentPage];


      if (window.WebScanHistory?.redo(page)) {

        afterHistoryChange(page);

        showToast("Redone");

      }

    }
  );


$("editorPagesBtn")
  .addEventListener(
    "click",
    () => {

      if (!state.pages.length) {

        showToast(
          "No pages yet",
          "!"
        );

        return;

      }


      window.WebScanPages?.open();

    }
  );


$("cropBtn")
  .addEventListener(
    "click",
    () => {

      const page =
        state.pages[state.currentPage];


      if (!page || !window.WebScanCrop) {

        showToast(
          "Crop is unavailable",
          "!"
        );

        return;

      }


      window.WebScanCrop.open({

        dataUrl: page.src,

        // Corners saved at capture time seed the handles, so manual
        // adjustment starts from the automatic result instead of a
        // generic rectangle.
        initialCorners: page.corners,

        onApply: (canvas) => {

          // Only `src` changes; `originalSrc` is left untouched so the
          // untouched capture survives and Reset/undo can restore it.
          page.src =
            canvas.toDataURL(
              "image/jpeg",
              0.95
            );


          // The image is now physically cropped, so stored corners no
          // longer describe it and must not be reused.
          page.corners = null;


          // The page id is unchanged but its pixels are not, so the
          // cached enhancement must be dropped or a stale image shows.
          enhanceCache = { key: null, canvas: null };


          window.WebScanHistory?.commit(page);


          renderEditor();

          updatePages();

          showToast("Crop applied");

        }

      });

    }
  );


$("resetEditBtn")
  .addEventListener(
    "click",
    resetEditor
  );


document
  .querySelectorAll(".filter-btn")
  .forEach(btn => {

    btn.addEventListener(
      "click",
      () =>
        applyFilter(
          btn.dataset.filter
        )
    );

  });


document
  .querySelectorAll(".adjust-btn")
  .forEach(btn => {

    btn.addEventListener(
      "click",
      () => {

        if (btn.dataset.tool) {

          activateAdjust(
            btn.dataset.tool
          );

        }

      }
    );

  });



/* EXPORT */

$("exportBackBtn")
  .addEventListener(
    "click",
    () => {

      showScreen("camera");

    }
  );


$("documentNameInput")
  .addEventListener(
    "input",
    event => {

      $("exportName").textContent =
        event.target.value ||
        "My Document";

    }
  );


$("favoriteBtn")
  .addEventListener(
    "click",
    toggleFavorite
  );


$("exportBtn")
  .addEventListener(
    "click",
    exportDocument
  );



/* DOCUMENTS */

$("documentsScanBtn")
  .addEventListener(
    "click",
    openCamera
  );


$("documentsSearchBtn")
  .addEventListener(
    "click",
    () => {

      showToast(
        "Search coming soon"
      );

    }
  );


$("documentsList")
  .addEventListener(
    "click",
    event => {

      const menu =
        event.target.closest(
          "[data-menu]"
        );


      if (menu) {

        toggleSavedFavorite(
          menu.dataset.menu
        );

      }

    }
  );



/* SETTINGS */

function applyPreferences() {

  document.body.classList.toggle(
    "light-mode",
    !state.darkMode
  );

  document
    .querySelectorAll(".scan-frame")
    .forEach(frame => {

      frame.classList.toggle(
        "hidden",
        !state.showScanFrame
      );

    });

  window.webscanAutoCapture = state.autoCapture;

  // Lets the camera screen's AUTO button change the same setting instead
  // of holding its own copy, so both controls always agree.
  window.webscanSetAutoCapture = (enabled) => {

    state.autoCapture = !!enabled;

    applyPreferences();

    savePreferences();

  };

  window.dispatchEvent(
    new Event("webscan-autocapture-changed")
  );

  $("darkModeToggle")
    .querySelector(".toggle")
    .classList.toggle(
      "active",
      state.darkMode
    );

  $("autoCaptureToggle")
    .querySelector(".toggle")
    .classList.toggle(
      "active",
      state.autoCapture
    );

  $("scanFrameToggle")
    .querySelector(".toggle")
    .classList.toggle(
      "active",
      state.showScanFrame
    );

}


$("darkModeToggle")
  .addEventListener(
    "click",
    () => {

      state.darkMode = !state.darkMode;

      applyPreferences();

      savePreferences();

    }
  );


$("autoCaptureToggle")
  .addEventListener(
    "click",
    () => {

      state.autoCapture = !state.autoCapture;

      applyPreferences();

      savePreferences();

    }
  );


$("scanFrameToggle")
  .addEventListener(
    "click",
    () => {

      state.showScanFrame = !state.showScanFrame;

      applyPreferences();

      savePreferences();

    }
  );


$("settingsBackBtn")
  .addEventListener(
    "click",
    goHome
  );


$("clearStorageBtn")
  .addEventListener(
    "click",
    () => {

      const confirmed =
        confirm(
          "Delete all saved WebScan documents?"
        );


      if (!confirmed) {

        return;

      }


      localStorage.removeItem(
        "webscan_documents"
      );


      state.documents = [];


      renderRecent();

      renderDocuments();


      showToast(
        "Local data cleared"
      );

    }
  );



/* NAVIGATION */

document
  .querySelectorAll("[data-nav]")
  .forEach(btn => {

    btn.addEventListener(
      "click",
      () => {

        const nav =
          btn.dataset.nav;


        if (nav === "home") {

          goHome();

        }

        if (nav === "documents") {

          goDocuments();

        }

        if (nav === "favorites") {

          goDocuments();

        }

        if (nav === "settings") {

          goSettings();

        }

      }
    );

  });



/* =====================================================
   KEYBOARD
===================================================== */

document.addEventListener(
  "keydown",
  event => {

    if (
      event.key === "Escape"
    ) {

      if (
        screens.camera.classList.contains("active") ||
        screens.editor.classList.contains("active")
      ) {

        goHome();

      }

    }

  }
);



/* =====================================================
   VISIBILITY
===================================================== */

document.addEventListener(
  "visibilitychange",
  () => {

    if (
      document.hidden
    ) {

      /*
        Do not force-stop camera here.
        Mobile browsers can temporarily hide
        the page during permission dialogs.
      */

    }

  }
);



/* =====================================================
   PAGE MANAGER BRIDGE

   page-manager.js edits the same state.pages array used
   everywhere else, and calls back here so the camera strip,
   editor and counters stay in sync.
===================================================== */

window.webscanState = state;

window.webscanPageAPI = {

  showScreen,

  showToast,

  updatePages,

  openEditor,

  deletePage,

  fileToDataURL,


  addPage() {

    // Reuses the normal capture flow so a page added from the manager
    // goes through exactly the same pipeline as any other scan.
    showScreen("camera");

    startCamera();

  },


  cropPage(index) {

    const page = state.pages[index];


    if (!page || !window.WebScanCrop) {

      showToast(
        "Crop is unavailable",
        "!"
      );

      return;

    }


    window.WebScanCrop.open({

      dataUrl: page.src,

      initialCorners: page.corners,

      onApply: (canvas) => {

        // originalSrc is deliberately not touched, keeping the crop
        // reversible through undo and Reset.
        page.src =
          canvas.toDataURL(
            "image/jpeg",
            0.95
          );

        page.corners = null;

        enhanceCache = { key: null, canvas: null };

        window.WebScanHistory?.commit(page);


        window.WebScanPages?.refresh();

        updatePages();


        if (state.currentPage === index) {

          renderEditor();

        }


        showToast("Crop applied");

      }

    });

  },


  invalidateEnhanceCache() {

    enhanceCache = { key: null, canvas: null };

  },


  refreshEditor(index) {

    // Only redraw when the edited page is the one on screen.
    if (
      state.currentPage === index &&
      screens.editor.classList.contains("active")
    ) {

      renderEditor();

    }

  },


  goBackFromPages() {

    // Return to wherever the manager makes sense to leave: the editor
    // if pages exist, otherwise home.
    if (state.pages.length) {

      openEditor(
        Math.min(
          state.currentPage,
          state.pages.length - 1
        )
      );

    } else {

      goHome();

    }

  }

};



/* =====================================================
   INIT
===================================================== */

loadDocuments();

loadPreferences();

applyPreferences();

showScreen("home");
