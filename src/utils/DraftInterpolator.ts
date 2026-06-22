import type { ScaleMark } from "./DraftScaleParser";

export type Confidence = "HIGH" | "MED" | "LOW";

export type DraftReading = {
  draft: number; // metres, rounded to nearest 0.05
  confidence: Confidence;
};

function roundTo5cm(value: number): number {
  return Math.round(value * 20) / 20;
}

/**
 * Interpolates a draft reading from scale marks and a normalised guide Y (0–1).
 *
 * marks must be sorted by yNorm ascending (0 = top of image = largest draft value).
 * guideYNorm = screenY / screenHeight, which maps 1:1 to image yNorm when camera
 * preview fills the full screen height in cover mode.
 */
export function interpolateDraft(
  marks: ScaleMark[],
  guideYNorm: number
): DraftReading | null {
  if (marks.length === 0) return null;

  const above = marks.filter((m) => m.yNorm <= guideYNorm);
  const below = marks.filter((m) => m.yNorm > guideYNorm);

  let confidence: Confidence = "LOW";
  if (above.length >= 2 && below.length >= 2) confidence = "HIGH";
  else if (above.length >= 1 && below.length >= 1) confidence = "MED";

  // Extrapolate above all marks
  if (above.length === 0) {
    const m1 = below[0];
    const m2 = below[1];
    if (!m2) return { draft: roundTo5cm(m1.value), confidence: "LOW" };
    const t = (guideYNorm - m1.yNorm) / (m2.yNorm - m1.yNorm);
    return {
      draft: roundTo5cm(m1.value + t * (m2.value - m1.value)),
      confidence: "LOW",
    };
  }

  // Extrapolate below all marks
  if (below.length === 0) {
    const m1 = above[above.length - 1];
    const m2 = above[above.length - 2];
    if (!m2) return { draft: roundTo5cm(m1.value), confidence: "LOW" };
    const span = m1.yNorm - m2.yNorm;
    if (span === 0) return { draft: roundTo5cm(m1.value), confidence: "LOW" };
    const t = (guideYNorm - m1.yNorm) / span;
    return {
      draft: roundTo5cm(m1.value + t * (m1.value - m2.value)),
      confidence: "LOW",
    };
  }

  // Interpolate between bracketing marks
  const upper = above[above.length - 1];
  const lower = below[0];
  const span = lower.yNorm - upper.yNorm;
  if (span === 0) return { draft: roundTo5cm(upper.value), confidence };
  const t = (guideYNorm - upper.yNorm) / span;
  return {
    draft: roundTo5cm(upper.value + t * (lower.value - upper.value)),
    confidence,
  };
}
