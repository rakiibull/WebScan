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

  // id of the just-captured page auto-crop couldn't confidently handle,
  // so the editor's fallback notice knows which page (if any) to show
  // itself for. Cleared once addressed; never persisted with the page.
  autoCropFailedPageId: null,

  documents: [],

  editing: false,

  filter: "original",

  brightness: 0,

  contrast: 0,

  rotation: 0,

  exportFormat: "pdf",

  quality: "medium",

  // Document list view options.
  search: "",

  sortBy: "newest",

  folderFilter: "all",

  showTrash: false,

  // PDF layout options.
  pageSize: "a4",

  orientation: "auto",

  compression: "balanced",

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

/* Folders a document can be filed under. */
const FOLDERS = [

  { id: "none", label: "Unfiled", icon: "📄" },

  { id: "work", label: "Work", icon: "📁" },

  { id: "study", label: "Study", icon: "📁" },

  { id: "personal", label: "Personal", icon: "📁" },

  { id: "receipts", label: "Receipts", icon: "📁" }

];


/*
  Brings a stored document up to the current shape.

  Documents saved by earlier versions have no folder or trash fields, so
  reading them straight back would make every filter and sort misbehave.
  Filling the gaps on load keeps old scans working untouched.
*/
function migrateDocument(doc) {

  return {

    ...doc,

    folder: doc.folder || "none",

    // Soft delete: trashed documents stay recoverable until purged.
    deleted: doc.deleted === true,

    deletedAt: doc.deletedAt || null,

    favorite: doc.favorite === true

  };

}


