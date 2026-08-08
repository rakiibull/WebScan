
/* =========================================================
   WebScan OCR Engine
   English + Bengali OCR
   ========================================================= */
(() => {
  "use strict";

  let tesseractPromise = null;

  /*
    Page whose text the panel is showing. Declared here because the UI
    is built before runOCR is ever called, and its input handler needs
    to reach this binding.
  */
  let activePage = null;

  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (tesseractPromise) return tesseractPromise;

    tesseractPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
      script.async = true;
      script.onload = () => resolve(window.Tesseract);
      script.onerror = () => reject(new Error("Tesseract.js could not be loaded."));
      document.head.appendChild(script);
    });

    return tesseractPromise;
  }

  function createOCRUI() {
    if (document.getElementById("wsOCRPanel")) return;

    const style = document.createElement("style");
    style.textContent = `
      #wsOCRPanel {
        position: fixed;
        inset: 0;
        z-index: 10050;
        display: none;
        background: rgba(0,0,0,.72);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        color: #fff;
        padding: max(18px, env(safe-area-inset-top)) 14px
                 max(18px, env(safe-area-inset-bottom));
        align-items: flex-end;
        justify-content: center;
      }
      #wsOCRPanel.show { display: flex; }
      .ws-ocr-card {
        width: min(680px, 100%);
        max-height: 88dvh;
        overflow: auto;
        background: #11151d;
        border: 1px solid rgba(255,255,255,.1);
        border-radius: 24px;
        padding: 18px;
        box-shadow: 0 25px 80px rgba(0,0,0,.5);
      }
      .ws-ocr-head {
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
        margin-bottom:14px;
      }
      .ws-ocr-title { font-size:18px; font-weight:800; }
      .ws-ocr-close {
        width:38px;height:38px;border:0;border-radius:50%;
        background:rgba(255,255,255,.08);color:#fff;font-size:20px;
      }
      .ws-ocr-progress {
        height:6px;border-radius:99px;background:rgba(255,255,255,.1);
        overflow:hidden;margin:10px 0 14px;
      }
      .ws-ocr-progress i {
        display:block;width:0;height:100%;background:#35f6bd;
        transition:width .2s ease;
      }
      .ws-ocr-status {
        color:rgba(255,255,255,.58);font-size:12px;margin-bottom:10px;
      }
      .ws-ocr-text {
        width:100%;min-height:260px;resize:vertical;
        box-sizing:border-box;border:1px solid rgba(255,255,255,.12);
        border-radius:16px;background:#080b10;color:#f7f7f7;
        padding:14px;font:15px/1.6 system-ui,sans-serif;outline:none;
      }
      .ws-ocr-actions {
        display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;
      }
      .ws-ocr-btn {
        min-height:48px;border:0;border-radius:14px;
        background:#202631;color:#fff;font-weight:800;
      }
      .ws-ocr-btn.primary { background:#35f6bd;color:#07110e; }
      .ws-ocr-btn:disabled { opacity:.45; }
      @media(max-width:480px){
        .ws-ocr-card{border-radius:22px 22px 0 0;}
        .ws-ocr-actions{grid-template-columns:1fr;}
      }
    `;
    document.head.appendChild(style);

    const panel = document.createElement("div");
    panel.id = "wsOCRPanel";
    panel.innerHTML = `
      <div class="ws-ocr-card">
        <div class="ws-ocr-head">
          <div class="ws-ocr-title">OCR Text</div>
          <button class="ws-ocr-close" id="wsOCRClose">×</button>
        </div>
        <div class="ws-ocr-status" id="wsOCRStatus">Ready</div>
        <div class="ws-ocr-progress"><i id="wsOCRProgress"></i></div>
        <textarea class="ws-ocr-text" id="wsOCRText"
          placeholder="Recognized text will appear here…"></textarea>
        <div class="ws-ocr-actions">
          <button class="ws-ocr-btn" id="wsOCRCopy">Copy Text</button>
          <button class="ws-ocr-btn primary" id="wsOCRDownload">Save TXT</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    document.getElementById("wsOCRClose").onclick = () => panel.classList.remove("show");

    /*
      Edits to the recognised text are saved as they are typed, so
      corrections carry through to the searchable PDF and the saved
      document rather than being lost when the panel closes.
    */
    document.getElementById("wsOCRText").addEventListener("input", (event) => {
      if (!activePage) return;

      activePage.ocrText = event.target.value;
      activePage.ocrAt = new Date().toISOString();
    });

    document.getElementById("wsOCRCopy").onclick = async () => {
      const text = document.getElementById("wsOCRText").value;
      if (!text.trim()) return;
      try {
        await navigator.clipboard.writeText(text);
        document.getElementById("wsOCRStatus").textContent = "Text copied";
      } catch {
        document.getElementById("wsOCRStatus").textContent =
          "Could not copy automatically. Select the text and copy it.";
      }
    };

    document.getElementById("wsOCRDownload").onclick = () => {
      const text = document.getElementById("wsOCRText").value;
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `WebScan_OCR_${Date.now()}.txt`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
  }

  function openPanel() {
    createOCRUI();
    document.getElementById("wsOCRPanel").classList.add("show");
  }

  function setOCRStatus(text, progress) {
    const status = document.getElementById("wsOCRStatus");
    const bar = document.getElementById("wsOCRProgress");
    if (status) status.textContent = text;
    if (bar && Number.isFinite(progress)) {
      bar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
    }
  }

  function bindPage(page) {
    activePage = page || null;

    const textBox = document.getElementById("wsOCRText");
    if (!textBox) return;

    // Restore previously recognised text instead of re-running OCR.
    textBox.value = activePage?.ocrText || "";
  }

  function persist(text, languages) {
    if (!activePage) return;

    activePage.ocrText = text;
    activePage.ocrLang = languages || activePage.ocrLang || "";
    activePage.ocrAt = new Date().toISOString();
  }

  async function runOCR(source, languages = "eng+ben", page = null) {
    openPanel();

    if (page) bindPage(page);

    const textBox = document.getElementById("wsOCRText");
    textBox.value = "";

    try {
      setOCRStatus(
        window.WebScanMessages?.PROGRESS?.loadingOcr ||
          "Loading the text engine…",
        5
      );
      const Tesseract = await loadTesseract();

      setOCRStatus("Preparing document…", 10);

      const result = await Tesseract.recognize(source, languages, {
        logger: message => {
          if (typeof message.progress === "number") {
            const p = Math.round(message.progress * 100);
            setOCRStatus(
              message.status === "recognizing text"
                ? `Recognizing text… ${p}%`
                : "Processing document…",
              Math.max(10, p)
            );
          }
        }
      });

      const text = (result?.data?.text || "").trim();
      textBox.value = text;

      // Stored on the page so it survives closing the panel.
      persist(text, languages);

      if (text) {
        setOCRStatus("OCR completed", 100);
      } else {
        setOCRStatus(
          window.WebScanMessages?.NOTICE?.ocrEmpty ||
            "No readable text was found on this page.",
          100
        );
      }

      return text;
    } catch (error) {
      console.error("OCR error:", error);
      /*
        Distinguishes a failed download of the recognition engine from a
        failure while reading the page, because the remedies differ.
      */
      const offline =
        !navigator.onLine ||
        /load|network|fetch|script/i.test(String(error?.message || ""));

      setOCRStatus(
        offline
          ? (window.WebScanMessages?.NOTICE?.ocrFailed ||
              "Text could not be read. Check your connection and try again.")
          : "The page could not be read. Try a clearer or better-lit scan.",
        0
      );
      return "";
    }
  }

  /*
    Shows stored text for a page without re-running recognition, so
    reopening a scanned page is instant and previous corrections stay.
  */
  function showForPage(page) {
    openPanel();
    bindPage(page);

    if (page?.ocrText) {
      setOCRStatus(
        `Saved text${page.ocrLang ? ` (${page.ocrLang})` : ""}`,
        100
      );
    } else {
      setOCRStatus("No text recognised yet — run OCR to extract.", 0);
    }
  }

  window.WebScanOCR = {
    load: loadTesseract,
    run: runOCR,
    open: openPanel,
    showForPage,
    bindPage
  };

  createOCRUI();
})();
