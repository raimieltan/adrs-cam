# Draft Detection — Design Spec

## Goal
Replace the JS stub in `frameProcessor.ts` with real draft reading using ML Kit OCR + a user-guided waterline.

## Constraints
- Cross-platform: iOS + Android
- Fully offline
- Target precision: nearest 5 cm
- Metric marks, 20 cm increments, whole-metre marks suffixed with "M" (e.g. `1M`, `2M`)

## Architecture
Camera feed → periodic snapshot (1.5 s) → ML Kit OCR → DraftScaleParser → DraftInterpolator ← WaterlineGuide Y position → draft value displayed in DraftOverlay

## Components

| File | Role |
|---|---|
| `src/hooks/useMLKitOCR.ts` | Periodically snapshots camera, runs OCR, returns parsed mark list |
| `src/utils/DraftScaleParser.ts` | Converts raw OCR text+bounds → `{value, yCenter}[]` sorted by yCenter |
| `src/utils/DraftInterpolator.ts` | Marks + guideY → `{draft, confidence}` |
| `src/components/WaterlineGuide.tsx` | Draggable horizontal line, reports Y via callback |
| `src/screens/DraftCameraScreen.tsx` | Orchestrates all of the above |
| `src/components/DraftOverlay.tsx` | Displays draft + confidence |

## Scale Parser Algorithm
1. Filter OCR elements matching `/^\d+[Mm]?$/`
2. Identify metre anchors: text contains "M" → value = parseInt * 1.0
3. Sort all by screen Y ascending (smaller Y = top = larger draft)
4. For each digit mark (2,4,6,8): find nearest M mark visually below (larger Y) → value = thatMetre + digit/10. If none, assume 0M base.
5. Return sorted `{value, yCenter}[]`

## Interpolation
Given guideY between two marks at (Y_a, D_a) and (Y_b, D_b) where Y_a < Y_b:
`t = (guideY − Y_a) / (Y_b − Y_a)` → `draft = D_a + t * (D_b − D_a)` → round to nearest 0.05

## Confidence
- HIGH: ≥2 marks above guide + ≥2 below
- MED: ≥1 above + ≥1 below
- LOW: guide is extrapolating beyond visible marks

## Dependencies
- `react-native-mlkit-ocr` — offline OCR, iOS + Android
- `react-native-gesture-handler` — draggable guide line
- `react-native-reanimated` — already installed
