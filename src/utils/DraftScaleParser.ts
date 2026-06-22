import type { MlkitOcrResult } from "react-native-mlkit-ocr";

export type ScaleMark = {
  value: number; // draft value in metres
  yNorm: number; // normalized Y position in image (0 = top, 1 = bottom)
};

// Matches "1M", "10M", "12M" etc — any metre anchor
const METRE_RE = /^\d+M$/i;
// Matches bare sub-metre digit marks: 2, 4, 6, 8
const DIGIT_RE = /^[2468]$/;
// Matches a lone "M" — OCR drops the digit prefix (e.g. "10M" → "M")
const ORPHAN_M_RE = /^M$/i;

/**
 * Parses ML Kit OCR output into a sorted list of draft scale marks.
 *
 * hintMetre: the lowest metre mark the user expects to see near the
 * waterline (e.g. 9 when draft ≈ 9m). Required to resolve orphaned "M"
 * tokens when ML Kit drops the digit prefix from "10M", "9M" etc.
 *
 * Larger draft values appear higher on the hull (smaller yNorm).
 */
export function parseScaleMarks(
  ocrResult: MlkitOcrResult,
  imageHeight: number,
  hintMetre: number | null = null
): ScaleMark[] {
  if (imageHeight <= 0) return [];

  const candidates: { text: string; yNorm: number }[] = [];

  // Flatten every line across all blocks sorted top→bottom for cross-block assembly.
  const allLines = ocrResult
    .flatMap((b) =>
      b.lines.map((l) => ({
        text: l.text.trim().toUpperCase().replace(/\s+/g, ""),
        yNorm: (l.bounding.top + l.bounding.height / 2) / imageHeight,
        heightNorm: l.bounding.height / imageHeight,
      }))
    )
    .sort((a, b) => a.yNorm - b.yNorm);

  // Cross-block pre-pass: assemble digit + "M" pairs that are split across OCR blocks.
  // Guard: only assemble MULTI-DIGIT lines (not sub-mark singles 2,4,6,8).
  const crossBlockUsed = new Set<number>();
  for (let i = 0; i < allLines.length; i++) {
    const cur = allLines[i];
    // Only multi-digit pure numbers can precede M (e.g. "10", "11") — not sub-marks
    if (!/^\d{2,}$/.test(cur.text)) continue;
    for (let j = i + 1; j < allLines.length; j++) {
      const nxt = allLines[j];
      if (nxt.yNorm - cur.yNorm > (cur.heightNorm || 0.05) * 2) break;
      if (ORPHAN_M_RE.test(nxt.text)) {
        const assembled = cur.text + "M";
        if (METRE_RE.test(assembled)) {
          candidates.push({ text: assembled, yNorm: (cur.yNorm + nxt.yNorm) / 2 });
          crossBlockUsed.add(i);
          crossBlockUsed.add(j);
        }
        break;
      }
    }
  }
  const usedYNorms = new Set([...crossBlockUsed].map((idx) => allLines[idx].yNorm));

  for (const block of ocrResult) {
    const blockLines = block.lines.map((line) => ({
      text: line.text.trim().toUpperCase().replace(/\s+/g, ""),
      yNorm: (line.bounding.top + line.bounding.height / 2) / imageHeight,
      raw: line,
    }));

    for (let i = 0; i < blockLines.length; i++) {
      const { text: lineText, yNorm: lineY, raw: line } = blockLines[i];

      if (usedYNorms.has(lineY)) continue;

      // Within-block cross-line assembly: multi-digit line + "M" on next line.
      // Guard: same as cross-block — never assemble sub-mark digits with M.
      const nextText = blockLines[i + 1]?.text ?? "";
      if (/^\d{2,}$/.test(lineText) && ORPHAN_M_RE.test(nextText)) {
        const assembled = lineText + "M";
        if (METRE_RE.test(assembled)) {
          const midY = (lineY + (blockLines[i + 1]?.yNorm ?? lineY)) / 2;
          candidates.push({ text: assembled, yNorm: midY });
          i += 1;
          continue;
        }
      }

      // Collect metre marks, sub-mark digits, and orphaned M tokens
      if (METRE_RE.test(lineText) || DIGIT_RE.test(lineText) || ORPHAN_M_RE.test(lineText)) {
        candidates.push({ text: lineText, yNorm: lineY });
        continue;
      }

      // Element-level fallback for mixed lines
      for (const element of line.elements) {
        const raw = element.text.trim().toUpperCase().replace(/\s+/g, "");
        if (METRE_RE.test(raw) || DIGIT_RE.test(raw) || ORPHAN_M_RE.test(raw)) {
          const elemY =
            (element.bounding.top + element.bounding.height / 2) / imageHeight;
          candidates.push({ text: raw, yNorm: elemY });
        }
      }
    }
  }

  if (candidates.length === 0) return [];

  candidates.sort((a, b) => a.yNorm - b.yNorm);

  // Resolve orphaned M tokens using hintMetre.
  // The bottommost orphaned M (largest yNorm = closest to waterline) = hintMetre,
  // the one above it = hintMetre+1, etc.
  const orphanedMs = candidates
    .filter((c) => ORPHAN_M_RE.test(c.text))
    .sort((a, b) => b.yNorm - a.yNorm); // bottom to top

  if (orphanedMs.length > 0 && hintMetre !== null) {
    orphanedMs.forEach((m, i) => {
      m.text = `${hintMetre + i}M`; // promote to resolved metre anchor
    });
  }

  // Identify metre anchors (including newly resolved ones)
  const metreAnchors = candidates
    .filter((c) => METRE_RE.test(c.text))
    .map((c) => ({ value: parseInt(c.text, 10), yNorm: c.yNorm }));

  const marks: ScaleMark[] = [];

  for (const c of candidates) {
    if (ORPHAN_M_RE.test(c.text)) continue; // unresolved orphan — skip
    if (METRE_RE.test(c.text)) {
      marks.push({ value: parseInt(c.text, 10), yNorm: c.yNorm });
    } else {
      const digit = parseInt(c.text, 10);
      const subValue = digit / 10;

      const anchorsBelow = metreAnchors.filter((a) => a.yNorm > c.yNorm);
      let baseMetre: number;
      if (anchorsBelow.length > 0) {
        baseMetre = anchorsBelow.reduce((nearest, a) =>
          a.yNorm < nearest.yNorm ? a : nearest
        ).value;
      } else {
        const anchorsAbove = metreAnchors.filter((a) => a.yNorm < c.yNorm);
        if (anchorsAbove.length > 0) {
          const nearestAbove = anchorsAbove.reduce((nearest, a) =>
            a.yNorm > nearest.yNorm ? a : nearest
          );
          baseMetre = nearestAbove.value - 1;
        } else {
          baseMetre = 0;
        }
      }

      marks.push({ value: baseMetre + subValue, yNorm: c.yNorm });
    }
  }

  const seen = new Map<number, ScaleMark>();
  for (const m of marks) {
    const key = Math.round(m.value * 10);
    if (!seen.has(key)) seen.set(key, m);
  }

  return Array.from(seen.values()).sort((a, b) => a.yNorm - b.yNorm);
}