function loadDocuments() {

  try {

    const saved =
      localStorage.getItem("webscan_documents");

    if (saved) {

      state.documents =
        JSON.parse(saved)
          .map(migrateDocument);

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
      window.WebScanMessages?.NOTICE?.storageFull || "Not enough space to save. Delete old documents and try again.",
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


/*
  Opens the document list.

  `filter` selects which chip the list lands on. The Favorites entry
  points previously routed here without one, so tapping Favorites
  showed every document -- the filtering itself already existed and
  simply was never switched on.
*/
function goDocuments(filter) {

  stopCamera();


  if (filter) {

    state.folderFilter = filter;

    // Trash is a separate view; arriving from Favorites should leave it.
    state.showTrash = false;

    // Keeps the trash button and "Empty trash" action in step with the
    // state change above (hoisted; defined with the trash handlers).
    applyTrashView();

  }


  showScreen("documents");

  // renderDocuments() refreshes the chips itself.
  renderDocuments();

}


function goSettings() {

  stopCamera();

  showScreen("settings");

}



/* =====================================================
   CAMERA
===================================================== */

/*
  True when the viewport is taller than it is wide.

  The camera view fills the screen, so the viewport is what the stream
  has to match. Screen orientation APIs differ across iOS, Android and
  desktop; comparing the actual box works the same everywhere.
*/
function isPortraitViewport() {

  return window.innerHeight >= window.innerWidth;

}


/*
  Forces the active video track back to its minimum (1x) hardware
  zoom, if the browser exposes zoom as a track capability.

  This runs every time the camera (re)starts, since some devices
  otherwise open on a telephoto lens or a remembered zoom level
  instead of the plain wide-angle view.
*/
function resetTrackZoom() {

  const track =
    state.stream
      ?.getVideoTracks?.()[0];

  const capabilities =
    track?.getCapabilities
      ? track.getCapabilities()
      : {};

  if (!capabilities.zoom) {
    return;
  }

  track.applyConstraints({
    advanced: [
      {
        zoom: capabilities.zoom.min ?? 1
      }
    ]
  })
  .catch(() => {});

}


/*
  Explicitly asks the active track for continuous autofocus, if the
  browser exposes focus mode as a track capability.

  The initial `getUserMedia` constraint is only a hint some browsers
  ignore once the stream is already running, so it is reasserted here
  the same way zoom is above -- without this, some Android/Chrome
  combinations focus once on whatever the lens saw first and never
  refocus as the document is brought into frame.
*/
function resetTrackFocus() {

  const track =
    state.stream
      ?.getVideoTracks?.()[0];

  const capabilities =
    track?.getCapabilities
      ? track.getCapabilities()
      : {};

  if (!capabilities.focusMode?.includes?.("continuous")) {
    return;
  }

  track.applyConstraints({
    advanced: [
      {
        focusMode: "continuous"
      }
    ]
  })
  .catch(() => {});

}


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


    /*
      Resolution is requested in the orientation the screen is actually
      in.

      Asking for a fixed 1920x1080 on a portrait phone made browsers
      hand back a landscape stream, which `object-fit: cover` then
      cropped hard -- measured at 75% of the frame width discarded on
      Android Chrome. The document was still detected in the full frame,
      so the outline could sit on parts of the page the user could not
      even see.
    */
    const portrait =
      isPortraitViewport();


    // Ideal only, so a device that can't reach this just hands back
    // whatever its camera's closest supported size is -- document text
    // needs more detail than 1080p can hold, and this costs detection
    // nothing since findDocumentCorners works from its own downscaled
    // copy regardless of the source size.
    const longEdge = 3840;

    const shortEdge = 2160;


    const constraints = {

      audio: false,

      video: {

        facingMode: {
          ideal: state.facingMode
        },

        width: {
          ideal: portrait ? shortEdge : longEdge
        },

        height: {
          ideal: portrait ? longEdge : shortEdge
        },

        // A hint only; browsers that ignore it still get a usable
        // stream from the width/height above.
        aspectRatio: {
          ideal: portrait
            ? shortEdge / longEdge
            : longEdge / shortEdge
        },

        /*
          Some phones (notably multi-lens Android devices) default the
          "environment" camera to a 2x telephoto lens instead of the
          main wide lens, which reads as an unwanted zoom the moment
          the camera opens. Asking for 1x here corrects that on
          browsers that expose zoom as a constraint up front.
        */
        zoom: {
          ideal: 1
        },

        // Also a hint only; reasserted on the live track below since
        // some browsers ignore it here once the stream has started.
        focusMode: {
          ideal: "continuous"
        }
      }

    };


    state.stream =
      await navigator.mediaDevices
        .getUserMedia(constraints);


    video.srcObject = state.stream;

    await video.play();


    /*
      Constraints alone don't always take on every device, so the
      zoom is also reset directly on the track once it's live. This
      is the same mechanism the zoom +/- buttons use, kept at its
      minimum (1x) rather than whatever the hardware started at.
    */
    resetTrackZoom();

    resetTrackFocus();


    $("cameraLoading")
      .classList.add("hidden");


    $("cameraStatusText").textContent =
      "Ready to scan";


  } catch (error) {

    console.error(error);


    /*
      The cause decides what the user is told. Permission, a busy
      camera and a missing camera all need different actions, so the
      previous single "Camera unavailable" message left most users with
      no idea what to do.
    */
    const info =
      window.WebScanMessages
        ? window.WebScanMessages.cameraError(error)
        : {
            title: "Camera unavailable",
            detail: "The camera could not be started.",
            retry: true
          };


    $("cameraLoading")
      .classList.add("hidden");


    $("cameraErrorTitle").textContent =
      info.title;

    $("cameraErrorDetail").textContent =
      info.detail;


    // Retrying a missing camera would only fail again, so the button is
    // hidden and importing is offered instead.
    $("retryCameraBtn").classList.toggle(
      "hidden",
      !info.retry
    );


    $("cameraError")
      .classList.remove("hidden");


    $("cameraStatusText").textContent =
      info.title;

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


  // A leftover digital zoom from a previous session should not carry
  // over into the next one, which would otherwise look identical to
  // the camera opening pre-zoomed.
  state.zoom = 1;

  video.style.transform = "";

}


/*
  Rotating the device changes which resolution the camera should deliver,
  so the stream is restarted to match. Without this the preview keeps the
  previous orientation and gets heavily cropped after a rotate.

  Only runs while the camera screen is actually visible, and is debounced
  because browsers fire several resize events during a rotation.
*/
let orientationTimer = null;

let lastOrientationPortrait = null;


function handleOrientationChange() {

  if (!screens.camera.classList.contains("active")) {

    return;

  }


  const portrait =
    isPortraitViewport();


  // A resize that does not flip orientation (keyboard, URL bar) must not
  // tear down a working camera.
  if (portrait === lastOrientationPortrait) {

    return;

  }


  lastOrientationPortrait = portrait;


  clearTimeout(orientationTimer);

  orientationTimer = setTimeout(
    () => {

      if (!screens.camera.classList.contains("active")) {

        return;

      }


      startCamera();

    },
    350
  );

}


window.addEventListener(
  "orientationchange",
  handleOrientationChange
);

window.addEventListener(
  "resize",
  handleOrientationChange
);


/*
  iOS Safari can suspend a camera stream when the tab is backgrounded or
  the device is locked; it does not resume on its own. Restarting on
  return avoids the black preview this otherwise leaves behind.
*/
document.addEventListener(
  "visibilitychange",
  () => {

    if (
      document.hidden ||
      !screens.camera.classList.contains("active")
    ) {

      return;

    }


    const track =
      state.stream?.getVideoTracks?.()[0];


    if (!track || track.readyState === "ended") {

      startCamera();

    }

  }
);



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
      const page =
        createPage(
          data,
          window.webscanLastCorners || null
        );

      state.pages.push(page);


      if (window.webscanAutoCropFailed) {
        state.autoCropFailedPageId = page.id;
      }


      window.webscanLastCorners = null;
      window.webscanAutoCropFailed = false;

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

    rotation: 0,

    // OCR results live with the page, so they survive reordering,
    // export and saving rather than being lost when the panel closes.
    ocrText: "",

    ocrLang: "",

    ocrAt: null

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
      window.WebScanMessages?.NOTICE?.noPages || "Capture or import a page first.",
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

  syncAutoCropNotice(page);


  renderEditor();

}


/*
  Shows the "couldn't auto-detect edges" notice only for the specific
  page that was just captured with a failed auto-crop — not for every
  page that happens to lack corners (gallery imports, already-cropped
  scans), and not once the user has addressed or dismissed it.
*/
function syncAutoCropNotice(page) {

  const show =
    !!page &&
    page.id === state.autoCropFailedPageId;

  $("autoCropNotice")
    .classList
    .toggle("hidden", !show);

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


/*
  Opens the manual 4-corner crop editor for the current page. Shared by
  the toolbar Crop button and the auto-crop-failed notice's action, so
  both paths apply and clean up identically.
*/
function openManualCrop() {

  const page =
    state.pages[state.currentPage];


  if (!page || !window.WebScanCrop) {

    showToast(
      window.WebScanMessages?.NOTICE?.cropUnavailable || "Manual crop is unavailable right now.",
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


      // The crop this notice was nudging toward has now happened.
      if (state.autoCropFailedPageId === page.id) {
        state.autoCropFailedPageId = null;
      }

      syncAutoCropNotice(page);


      window.WebScanHistory?.commit(page);


      renderEditor();

      updatePages();

      showToast("Crop applied");

    }

  });

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


  updateExportOptionVisibility();

  updatePdfEstimate();

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


        updateExportOptionVisibility();

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


        updatePdfEstimate();

      }
    );

  });


