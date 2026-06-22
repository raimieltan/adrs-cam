import type { MlkitOcrResult } from "react-native-mlkit-ocr";

export type ScaleMark = {
  value: number; // draft value in metres
  yNorm: number; // normalized Y position in image (0 = top, 1 = bottom)
};

// Matches "1M", "10M", "12M" etc — any metre anchor
const METRE_RE = /^\d+M$/i;
// Matches bare sub-metre digit marks: 2, 4, 6, 8
const DIGIT_RE = /^[2468]$/;

/**
 * Parses ML Kit OCR output into a sorted list of draft scale marks.
 *
 * Processes at line level first (to catch "10M" even when OCR splits it across
 * elements), then falls back to element level for individual digit marks.
 *
 * Larger draft values appear higher on the hull (smaller yNorm).
 */
export function parseScaleMarks(
  ocrResult: MlkitOcrResult,
  imageHeight: number
): ScaleMark[] {
  if (imageHeight <= 0) return [];

  const candidates: { text: string; yNorm: number }[] = [];

  for (const block of ocrResult) {
    const blockLines = block.lines.map((line) => ({
      text: line.text.trim().toUpperCase().replace(/\s+/g, ""),
      yNorm: (line.bounding.top + line.bounding.height / 2) / imageHeight,
      raw: line,
    }));

    for (let i = 0; i < blockLines.length; i++) {
      const { text: lineText, yNorm: lineY, raw: line } = blockLines[i];

      // Attempt cross-line assembly: digit on one line + "M" on the adjacent line
      // catches "10M" split by OCR into ["10", "M"] on separate lines
      const nextText = blockLines[i + 1]?.text ?? "";
      const assembled = lineText + nextText;
      if (METRE_RE.test(assembled)) {
        const midY = (lineY + (blockLines[i + 1]?.yNorm ?? lineY)) / 2;
        candidates.push({ text: assembled, yNorm: midY });
        i += 1; // skip the consumed "M" line
        continue;
      }

      if (METRE_RE.test(lineText) || DIGIT_RE.test(lineText)) {
        candidates.push({ text: lineText, yNorm: lineY });
        continue; // line matched — skip element scan for this line
      }

      // Line text didn't match — try individual elements (handles mixed lines)
      for (const element of line.elements) {
        const raw = element.text.trim().toUpperCase().replace(/\s+/g, "");
        if (METRE_RE.test(raw) || DIGIT_RE.test(raw)) {
          const elemY =
            (element.bounding.top + element.bounding.height / 2) / imageHeight;
          candidates.push({ text: raw, yNorm: elemY });
        }
      }
    }
  }

  if (candidates.length === 0) return [];

  // Sort top-of-screen first (smaller yNorm = higher on hull = larger draft value)
  candidates.sort((a, b) => a.yNorm - b.yNorm);

  // Identify metre anchors
  const metreAnchors = candidates
    .filter((c) => METRE_RE.test(c.text))
    .map((c) => ({ value: parseInt(c.text, 10), yNorm: c.yNorm }));

  const marks: ScaleMark[] = [];

  for (const c of candidates) {
    if (METRE_RE.test(c.text)) {
      marks.push({ value: parseInt(c.text, 10), yNorm: c.yNorm });
    } else {
      const digit = parseInt(c.text, 10); // 2, 4, 6, or 8
      const subValue = digit / 10;

      // Find nearest metre anchor below this mark (lower on hull = smaller yNorm value = lower draft)
      const anchorsBelow = metreAnchors.filter((a) => a.yNorm > c.yNorm);
      let baseMetre: number;
      if (anchorsBelow.length > 0) {
        baseMetre = anchorsBelow.reduce((nearest, a) =>
          a.yNorm < nearest.yNorm ? a : nearest
        ).value;
      } else {
        // Lower metre mark is submerged — infer from the nearest anchor above.
        // Digit marks below an NM anchor belong to the (N-1)–NM range.
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

  // Deduplicate by value — keep first occurrence (already sorted top→bottom)
  const seen = new Map<number, ScaleMark>();
  for (const m of marks) {
    const key = Math.round(m.value * 10);
    if (!seen.has(key)) seen.set(key, m);
  }

  return Array.from(seen.values()).sort((a, b) => a.yNorm - b.yNorm);
}
