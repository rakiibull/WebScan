/* =========================================================
   WebScan PDF Font Embedding

   Embeds a Unicode TrueType font into generated PDFs so the
   invisible search layer can carry Bengali (and any other
   script the font covers), not just Latin.

   PDF cannot search non-Latin text with the built-in fonts,
   which are single-byte. The fix is a composite (Type0) font
   using Identity-H encoding: text is written as 2-byte glyph
   ids, and a ToUnicode CMap maps those ids back to real
   characters so copy, search and extraction return proper text.

   The font is fetched once and cached. Everything stays local.
   ========================================================= */

(() => {
  "use strict";

  const FONT_URL = "fonts/NotoSansBengali-Regular.ttf";

  let fontPromise = null;
  let cached = null;

  /* ---------------------------------------------------------
     TRUETYPE PARSING
     Only the tables needed to map characters to glyphs and to
     report their widths.
     --------------------------------------------------------- */

  function readTableDirectory(view) {
    const numTables = view.getUint16(4);
    const tables = {};

    for (let i = 0; i < numTables; i++) {
      const entry = 12 + i * 16;

      let tag = "";
      for (let j = 0; j < 4; j++) {
        tag += String.fromCharCode(view.getUint8(entry + j));
      }

      tables[tag] = {
        offset: view.getUint32(entry + 8),
        length: view.getUint32(entry + 12)
      };
    }

    return tables;
  }

  /*
    Reads a format 4 cmap subtable into a Map of codepoint -> glyph id.
    Format 4 is the standard Unicode BMP mapping and is what Noto uses.
  */
  function parseCmap(view, tables) {
    const cmap = tables["cmap"];
    if (!cmap) throw new Error("Font has no cmap table.");

    const base = cmap.offset;
    const numSubtables = view.getUint16(base + 2);

    let subtableOffset = null;

    for (let i = 0; i < numSubtables; i++) {
      const record = base + 4 + i * 8;
      const platformId = view.getUint16(record);
      const encodingId = view.getUint16(record + 2);
      const offset = view.getUint32(record + 4);

      // Windows Unicode BMP, or Unicode platform.
      const isUnicode =
        (platformId === 3 && (encodingId === 1 || encodingId === 10)) ||
        (platformId === 0);

      if (isUnicode) {
        subtableOffset = base + offset;
        break;
      }
    }

    if (subtableOffset === null) {
      throw new Error("Font has no Unicode cmap subtable.");
    }

    const format = view.getUint16(subtableOffset);
    if (format !== 4) {
      throw new Error(`Unsupported cmap format ${format}.`);
    }

    const segCountX2 = view.getUint16(subtableOffset + 6);
    const segCount = segCountX2 / 2;

    const endBase = subtableOffset + 14;
    const startBase = endBase + segCountX2 + 2;
    const deltaBase = startBase + segCountX2;
    const rangeBase = deltaBase + segCountX2;

    const map = new Map();

    for (let seg = 0; seg < segCount; seg++) {
      const end = view.getUint16(endBase + seg * 2);
      const start = view.getUint16(startBase + seg * 2);
      const delta = view.getInt16(deltaBase + seg * 2);
      const rangeOffset = view.getUint16(rangeBase + seg * 2);

      if (start > end) continue;

      for (let code = start; code <= end && code !== 0xFFFF; code++) {
        let glyph;

        if (rangeOffset === 0) {
          glyph = (code + delta) & 0xFFFF;
        } else {
          // Indirect lookup through the glyphIdArray that follows.
          const glyphIndexAddress =
            rangeBase + seg * 2 + rangeOffset + (code - start) * 2;

          if (glyphIndexAddress + 1 >= view.byteLength) continue;

          glyph = view.getUint16(glyphIndexAddress);
          if (glyph !== 0) glyph = (glyph + delta) & 0xFFFF;
        }

        if (glyph) map.set(code, glyph);
      }
    }

    return map;
  }

  /*
    Advance widths, scaled to the 1000-unit text space PDF expects.
    Glyphs past numberOfHMetrics all share the last advance, which is
    how the hmtx table is defined.
  */
  function parseWidths(view, tables, numGlyphs, unitsPerEm) {
    const hhea = tables["hhea"];
    const hmtx = tables["hmtx"];

    if (!hhea || !hmtx) return new Map();

    const numberOfHMetrics = view.getUint16(hhea.offset + 34);
    const scale = 1000 / unitsPerEm;
    const widths = new Map();

    let lastAdvance = 0;

    for (let glyph = 0; glyph < numGlyphs; glyph++) {
      if (glyph < numberOfHMetrics) {
        const at = hmtx.offset + glyph * 4;
        if (at + 1 >= view.byteLength) break;
        lastAdvance = view.getUint16(at);
      }

      widths.set(glyph, Math.round(lastAdvance * scale));
    }

    return widths;
  }

  function parseFont(buffer) {
    const view = new DataView(buffer);
    const tables = readTableDirectory(view);

    const head = tables["head"];
    const maxp = tables["maxp"];

    if (!head || !maxp) {
      throw new Error("Font is missing required tables.");
    }

    const unitsPerEm = view.getUint16(head.offset + 18);
    const numGlyphs = view.getUint16(maxp.offset + 4);

    const scale = 1000 / unitsPerEm;

    return {
      buffer,

      cmap: parseCmap(view, tables),

      widths: parseWidths(view, tables, numGlyphs, unitsPerEm),

      numGlyphs,

      // Font bounding box and flags for the descriptor.
      bbox: [
        Math.round(view.getInt16(head.offset + 36) * scale),
        Math.round(view.getInt16(head.offset + 38) * scale),
        Math.round(view.getInt16(head.offset + 40) * scale),
        Math.round(view.getInt16(head.offset + 42) * scale)
      ],

      ascent: tables["hhea"]
        ? Math.round(view.getInt16(tables["hhea"].offset + 4) * scale)
        : 800,

      descent: tables["hhea"]
        ? Math.round(view.getInt16(tables["hhea"].offset + 6) * scale)
        : -200
    };
  }

  /* ---------------------------------------------------------
     LOADING
     --------------------------------------------------------- */

  function load() {
    if (cached) return Promise.resolve(cached);
    if (fontPromise) return fontPromise;

    fontPromise = fetch(FONT_URL)
      .then(response => {
        if (!response.ok) {
          throw new Error(`Font request failed (${response.status}).`);
        }
        return response.arrayBuffer();
      })
      .then(buffer => {
        cached = parseFont(buffer);
        return cached;
      })
      .catch(error => {
        // Reset so a later attempt can retry rather than reusing a
        // rejected promise forever.
        fontPromise = null;
        throw error;
      });

    return fontPromise;
  }

  /* ---------------------------------------------------------
     PDF OBJECT GENERATION
     --------------------------------------------------------- */

  /*
    Converts text to the glyph ids used by Identity-H, returning the
    hex string the PDF content stream needs plus the glyphs used.
    Characters the font cannot render are skipped rather than emitted
    as .notdef boxes.
  */
  function encodeText(font, text) {
    let hex = "";
    const glyphs = new Set();

    for (const character of text) {
      const code = character.codePointAt(0);
      const glyph = font.cmap.get(code);

      if (!glyph) continue;

      hex += glyph.toString(16).padStart(4, "0").toUpperCase();
      glyphs.add(glyph);
    }

    return { hex, glyphs };
  }

  /* Characters the built-in WinAnsi font can represent. */
  function isLatin(character) {
    return /[\x20-\x7E\xA0-\xFF]/.test(character);
  }

  /*
    Splits a line into runs of text, each tagged with the font that can
    actually render it.

    A Bengali font carries no Latin glyphs and the built-in Helvetica
    carries no Bengali, so a mixed line such as "Invoice নম্বর 12345"
    needs both. Splitting per run keeps every character in the search
    layer instead of silently dropping whichever script the single
    chosen font lacks.
  */
  function splitRuns(font, line) {
    const runs = [];

    let current = null;

    for (const character of line) {
      const code = character.codePointAt(0);

      const inFont = font ? font.cmap.has(code) : false;
      const latin = isLatin(character);

      // Latin is preferred on the built-in font so digits and ASCII
      // punctuation stay correct even when the embedded font has them.
      const kind = latin ? "latin" : (inFont ? "unicode" : null);

      if (kind === null) continue;

      if (!current || current.kind !== kind) {
        current = { kind, text: character };
        runs.push(current);
      } else {
        current.text += character;
      }
    }

    return runs.filter(run => run.text.length);
  }

  window.WebScanPdfFontHelpers = { isLatin, splitRuns };

  /* Runs of consecutive glyph ids are written compactly. */
  function buildWidthArray(font, glyphs) {
    const sorted = Array.from(glyphs).sort((a, b) => a - b);
    if (!sorted.length) return "";

    const parts = [];
    let index = 0;

    while (index < sorted.length) {
      const start = sorted[index];
      const run = [font.widths.get(start) || 500];

      let next = index + 1;
      while (next < sorted.length && sorted[next] === sorted[next - 1] + 1) {
        run.push(font.widths.get(sorted[next]) || 500);
        next++;
      }

      parts.push(`${start} [${run.join(" ")}]`);
      index = next;
    }

    return parts.join(" ");
  }

  /*
    ToUnicode CMap: maps each glyph id back to its character.

    Without this a viewer can display the text but copy and search
    return nothing meaningful, because Identity-H carries glyph
    indices rather than characters.
  */
  function buildToUnicode(font, glyphs) {
    // Invert the cmap for just the glyphs actually used.
    const reverse = new Map();

    for (const [code, glyph] of font.cmap) {
      if (glyphs.has(glyph) && !reverse.has(glyph)) {
        reverse.set(glyph, code);
      }
    }

    const entries = Array.from(reverse.entries())
      .sort((a, b) => a[0] - b[0]);

    const lines = entries.map(([glyph, code]) => {
      const source = glyph.toString(16).padStart(4, "0").toUpperCase();

      // Codepoints beyond the BMP need a UTF-16 surrogate pair.
      let target;
      if (code > 0xFFFF) {
        const adjusted = code - 0x10000;
        const high = 0xD800 + (adjusted >> 10);
        const low = 0xDC00 + (adjusted & 0x3FF);
        target =
          high.toString(16).padStart(4, "0").toUpperCase() +
          low.toString(16).padStart(4, "0").toUpperCase();
      } else {
        target = code.toString(16).padStart(4, "0").toUpperCase();
      }

      return `<${source}> <${target}>`;
    });

    // bfchar sections are capped at 100 entries by the spec.
    const chunks = [];
    for (let i = 0; i < lines.length; i += 100) {
      const slice = lines.slice(i, i + 100);
      chunks.push(
        `${slice.length} beginbfchar\n${slice.join("\n")}\nendbfchar`
      );
    }

    return `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${chunks.join("\n")}
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
  }

  /* Font file bytes as a PDF binary string (one char per byte). */
  function fontFileString(font) {
    const bytes = new Uint8Array(font.buffer);
    let out = "";

    // Chunked to avoid blowing the argument limit on large fonts.
    const CHUNK = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      out += String.fromCharCode.apply(
        null,
        bytes.subarray(i, i + CHUNK)
      );
    }

    return out;
  }

  /*
    Builds every PDF object the composite font needs.

    `startNumber` is the first free object number; the caller supplies
    it and uses the returned `nextNumber` to continue allocating.
  */
  function buildFontObjects(font, glyphs, startNumber) {
    const type0 = startNumber;
    const cidFont = startNumber + 1;
    const descriptor = startNumber + 2;
    const fontFile = startNumber + 3;
    const toUnicode = startNumber + 4;

    const widths = buildWidthArray(font, glyphs);
    const unicodeMap = buildToUnicode(font, glyphs);
    const fontData = fontFileString(font);

    const objects = [
      {
        number: type0,
        body:
`<<
/Type /Font
/Subtype /Type0
/BaseFont /NotoSansBengali
/Encoding /Identity-H
/DescendantFonts [${cidFont} 0 R]
/ToUnicode ${toUnicode} 0 R
>>`
      },
      {
        number: cidFont,
        body:
`<<
/Type /Font
/Subtype /CIDFontType2
/BaseFont /NotoSansBengali
/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>
/FontDescriptor ${descriptor} 0 R
/DW 500
/W [${widths}]
/CIDToGIDMap /Identity
>>`
      },
      {
        number: descriptor,
        body:
`<<
/Type /FontDescriptor
/FontName /NotoSansBengali
/Flags 4
/FontBBox [${font.bbox.join(" ")}]
/ItalicAngle 0
/Ascent ${font.ascent}
/Descent ${font.descent}
/CapHeight 700
/StemV 80
/FontFile2 ${fontFile} 0 R
>>`
      },
      {
        number: fontFile,
        body:
`<<
/Length ${fontData.length}
/Length1 ${fontData.length}
>>
stream
${fontData}
endstream`
      },
      {
        number: toUnicode,
        body:
`<<
/Length ${unicodeMap.length}
>>
stream
${unicodeMap}
endstream`
      }
    ];

    return {
      objects,
      fontObjectNumber: type0,
      nextNumber: startNumber + 5
    };
  }

  window.WebScanPdfFont = {
    load,
    parseFont,
    encodeText,
    splitRuns,
    isLatin,
    buildFontObjects,
    buildToUnicode,
    buildWidthArray,
    isLoaded: () => !!cached,
    get font() { return cached; }
  };
})();
