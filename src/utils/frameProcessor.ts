import type { FrameResult } from "../store/draftStore";

// Rolling wave buffer for smoothing
const buffer: number[] = [];

function smooth(value: number): number {
  buffer.push(value);
  if (buffer.length > 15) buffer.shift();
  return buffer.reduce((a, b) => a + b) / buffer.length;
}

// Option A: JS stub — simulates OpenCV output for POC
// Replace with native C++ bridge (Option B) when ready
export function processFrame(_frame: unknown): FrameResult {
  const rawDraft = 11 + Math.random() * 0.2;
  const stableDraft = smooth(rawDraft);
  return {
    rawDraft,
    stableDraft,
    waterlineY: 260,
    confidence: 0.8 + Math.random() * 0.1,
  };
}