/*
  Wires a row of mutually exclusive option buttons to a state field.
  Used for the PDF layout choices, which all share the same behaviour.
*/
function wireOptionGroup(selector, datasetKey, stateKey) {

  document
    .querySelectorAll(selector)
    .forEach(btn => {

      btn.addEventListener(
        "click",
        () => {

          document
            .querySelectorAll(selector)
            .forEach(other =>
              other.classList.remove("active")
            );


          btn.classList.add("active");


          state[stateKey] =
            btn.dataset[datasetKey];


          updatePdfEstimate();

        }
      );

    });

}


wireOptionGroup(".pagesize-btn", "pagesize", "pageSize");

wireOptionGroup(".orientation-btn", "orientation", "orientation");

wireOptionGroup(".compression-btn", "compression", "compression");


/*
  Shows roughly what the chosen settings will produce, so the trade-off
  between size and quality is visible before exporting rather than
  discovered afterwards.
*/
function updatePdfEstimate() {

  const label =
    $("pdfEstimate");


  if (!label) {

    return;

  }


  const limit =
    COMPRESSION_LIMITS[state.compression];


  const resolution =
    Number.isFinite(limit)
      ? `up to ${limit}px on the long edge`
      : "full resolution";


  const sheet =
    state.pageSize === "original"
      ? "page sized to each scan"
      : `${state.pageSize.toUpperCase()} sheet`;


  label.textContent =
    `${sheet}, ${resolution}.`;

}


/* PDF-only options are hidden when exporting images. */
function updateExportOptionVisibility() {

  const panel =
    $("pdfOptions");


  if (!panel) {

    return;

  }


  panel.classList.toggle(
    "hidden",
    state.exportFormat !== "pdf"
  );

}



/* =====================================================
   CREATE PROCESSED IMAGE
===================================================== */

async function createProcessedData(
  page
) {

  const img =
    await loadImage(page.src);


  /*
    Rendering reads the shared editor state, so the page being exported
    is swapped in and the previous values restored afterwards. Saving
    every adjustment field keeps export in step with the editor -- a
    partial save here silently exported the wrong sharpness/saturation.
  */
  const previous = {
    filter: state.filter,
    brightness: state.brightness,
    contrast: state.contrast,
    sharpness: state.sharpness,
    saturation: state.saturation,
    exposure: state.exposure,
    rotation: state.rotation
  };


  loadPageIntoState(page);


  const canvas =
    document.createElement("canvas");


  drawProcessedImage(
    img,
    canvas
  );


  const data =
    compressCanvas(canvas)
      .toDataURL(
        "image/jpeg",
        qualityValue()
      );


  Object.assign(state, previous);


  return data;

}


/*
  Longest edge in pixels for each compression setting.

  A scan wider than this carries more detail than a printed page can
  show, so capping it cuts file size substantially with no visible loss.
  "none" leaves the image untouched for archival-quality output.
*/
const COMPRESSION_LIMITS = {

  high: 1400,

  balanced: 2200,

  none: Infinity

};


