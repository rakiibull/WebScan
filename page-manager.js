/* =========================================================
   WebScan Page Manager

   Multi-page session management: reorder by drag & drop,
   duplicate, replace, rotate, crop and delete pages.

   Operates on the same state.pages array the rest of the app
   uses, so ordering here is exactly the ordering that gets
   exported and saved.
   ========================================================= */

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const grid = $("pagesGrid");
  const empty = $("pagesEmpty");
  const subtitle = $("pagesSubtitle");
  const replaceInput = $("replacePageInput");

  if (!grid) {
    console.warn("WebScan Page Manager: screen not found.");
    return;
  }

  // Index whose action sheet is open, and the page awaiting replacement.
  let menuIndex = null;
  let replaceIndex = null;

  /* ---------------------------------------------------------
     HOST BRIDGE
     script.js owns the state and the shared helpers. They are
     read lazily so this module works regardless of load order.
     --------------------------------------------------------- */

  const host = {
    get state() { return window.webscanState; },
    get api() { return window.webscanPageAPI || {}; }
  };

  function pages() {
    return host.state ? host.state.pages : [];
  }

  function toast(message, icon) {
    if (typeof host.api.showToast === "function") {
      host.api.showToast(message, icon);
    }
  }

  function syncHost() {
    // Keeps the camera strip, counters and editor in step with any
    // change made here.
    host.api.updatePages?.();
  }

  /* ---------------------------------------------------------
     RENDER
     --------------------------------------------------------- */

  function render() {
    const list = pages();

    subtitle.textContent =
      `${list.length} ${list.length === 1 ? "page" : "pages"}`;

    empty.classList.toggle("hidden", list.length > 0);

    grid.innerHTML = "";

    list.forEach((page, index) => {
      grid.appendChild(buildCard(page, index));
    });
  }

  function buildCard(page, index) {
    const card = document.createElement("div");
    card.className = "page-card";
    card.dataset.index = String(index);
    card.setAttribute("draggable", "true");

    const thumb = document.createElement("div");
    thumb.className = "page-card-thumb";

    const img = document.createElement("img");
    img.src = page.src;
    img.alt = `Page ${index + 1}`;
    img.draggable = false;

    // Thumbnails reflect the rotation applied in the editor so the
    // manager always matches what will be exported.
    const rotation = ((page.rotation || 0) % 360 + 360) % 360;
    if (rotation) {
      img.style.transform = `rotate(${rotation}deg)`;
      img.classList.toggle("page-card-rotated", rotation === 90 || rotation === 270);
    }

    thumb.appendChild(img);

    const number = document.createElement("span");
    number.className = "page-card-number";
    number.textContent = String(index + 1);

    const menu = document.createElement("button");
    menu.type = "button";
    menu.className = "page-card-menu";
    menu.textContent = "⋯";
    menu.setAttribute("aria-label", `Page ${index + 1} options`);

    menu.addEventListener("click", (event) => {
      event.stopPropagation();
      openMenu(index);
    });

    card.appendChild(thumb);
    card.appendChild(number);
    card.appendChild(menu);

    card.addEventListener("click", () => {
      host.api.openEditor?.(index);
    });

    return card;
  }

  /* ---------------------------------------------------------
     REORDER

     move() is the single place ordering changes, so the current
     page follows its content instead of pointing at whatever
     happens to land on the old index.
     --------------------------------------------------------- */

  function move(from, to) {
    const list = pages();

    if (
      from === to ||
      from < 0 || to < 0 ||
      from >= list.length || to >= list.length
    ) {
      return false;
    }

    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);

    const current = host.state.currentPage;

    // Track the selection across the move.
    if (current === from) {
      host.state.currentPage = to;
    } else if (current > from && current <= to) {
      host.state.currentPage = current - 1;
    } else if (current < from && current >= to) {
      host.state.currentPage = current + 1;
    }

    return true;
  }

  /* ---------------------------------------------------------
     DRAG & DROP

     Pointer events cover mouse and touch with one code path.
     The card follows the finger while the other cards shift to
     preview the drop position.
     --------------------------------------------------------- */

  let drag = null;

  function cardAt(clientX, clientY) {
    // elementFromPoint ignores the dragged card because it is
    // pointer-events:none while lifted.
    const el = document.elementFromPoint(clientX, clientY);
    return el?.closest?.(".page-card") || null;
  }

  function onPointerDown(event) {
    // Ignore the overflow button so its menu still works.
    if (event.target.closest(".page-card-menu")) return;

    const card = event.target.closest(".page-card");
    if (!card) return;

    const index = Number(card.dataset.index);
    const rect = card.getBoundingClientRect();

    drag = {
      index,
      card,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      lifted: false,
      moved: false
    };
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    // A small threshold keeps taps working: a tap must not turn into
    // a drag and swallow the click that opens the editor.
    if (!drag.lifted) {
      if (Math.hypot(dx, dy) < 8) return;

      drag.lifted = true;
      drag.card.classList.add("page-card-dragging");
      drag.card.style.width = `${drag.width}px`;
      drag.card.style.height = `${drag.height}px`;
      grid.classList.add("pages-grid-dragging");

      try {
        drag.card.setPointerCapture(drag.pointerId);
      } catch (_) {}
    }

    drag.moved = true;

    drag.card.style.left = `${event.clientX - drag.offsetX}px`;
    drag.card.style.top = `${event.clientY - drag.offsetY}px`;

    const over = cardAt(event.clientX, event.clientY);
    if (!over || over === drag.card) return;

    const targetIndex = Number(over.dataset.index);
    if (Number.isNaN(targetIndex) || targetIndex === drag.index) return;

    if (move(drag.index, targetIndex)) {
      drag.index = targetIndex;

      // Re-render to show the new order, then re-acquire the card
      // element since render() rebuilt the grid.
      const x = drag.card.style.left;
      const y = drag.card.style.top;

      render();

      const next = grid.querySelector(
        `.page-card[data-index="${targetIndex}"]`
      );

      if (next) {
        next.classList.add("page-card-dragging");
        next.style.width = `${drag.width}px`;
        next.style.height = `${drag.height}px`;
        next.style.left = x;
        next.style.top = y;

        try {
          next.setPointerCapture(drag.pointerId);
        } catch (_) {}

        drag.card = next;
      }
    }
  }

  function onPointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;

    const wasLifted = drag.lifted;
    const wasMoved = drag.moved;

    drag.card.classList.remove("page-card-dragging");
    drag.card.style.cssText = "";
    grid.classList.remove("pages-grid-dragging");

    drag = null;

    if (wasLifted) {
      // Suppress the click that would otherwise open the editor
      // immediately after a drag finishes.
      const swallow = (e) => {
        e.stopPropagation();
        e.preventDefault();
      };

      grid.addEventListener("click", swallow, { capture: true, once: true });

      render();
      syncHost();

      if (wasMoved) {
        toast("Pages reordered");
      }
    }
  }

  grid.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);

  /* ---------------------------------------------------------
     ACTION SHEET
     --------------------------------------------------------- */

  const sheet = document.createElement("div");
  sheet.className = "page-sheet";
  sheet.innerHTML = `
    <div class="page-sheet-panel">
      <div class="page-sheet-title">Page options</div>
      <button type="button" class="page-sheet-item" data-act="edit">Edit</button>
      <button type="button" class="page-sheet-item" data-act="crop">Crop</button>
      <button type="button" class="page-sheet-item" data-act="rotate">Rotate 90°</button>
      <button type="button" class="page-sheet-item" data-act="duplicate">Duplicate</button>
      <button type="button" class="page-sheet-item" data-act="replace">Replace</button>
      <button type="button" class="page-sheet-item" data-act="up">Move up</button>
      <button type="button" class="page-sheet-item" data-act="down">Move down</button>
      <button type="button" class="page-sheet-item danger" data-act="delete">Delete</button>
      <button type="button" class="page-sheet-cancel" data-act="cancel">Cancel</button>
    </div>
  `;

  document.body.appendChild(sheet);

  function openMenu(index) {
    menuIndex = index;

    const last = pages().length - 1;

    sheet.querySelector('[data-act="up"]').disabled = index === 0;
    sheet.querySelector('[data-act="down"]').disabled = index === last;

    sheet.classList.add("show");
  }

  function closeMenu() {
    sheet.classList.remove("show");
    menuIndex = null;
  }

  sheet.addEventListener("click", (event) => {
    if (event.target === sheet) {
      closeMenu();
      return;
    }

    const button = event.target.closest(".page-sheet-item, .page-sheet-cancel");
    if (!button || button.disabled) return;

    const action = button.dataset.act;
    const index = menuIndex;

    closeMenu();

    if (index === null || action === "cancel") return;

    runAction(action, index);
  });

  function runAction(action, index) {
    const list = pages();
    const page = list[index];

    if (!page) return;

    switch (action) {
      case "edit":
        host.api.openEditor?.(index);
        break;

      case "crop":
        host.api.cropPage?.(index);
        break;

      case "rotate":
        page.rotation = ((page.rotation || 0) + 90) % 360;

        // The editor mirrors rotation in its own state, so it is
        // refreshed only when the page being shown is the one rotated.
        if (host.state.currentPage === index) {
          host.state.rotation = page.rotation;
        }

        render();
        syncHost();
        host.api.refreshEditor?.(index);
        toast("Page rotated");
        break;

      case "duplicate": {
        const copy = {
          ...page,
          id: Date.now() + Math.random()
        };

        list.splice(index + 1, 0, copy);

        // Keep the selection on the original rather than letting the
        // insert silently shift which page is "current".
        if (host.state.currentPage > index) {
          host.state.currentPage++;
        }

        render();
        syncHost();
        toast("Page duplicated");
        break;
      }

      case "replace":
        replaceIndex = index;
        replaceInput.value = "";
        replaceInput.click();
        break;

      case "up":
        if (move(index, index - 1)) {
          render();
          syncHost();
        }
        break;

      case "down":
        if (move(index, index + 1)) {
          render();
          syncHost();
        }
        break;

      case "delete":
        host.api.deletePage?.(index);
        render();
        break;
    }
  }

  /* ---------------------------------------------------------
     REPLACE
     --------------------------------------------------------- */

  replaceInput?.addEventListener("change", async () => {
    const file = replaceInput.files?.[0];
    const index = replaceIndex;

    replaceIndex = null;

    if (!file || index === null) return;

    const list = pages();
    if (!list[index]) return;

    try {
      const dataUrl = await host.api.fileToDataURL(file);

      // Replacing the image invalidates edits tied to the old pixels.
      list[index] = {
        ...list[index],
        src: dataUrl,
        rotation: 0,
        corners: null
      };

      host.api.invalidateEnhanceCache?.();

      render();
      syncHost();
      host.api.refreshEditor?.(index);

      toast("Page replaced");
    } catch (error) {
      console.error(error);
      toast("Could not replace page", "!");
    } finally {
      replaceInput.value = "";
    }
  });

  /* ---------------------------------------------------------
     ENTRY POINTS
     --------------------------------------------------------- */

  $("pagesBackBtn")?.addEventListener("click", () => {
    host.api.goBackFromPages?.();
  });

  $("pagesDoneBtn")?.addEventListener("click", () => {
    host.api.goBackFromPages?.();
  });

  $("pagesAddBtn")?.addEventListener("click", () => {
    host.api.addPage?.();
  });

  window.WebScanPages = {
    open() {
      render();
      host.api.showScreen?.("pages");
    },
    refresh: render,
    move
  };
})();
