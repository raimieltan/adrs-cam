# Waterline Auto-Detection — Design Spec
_2026-06-21_

## Problem

Manual waterline guide is unusable in open-water conditions with significant swells. The waterline moves continuously; the user cannot track it by hand. Need fully automatic, per-frame waterline Y detection with swell-averaging to produce a stable draft reading.

## Scope

- iOS only (no Android device available yet)
- Replaces the draggable `WaterlineGuide` with auto-detected position
- OCR mark detection loop is unchanged (every 2.5s)
- No CoreML / training data required

## Architecture

Two independent loops feed one `interpolateDraft` call:

```
Loop A — OCR (every 2.5s)
  takePhoto → ML Kit OCR → parseScaleMarks → marks[]

Loop B — Frame processor (every frame, ~30fps)
  CMSampleBuffer → Swift plugin → waterlineYNorm → smoother → smoothedY

interpolateDraft(marks, smoothedY) → DraftReading → DraftOverlay
```

## Native Module: `waterline-detector`

### Location
```
modules/waterline-detector/
  expo-module.config.json
  ios/
    WaterlineDetectorPlugin.swift
    WaterlineDetectorModule.swift
```

### Algorithm (Swift, runs on camera capture thread)

1. Lock the luma (Y) plane of the `CVPixelBuffer` — no data copy
2. Define a center horizontal strip: columns 35%–65% of frame width
3. For each row, compute mean luma across the strip using `vDSP_meanv`
4. Compute first-order differences between adjacent row means
5. Search rows 20%–80% of frame height (skip edges)
6. The row with the largest positive difference (brightness drop going downward) = waterline
7. Confidence = magnitude of that drop normalised to [0, 1]; threshold at 0.3

Return to JS worklet: `{ waterlineYNorm: Float, confidence: Float }`

### Why luma plane only
- YUV420 frames have the luma plane as a contiguous byte array — fastest possible access
- No colour space conversion needed; hull-water boundary is always a strong luminance edge
- Colour analysis adds complexity without meaningful gain for this boundary type

## JS Integration

### `src/hooks/useWaterlineDetector.ts`
- Wraps `useFrameProcessor` from `react-native-vision-camera`
- Calls the native plugin per frame
- Passes confident readings to `WaterlineSmoother`
- Returns `smoothedYNorm` via `runOnJS` callback

### `src/utils/WaterlineSmoother.ts`
- Rolling buffer of 45 frames (≈1.5s at 30fps)
- Averages out swell oscillation
- Only admits readings with `confidence >= 0.3`
- Emits updated mean on each admitted reading

Swell rationale: ocean swells run 0.1–0.3 Hz (3–10s period). A 1.5s window captures roughly half a period, smoothing the oscillation while still tracking slow trim changes.

## Camera Screen Changes (`DraftCameraScreen.tsx`)

- Add `useFrameProcessor` from `useWaterlineDetector`
- Pass `smoothedYNorm` to `interpolateDraft` instead of the manual guide Y
- Add `video={true}` to `<Camera>` (required for frame processor); `photo={true}` stays for OCR snapshots
- `WaterlineGuide` becomes a display-only indicator showing auto-detected position; remove drag handler
- Show LOW confidence indicator in `DraftOverlay` when smoother has < 10 admitted readings

## Confidence & Fallback

| Condition | Behaviour |
|-----------|-----------|
| confidence ≥ 0.3, buffer ≥ 10 frames | Normal reading, HIGH/MED/LOW per interpolator |
| confidence ≥ 0.3, buffer < 10 frames | Reading shown, "stabilising" label |
| confidence < 0.3 | Frame skipped by smoother; last valid position held |
| No frames admitted for > 5s | Overlay shows "point camera at hull" prompt |

## What Is Not In Scope

- Android support (deferred until Android device available)
- CoreML / semantic segmentation (revisit when field data exists)
- Manual guide drag-to-override (can be added later as an escape hatch)
- Automatic camera framing / scale strip finder