function compressCanvas(canvas) {

  const limit =
    COMPRESSION_LIMITS[state.compression] ??
    COMPRESSION_LIMITS.balanced;


  const longest =
    Math.max(canvas.width, canvas.height);


  // Never upscale: a small scan stays exactly as it is.
  if (!Number.isFinite(limit) || longest <= limit) {

    return canvas;

  }


  const scale = limit / longest;


  const out =
    document.createElement("canvas");

  out.width =
    Math.max(1, Math.round(canvas.width * scale));

  out.height =
    Math.max(1, Math.round(canvas.height * scale));


  const ctx =
    out.getContext("2d");


  // Smooth downscaling keeps text edges clean rather than aliased.
  ctx.imageSmoothingEnabled = true;

  ctx.imageSmoothingQuality = "high";


  ctx.drawImage(
    canvas,
    0,
    0,
    out.width,
    out.height
  );


  return out;

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

  const texts = [];


  for (
    const page of state.pages
  ) {

    images.push(
      await createProcessedData(page)
    );

    // Recognised text rides along so the export is searchable.
    texts.push(page.ocrText || "");

  }


  /*
    The Unicode font is only fetched when a page actually has text, and
    a failure is non-fatal: export continues with the built-in font,
    which still handles Latin.
  */
  let embeddedFont = null;


  if (
    texts.some(text => text.trim()) &&
    window.WebScanPdfFont
  ) {

    try {

      embeddedFont =
        await window.WebScanPdfFont.load();

    } catch (error) {

      console.warn(
        "Unicode font unavailable; falling back to Latin-only text layer.",
        error
      );

    }

  }


  const pdf =
    buildPDF(
      images,
      texts,
      embeddedFont,
      {
        pageSize: state.pageSize,
        orientation: state.orientation
      }
    );


  const blob =
    new Blob(
      [pdfStringToBytes(pdf)],
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


/*
  Builds the PDF.

  `ocrTexts[i]` is optional recognised text for page i. When present it
  is drawn in invisible render mode over the image, which is what makes
  the PDF searchable and selectable while looking unchanged.
*/
/*
  Builds the PDF.

  `ocrTexts[i]` is optional recognised text for page i. When present it
  is drawn in invisible render mode over the image, which is what makes
  the PDF searchable and selectable while looking unchanged.

  `embeddedFont` is an optional parsed Unicode font. With it, any script
  the font covers -- Bengali included -- goes into the search layer via
  a composite Identity-H font. Without it the layer falls back to the
  built-in Helvetica, which can only carry Latin text.
*/
/* Standard sheet sizes in PDF points (1/72 inch). */
const PAGE_SIZES = {

  a4: { width: 595.28, height: 841.89 },

  letter: { width: 612, height: 792 }

};


/*
  Works out the sheet for one image.

  "original" sizes the page to the image itself so nothing is letterboxed
  and no area is wasted. Fixed sizes keep a consistent printable sheet;
  "auto" orientation then turns the sheet to match the image so a
  landscape scan is not shrunk to fit a portrait page.
*/
function resolvePageSize(dimensions, layout) {

  if (layout.pageSize === "original") {

    /*
      Images are placed at 72 dpi in PDF units. Scans are usually far
      denser than that, so the sheet is divided down to a realistic
      physical size instead of producing a metres-wide page.
    */
    const dpi = 150;

    const scale = 72 / dpi;

    return {
      width: Math.max(72, dimensions.width * scale),
      height: Math.max(72, dimensions.height * scale)
    };

  }


  const base =
    PAGE_SIZES[layout.pageSize] || PAGE_SIZES.a4;


  const imageIsLandscape =
    dimensions.width > dimensions.height;


  const wantLandscape =
    layout.orientation === "landscape" ||
    (layout.orientation === "auto" && imageIsLandscape);


  return wantLandscape
    ? { width: base.height, height: base.width }
    : { width: base.width, height: base.height };

}


function buildPDF(dataUrls, ocrTexts = [], embeddedFont = null, layout = {}) {

  // Defaults keep buildPDF usable on its own, e.g. from tests.
  layout = {
    pageSize: "a4",
    orientation: "auto",
    ...layout
  };

  const objects = [];

  const pages = [];

  const fontApi =
    window.WebScanPdfFont;


  // Glyphs actually used, so only those widths are written out.
  const usedGlyphs = new Set();


  // Pre-encode each page's text to learn whether anything is renderable.
  const encodedPages =
    dataUrls.map((_, index) => {

      const raw =
        (ocrTexts[index] || "").trim();


      if (!raw) {

        return null;

      }


      if (embeddedFont && fontApi) {

        /*
          Each line becomes a list of runs. A run is either Latin (drawn
          with the built-in font) or Unicode (drawn with the embedded
          font), because neither font covers both scripts on its own.
        */
        const lines =
          raw
            .split("\n")
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => {

              return fontApi
                .splitRuns(embeddedFont, line)
                .map(run => {

                  if (run.kind === "latin") {

                    return {
                      unicode: false,
                      text: run.text
                    };

                  }


                  const encoded =
                    fontApi.encodeText(embeddedFont, run.text);


                  encoded.glyphs.forEach(
                    glyph => usedGlyphs.add(glyph)
                  );


                  return {
                    unicode: true,
                    text: encoded.hex
                  };

                })
                .filter(run => run.text.length);

            })
            .filter(runs => runs.length);


        return lines.length
          ? { mixed: true, lines }
          : null;

      }


      // Latin-only fallback.
      const filtered =
        pdfEncodableText(raw);


      if (!filtered) {

        return null;

      }


      return {
        mixed: true,
        lines:
          filtered
            .split("\n")
            .filter(line => line.trim())
            .map(line => [{ unicode: false, text: line }])
      };

    });


  const hasText =
    encodedPages.some(Boolean);


  const useEmbedded =
    hasText &&
    !!embeddedFont &&
    !!fontApi &&
    usedGlyphs.size > 0;


  /*
    Object 3 is reserved for the shared font when any page has text, so
    every page can reference a fixed number. Page objects then start
    after whatever the font structure consumes.
  */
  const FONT_OBJECT_NUMBER = 3;

  let objectNumber = 3;

  let fontObjects = [];

  // Object number of the built-in Latin font, allocated after the
  // composite font when both are present.
  let latinObjectNumber = null;


  if (useEmbedded) {

    // A composite font needs five objects, not one.
    const built =
      fontApi.buildFontObjects(
        embeddedFont,
        usedGlyphs,
        FONT_OBJECT_NUMBER
      );


    fontObjects = built.objects;

    latinObjectNumber = built.nextNumber;

    objectNumber = built.nextNumber + 1;

  } else if (hasText) {

    latinObjectNumber = FONT_OBJECT_NUMBER;

    objectNumber = 4;

  }


  dataUrls.forEach(
    (dataUrl, pageIndex) => {

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


      const sheet =
        resolvePageSize(
          dimensions,
          layout
        );


      const pageWidth = sheet.width;

      const pageHeight = sheet.height;


      /*
        Fit the image inside the sheet without ever enlarging it beyond
        its natural size at print resolution -- upscaling would only
        soften the scan while inflating the file.
      */
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


      /*
        Text render mode 3 (Tr) draws nothing but still registers the
        glyphs, so viewers can search and select the words while only
        the scanned image is visible.
      */
      const encoded =
        encodedPages[pageIndex];


      let textLayer = "";


      if (encoded) {

        const lines = encoded.lines;


        // Distributed down the page so selection order roughly follows
        // the document. Exact glyph placement would need per-word boxes.
        const lineHeight =
          Math.min(14, (drawHeight - 20) / lines.length);


        const parts = ["BT", "3 Tr"];


        lines.forEach((runs, i) => {

          const textY =
            y + drawHeight - 12 - (i * lineHeight);


          if (textY < y) {

            return;

          }


          parts.push(
            `1 0 0 1 ${(x + 8).toFixed(2)} ${textY.toFixed(2)} Tm`
          );


          /*
            Runs are drawn in sequence on the same line. Tj advances the
            text position automatically, so consecutive runs follow each
            other without needing measured offsets.

            F1 is the embedded Unicode font, F2 the built-in Latin one.
          */
          runs.forEach(run => {

            if (run.unicode) {

              parts.push(`/F1 ${lineHeight.toFixed(2)} Tf`);

              // Identity-H takes hex-encoded 2-byte glyph ids.
              parts.push(`<${run.text}> Tj`);

            } else {

              parts.push(`/F2 ${lineHeight.toFixed(2)} Tf`);

              parts.push(`(${escapePdfText(run.text)}) Tj`);

            }

          });

        });


        parts.push("ET");

        textLayer = "\n" + parts.join("\n");

      }


      const content =
`q
${drawWidth} 0 0 ${drawHeight} ${x} ${y} cm
/Im1 Do
Q${textLayer}`;


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
>>${hasText ? `
/Font <<${useEmbedded ? `
/F1 ${FONT_OBJECT_NUMBER} 0 R` : ""}
/F2 ${latinObjectNumber} 0 R
>>` : ""}
>>
/Contents ${contentObject} 0 R
>>`

      });


      pages.push(
        `${pageObject} 0 R`
      );

    }
  );


  if (useEmbedded) {

    // Composite font: Type0 + descendant + descriptor + font file +
    // ToUnicode. Carries any script the embedded font covers.
    objects.push(...fontObjects);

  }


  if (hasText) {

    /*
      The built-in Latin font is always present alongside the embedded
      one. The Bengali font contains no Latin glyphs, so English words
      and digits in a mixed document are drawn with this instead of
      being dropped from the search layer.
    */
    objects.push({

      number: latinObjectNumber,

      body:
`<<
/Type /Font
/Subtype /Type1
/BaseFont /Helvetica
/Encoding /WinAnsiEncoding
>>`

    });

  }


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


/*
  Converts the assembled PDF string to raw bytes.

  The PDF is built as a "binary string" where each character stands for
  one byte, which is how the embedded JPEG data is carried. Handing that
  string straight to Blob would encode it as UTF-8 and expand every byte
  above 127 into two, corrupting both the image streams and the xref
  offsets. Writing one byte per character keeps the file valid.
*/
/*
  Keeps only the characters the PDF text layer can actually represent.

  The layer uses Helvetica with WinAnsiEncoding, a single-byte encoding
  that covers Latin text but not Bengali. Embedding a Unicode font would
  be required for Bengali glyphs, and a font file cannot be bundled
  without shipping several megabytes.

  So Bengali OCR text is still extracted, editable, copyable and stored
  with the document -- it simply is not written into the PDF's hidden
  search layer. Returning "" here means such a page keeps its image and
  stays valid rather than emitting corrupt text operators.
*/
function pdfEncodableText(text) {

  if (!text) {

    return "";

  }


  const filtered =
    text
      .split("\n")
      .map(line =>
        // Printable WinAnsi range only.
        line.replace(/[^\x20-\x7E\xA0-\xFF]/g, "").trim()
      )
      .filter(line => line.length)
      .join("\n");


  return filtered;

}


/*
  Escapes the characters that terminate or alter a PDF string literal.
  Backslash must be replaced first or it would double-escape the
  parentheses handled after it.
*/
function escapePdfText(line) {

  return line
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r/g, "");

}


function pdfStringToBytes(pdf) {

  const bytes =
    new Uint8Array(pdf.length);


  for (let i = 0; i < pdf.length; i++) {

    bytes[i] = pdf.charCodeAt(i) & 0xff;

  }


  return bytes;

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
      window.WebScanMessages?.NOTICE?.exportEmpty || "Add at least one page before exporting.",
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

    // New documents start unfiled and out of the trash.
    folder: "none",

    deleted: false,

    deletedAt: null,

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

    /*
      Exporting re-renders every page and can take seconds on a long
      document. The button is disabled and labelled so the wait is
      visibly accounted for and cannot be triggered twice.
    */
    setExportBusy(
      true,
      window.WebScanMessages?.PROGRESS?.exporting ||
        "Saving your document…"
    );


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


    /*
      Running out of memory is the usual cause on a phone with many
      high-resolution pages, so the message points at the settings that
      actually help rather than just reporting failure.
    */
    const outOfMemory =
      error &&
      /quota|memory|allocation|exceeded/i.test(
        String(error.message || error.name || "")
      );


    showToast(
      outOfMemory
        ? (window.WebScanMessages?.NOTICE?.exportFailed ||
            "Could not create the file. Try a smaller page size or fewer pages.")
        : (window.WebScanMessages?.NOTICE?.exportFailed ||
            "Could not create the file. Try again."),
      "!"
    );

  } finally {

    // Always restores the button, including after a failure, so the
    // user is never left with a permanently disabled export.
    setExportBusy(false);

  }

}


/*
  Disables the export button and shows what is happening while a slow
  export runs.
*/
function setExportBusy(busy, label) {

  const button =
    $("exportBtn");


  if (!button) {

    return;

  }


  if (busy) {

    if (!button.dataset.idleLabel) {

      button.dataset.idleLabel = button.textContent;

    }

    button.textContent = label || "Working…";

  } else {

    button.textContent =
      button.dataset.idleLabel || "Export Document";

  }


  button.disabled = busy;

  button.classList.toggle("is-busy", busy);

}



/* =====================================================
   DOCUMENT LIST
===================================================== */

function renderRecent() {

  const list =
    $("recentList");


  // Trashed documents must not resurface on the home screen.
  const recent =
    state.documents
      .filter(doc => !doc.deleted)
      .slice(0, 5);


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


/*
  Applies the active search, folder filter and sort to the stored
  documents. Kept as one pure function so the list, the counts and the
  tests all agree on what "visible" means.
*/
function visibleDocuments() {

  const query =
    state.search.trim().toLowerCase();


  let list =
    state.documents.filter(doc => {

      // Trash is a separate view: a document is in one or the other.
      if (!!doc.deleted !== state.showTrash) {

        return false;

      }


      if (
        state.folderFilter === "favorites" &&
        !doc.favorite
      ) {

        return false;

      }


      if (
        state.folderFilter !== "all" &&
        state.folderFilter !== "favorites" &&
        (doc.folder || "none") !== state.folderFilter
      ) {

        return false;

      }


      if (query) {

        const name =
          (doc.name || "").toLowerCase();


        // Recognised text is searched too, so a document can be found
        // by its contents and not only by the name given to it.
        const text =
          (doc.pages || [])
            .map(page => page.ocrText || "")
            .join(" ")
            .toLowerCase();


        if (
          !name.includes(query) &&
          !text.includes(query)
        ) {

          return false;

        }

      }


      return true;

    });


  const byDate = (a, b) =>
    new Date(b.date) - new Date(a.date);


  switch (state.sortBy) {

    case "oldest":
      list.sort((a, b) => new Date(a.date) - new Date(b.date));
      break;

    case "name":
      list.sort((a, b) =>
        (a.name || "").localeCompare(b.name || "", undefined, {
          sensitivity: "base"
        })
      );
      break;

    case "pages":
      list.sort((a, b) =>
        (b.pages?.length || 0) - (a.pages?.length || 0)
      );
      break;

    default:
      list.sort(byDate);

  }


  return list;

}


/*
  Renders the folder filter chips with live counts, so it is obvious
  where documents actually are without opening each folder.
*/
function updateFolderChips() {

  const container =
    $("folderChips");


  if (!container) {

    return;

  }


  // Counts always describe the non-trash library.
  const active =
    state.documents.filter(doc => !doc.deleted);


  const countFor = (id) => {

    if (id === "all") {

      return active.length;

    }


    if (id === "favorites") {

      return active.filter(doc => doc.favorite).length;

    }


    return active.filter(
      doc => (doc.folder || "none") === id
    ).length;

  };


  const chips = [

    { id: "all", label: "All", icon: "▤" },

    { id: "favorites", label: "Favorites", icon: "⭐" },

    ...FOLDERS

  ];


  container.innerHTML =
    chips
      .map(chip => `
        <button
          class="folder-chip${
            state.folderFilter === chip.id ? " active" : ""
          }"
          data-folder="${chip.id}"
        >
          ${chip.icon} ${escapeHTML(chip.label)}
          <em>${countFor(chip.id)}</em>
        </button>
      `)
      .join("");

}


function renderDocuments() {

  const list =
    $("documentsList");


  const visible =
    visibleDocuments();


  $("documentsCount").textContent =
    state.showTrash
      ? `${visible.length} in trash`
      : `${visible.length} ${
          visible.length === 1
            ? "document"
            : "documents"
        }`;


  updateFolderChips();


  if (!visible.length) {

    // The message names the actual reason the list is empty, rather
    // than always claiming there are no documents at all.
    const message =
      state.showTrash
        ? {
            icon: "🗑",
            title: "Trash is empty",
            hint: "Deleted documents appear here."
          }
        : state.search.trim()
          ? {
              icon: "⌕",
              title: "No matches",
              hint: `Nothing found for “${escapeHTML(state.search.trim())}”.`
            }
          : state.folderFilter !== "all"
            ? {
                icon: "📁",
                title: "Nothing here yet",
                hint: "Move a document into this folder to see it."
              }
            : {
                icon: "📄",
                title: "No documents",
                hint: "Start scanning to create your first document."
              };


    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${message.icon}</div>
        <strong>${message.title}</strong>
        <span>${message.hint}</span>
      </div>
    `;

    return;

  }


  list.innerHTML =
    visible
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


  const folder =
    FOLDERS.find(
      item => item.id === (doc.folder || "none")
    );


  const folderTag =
    folder && folder.id !== "none"
      ? `<em class="document-folder">${folder.icon} ${folder.label}</em>`
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

        ${folderTag}

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
   DOCUMENT ACTIONS
===================================================== */

function findDocument(id) {

  // Ids are numbers in memory but strings in dataset attributes.
  return state.documents.find(
    doc => String(doc.id) === String(id)
  );

}


function refreshDocumentViews() {

  saveDocuments();

  renderDocuments();

  renderRecent();

}


function renameDocument(id) {

  const doc =
    findDocument(id);


  if (!doc) {

    return;

  }


  const name =
    prompt(
      "Rename document",
      doc.name || ""
    );


  // Cancel returns null; an empty name would leave an unlabelled card.
  if (name === null) {

    return;

  }


  const trimmed =
    name.trim();


  if (!trimmed) {

    showToast(
      window.WebScanMessages?.NOTICE?.nameRequired || "Enter a name for this document.",
      "!"
    );

    return;

  }


  doc.name = trimmed;

  refreshDocumentViews();

  showToast("Renamed");

}


function duplicateDocument(id) {

  const doc =
    findDocument(id);


  if (!doc) {

    return;

  }


  const copy = {

    ...doc,

    id: Date.now(),

    name: `${doc.name} copy`,

    date: new Date().toISOString(),

    favorite: false,

    // Pages are cloned so editing the copy cannot alter the original.
    pages: (doc.pages || []).map(page => ({ ...page }))

  };


  state.documents.unshift(copy);

  refreshDocumentViews();

  showToast("Duplicated");

}


/*
  Soft delete. The document moves to trash and stays recoverable
  instead of being destroyed on a single tap.
*/
function trashDocument(id) {

  const doc =
    findDocument(id);


  if (!doc) {

    return;

  }


  doc.deleted = true;

  doc.deletedAt = new Date().toISOString();

  refreshDocumentViews();

  showToast("Moved to trash");

}


function restoreDocument(id) {

  const doc =
    findDocument(id);


  if (!doc) {

    return;

  }


  doc.deleted = false;

  doc.deletedAt = null;

  refreshDocumentViews();

  showToast("Restored");

}


/* Permanent removal, only reachable from the trash view. */
function deleteDocumentForever(id) {

  const doc =
    findDocument(id);


  if (!doc) {

    return;

  }


  const confirmed =
    confirm(
      `Permanently delete “${doc.name}”? This cannot be undone.`
    );


  if (!confirmed) {

    return;

  }


  state.documents =
    state.documents.filter(
      item => String(item.id) !== String(id)
    );


  refreshDocumentViews();

  showToast("Deleted permanently");

}


function moveDocumentToFolder(id, folderId) {

  const doc =
    findDocument(id);


  if (!doc) {

    return;

  }


  doc.folder = folderId;


  const folder =
    FOLDERS.find(item => item.id === folderId);


  refreshDocumentViews();

  showToast(
    folderId === "none"
      ? "Removed from folder"
      : `Moved to ${folder ? folder.label : folderId}`
  );

}


function emptyTrash() {

  const count =
    state.documents.filter(doc => doc.deleted).length;


  if (!count) {

    showToast("Trash is already empty");

    return;

  }


  const confirmed =
    confirm(
      `Permanently delete ${count} ${
        count === 1 ? "document" : "documents"
      }? This cannot be undone.`
    );


  if (!confirmed) {

    return;

  }


  state.documents =
    state.documents.filter(doc => !doc.deleted);


  refreshDocumentViews();

  showToast("Trash emptied");

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

          goDocuments("all");

        }

        if (action === "favorites") {

          goDocuments("favorites");

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


$("importInsteadBtn")
  .addEventListener(
    "click",
    openFilePicker
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


$("ocrBtn")
  .addEventListener(
    "click",
    async () => {

      const page =
        state.pages[state.currentPage];


      if (!page || !window.WebScanOCR) {

        showToast(
          window.WebScanMessages?.NOTICE?.ocrUnavailable || "Text recognition is unavailable right now.",
          "!"
        );

        return;

      }


      // Existing text opens instantly; recognition only runs when there
      // is nothing stored, so reopening a page never redoes the work.
      if (page.ocrText) {

        window.WebScanOCR.showForPage(page);

        return;

      }


      const source =
        await createProcessedData(page);


      // Both scripts are recognised together, so a page mixing English
      // and Bengali is handled without asking the user to choose.
      window.WebScanOCR.run(
        source,
        "eng+ben",
        page
      );

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
    openManualCrop
  );


$("autoCropNoticeBtn")
  .addEventListener(
    "click",
    openManualCrop
  );


$("autoCropNoticeDismiss")
  .addEventListener(
    "click",
    () => {

      state.autoCropFailedPageId = null;

      syncAutoCropNotice(
        state.pages[state.currentPage]
      );

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




$("documentsList")
  .addEventListener(
    "click",
    event => {

      const menu =
        event.target.closest(
          "[data-menu]"
        );


      if (menu) {

        openDocumentMenu(
          menu.dataset.menu
        );

      }

    }
  );


/* SEARCH */

$("documentsSearch")
  .addEventListener(
    "input",
    event => {

      state.search = event.target.value;


      $("clearSearchBtn").classList.toggle(
        "hidden",
        !state.search
      );


      renderDocuments();

    }
  );


$("clearSearchBtn")
  .addEventListener(
    "click",
    () => {

      state.search = "";

      $("documentsSearch").value = "";

      $("clearSearchBtn").classList.add("hidden");

      renderDocuments();

    }
  );


/* SORT */

$("documentsSort")
  .addEventListener(
    "change",
    event => {

      state.sortBy = event.target.value;

      renderDocuments();

    }
  );


/* FOLDER FILTER */

$("folderChips")
  .addEventListener(
    "click",
    event => {

      const chip =
        event.target.closest("[data-folder]");


      if (!chip) {

        return;

      }


      state.folderFilter = chip.dataset.folder;

      renderDocuments();

    }
  );


/* TRASH */

/*
  Brings the trash chrome in line with state.showTrash.

  Kept separate from the toggle handler because more than one path can
  leave the trash view (tapping Favorites, for example). When the sync
  lived inline, those paths changed the state but left the button lit
  and the "Empty trash" action visible.
*/
function applyTrashView() {

  $("trashToggleBtn").classList.toggle(
    "active",
    state.showTrash
  );


  $("emptyTrashBtn").classList.toggle(
    "hidden",
    !state.showTrash
  );


  // Folder filters do not apply inside trash.
  $("folderChips").classList.toggle(
    "hidden",
    state.showTrash
  );

}


$("trashToggleBtn")
  .addEventListener(
    "click",
    () => {

      state.showTrash = !state.showTrash;


      // Trash shows everything that was deleted, regardless of folder.
      if (state.showTrash) {

        state.folderFilter = "all";

      }


      applyTrashView();

      renderDocuments();

    }
  );


$("emptyTrashBtn")
  .addEventListener(
    "click",
    emptyTrash
  );



/* =====================================================
   DOCUMENT ACTION SHEET
===================================================== */

const documentSheet =
  document.createElement("div");

documentSheet.className = "page-sheet";

document.body.appendChild(documentSheet);


let documentMenuId = null;


function openDocumentMenu(id) {

  const doc =
    findDocument(id);


  if (!doc) {

    return;

  }


  documentMenuId = id;


  // Trashed documents only offer restore or permanent deletion; the
  // editing actions would have no meaning there.
  const actions =
    doc.deleted
      ? [
          { act: "restore", label: "Restore" },
          { act: "purge", label: "Delete permanently", danger: true }
        ]
      : [
          { act: "open", label: "Open" },
          { act: "rename", label: "Rename" },
          {
            act: "favorite",
            label: doc.favorite
              ? "Remove from favorites"
              : "Add to favorites"
          },
          { act: "duplicate", label: "Duplicate" },
          { act: "folder", label: "Move to folder…" },
          { act: "trash", label: "Move to trash", danger: true }
        ];


  documentSheet.innerHTML = `
    <div class="page-sheet-panel">
      <div class="page-sheet-title">
        ${escapeHTML(doc.name || "Document")}
      </div>
      ${
        actions
          .map(action => `
            <button
              type="button"
              class="page-sheet-item${action.danger ? " danger" : ""}"
              data-act="${action.act}"
            >
              ${action.label}
            </button>
          `)
          .join("")
      }
      <button type="button" class="page-sheet-cancel" data-act="cancel">
        Cancel
      </button>
    </div>
  `;


  documentSheet.classList.add("show");

}


function openFolderPicker(id) {

  const doc =
    findDocument(id);


  if (!doc) {

    return;

  }


  documentMenuId = id;


  documentSheet.innerHTML = `
    <div class="page-sheet-panel">
      <div class="page-sheet-title">Move to folder</div>
      ${
        FOLDERS
          .map(folder => `
            <button
              type="button"
              class="page-sheet-item${
                (doc.folder || "none") === folder.id ? " selected" : ""
              }"
              data-folder-target="${folder.id}"
            >
              ${folder.icon} ${folder.label}
            </button>
          `)
          .join("")
      }
      <button type="button" class="page-sheet-cancel" data-act="cancel">
        Cancel
      </button>
    </div>
  `;


  documentSheet.classList.add("show");

}


documentSheet.addEventListener(
  "click",
  event => {

    // Tapping the backdrop dismisses the sheet.
    if (event.target === documentSheet) {

      documentSheet.classList.remove("show");

      return;

    }


    const target =
      event.target.closest("[data-folder-target]");


    if (target) {

      const id = documentMenuId;

      documentSheet.classList.remove("show");

      moveDocumentToFolder(
        id,
        target.dataset.folderTarget
      );

      return;

    }


    const button =
      event.target.closest("[data-act]");


    if (!button) {

      return;

    }


    const action = button.dataset.act;

    const id = documentMenuId;


    // The folder picker replaces this sheet, so it must stay open.
    if (action !== "folder") {

      documentSheet.classList.remove("show");

    }


    switch (action) {

      case "open":
        openSavedDocument(id);
        break;

      case "rename":
        renameDocument(id);
        break;

      case "favorite":
        toggleSavedFavorite(id);
        break;

      case "duplicate":
        duplicateDocument(id);
        break;

      case "folder":
        openFolderPicker(id);
        break;

      case "trash":
        trashDocument(id);
        break;

      case "restore":
        restoreDocument(id);
        break;

      case "purge":
        deleteDocumentForever(id);
        break;

    }

  }
);


/*
  Loads a saved document back into the editor session so it can be
  viewed and re-exported.
*/
function openSavedDocument(id) {

  const doc =
    findDocument(id);


  if (!doc || !doc.pages?.length) {

    showToast(
      "This document has no pages",
      "!"
    );

    return;

  }


  // Copied so editing the session does not mutate the saved record
  // until the user exports again.
  state.pages =
    doc.pages.map(page => ({ ...page }));

  state.currentPage = 0;

  state.documentName = doc.name;

  state.favorite = !!doc.favorite;


  updatePages();

  openEditor(0);

}



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

          goDocuments("all");

        }

        if (nav === "favorites") {

          goDocuments("favorites");

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
        window.WebScanMessages?.NOTICE?.cropUnavailable ||
          "Manual crop is unavailable right now.",
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
