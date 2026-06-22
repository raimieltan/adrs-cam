# Waterline Auto-Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual draggable waterline guide with a native Swift frame processor plugin that detects the hull-water boundary in every camera frame using Accelerate luma analysis, smoothed over a 45-frame rolling buffer to average out swell motion.

**Architecture:** A VisionCamera v4 frame processor plugin (Swift + Accelerate) runs on the camera capture thread each frame, locks the luma plane, computes per-row brightness means across a center strip, and returns the waterline Y as a normalised float. A TypeScript rolling buffer (`WaterlineSmoother`) admits confident readings and emits a smoothed Y. `DraftCameraScreen` drives `interpolateDraft` from the smoothed Y instead of the manual guide.

**Tech Stack:** React Native / Expo SDK 56, react-native-vision-camera ^4.7.3, react-native-reanimated ^4.4.1, react-native-worklets-core ^1.6.3, Swift + Accelerate.framework, ExpoModulesCore, CocoaPods autolinking

## Global Constraints

- iOS only — no Android code
- Expo SDK ~56.0.12, expo-dev-client ^56.0.20 — bare workflow, `expo run:ios` required after native changes
- react-native-vision-camera ^4.7.3 — use v4 plugin API (`FrameProcessorPluginRegistry`)
- No new JS dependencies beyond dev tooling
- `WaterlineSmoother` capacity = 45 frames, minConfidence = 0.3 (per spec)
- Stabilising threshold = 10 admitted frames (per spec)

---

### Task 1: Local Expo Module Scaffold

**Files:**
- Create: `modules/waterline-detector/package.json`
- Create: `modules/waterline-detector/expo-module.config.json`
- Create: `modules/waterline-detector/waterline-detector.podspec`
- Create: `modules/waterline-detector/src/index.ts`
- Modify: `package.json` (root)

**Interfaces:**
- Produces: npm package `waterline-detector` importable from app code; VisionCamera plugin name `"detectWaterline"` registered at app start

- [ ] **Step 1: Create module package.json**

```json
{
  "name": "waterline-detector",
  "version": "1.0.0",
  "description": "VisionCamera frame processor plugin for hull waterline detection",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "license": "MIT"
}
```

Save to `modules/waterline-detector/package.json`.

- [ ] **Step 2: Create expo-module.config.json**

```json
{
  "platforms": ["ios"],
  "ios": {
    "modules": ["WaterlineDetectorModule"]
  }
}
```

Save to `modules/waterline-detector/expo-module.config.json`.

- [ ] **Step 3: Create podspec**

```ruby
require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'waterline-detector'
  s.version        = package['version']
  s.summary        = package['description']
  s.license        = package['license']
  s.homepage       = 'https://github.com/placeholder'
  s.author         = 'placeholder'
  s.platforms      = { :ios => '13.4' }
  s.source         = { :git => '' }
  s.source_files   = 'ios/**/*.{h,m,mm,swift}'
  s.dependency 'ExpoModulesCore'
  s.dependency 'VisionCamera'
end
```

Save to `modules/waterline-detector/waterline-detector.podspec`.

- [ ] **Step 4: Create JS plugin interface**

```typescript
import { VisionCameraProxy, type Frame } from 'react-native-vision-camera'

const plugin = VisionCameraProxy.initFrameProcessorPlugin('detectWaterline', {})

export type WaterlinePluginResult = {
  waterlineYNorm: number
  confidence: number
}

export function detectWaterline(frame: Frame): WaterlinePluginResult {
  'worklet'
  if (plugin == null) {
    throw new Error('detectWaterline: plugin not found — rebuild the app after adding the module')
  }
  return plugin.call(frame) as WaterlinePluginResult
}
```

Save to `modules/waterline-detector/src/index.ts`.

- [ ] **Step 5: Add module to root package.json**

Open `package.json` (root). In the `"dependencies"` object, add:

```json
"waterline-detector": "file:./modules/waterline-detector"
```

- [ ] **Step 6: Install**

```bash
npm install
```

Expected: `added 0 packages` or similar; `node_modules/waterline-detector` is a symlink to `modules/waterline-detector`.

- [ ] **Step 7: Commit**

```bash
git add modules/waterline-detector/ package.json package-lock.json
git commit -m "feat: scaffold waterline-detector local Expo module"
```

---

### Task 2: Swift Frame Processor Plugin

**Files:**
- Create: `modules/waterline-detector/ios/WaterlineDetectorPlugin.swift`
- Create: `modules/waterline-detector/ios/WaterlineDetectorPlugin.m`

**Interfaces:**
- Consumes: VisionCamera `Frame`, `CMSampleBuffer`, `Accelerate` (vDSP_vfltu8, vDSP_meanv)
- Produces: ObjC plugin registration under name `"detectWaterline"`; returns `{ waterlineYNorm: Double, confidence: Double }`

- [ ] **Step 1: Write the Swift plugin**

```swift
import Accelerate
import CoreVideo
import VisionCamera

@objc(WaterlineDetectorPlugin)
public class WaterlineDetectorPlugin: FrameProcessorPlugin {
    public required init(proxy: VisionCameraProxyHolder, options: [AnyHashable: Any]! = [:]) {
        super.init(proxy: proxy, options: options)
    }

    public override func callback(_ frame: Frame, withArguments arguments: [AnyHashable: Any]?) -> Any? {
        guard let imageBuffer = CMSampleBufferGetImageBuffer(frame.buffer) else { return nil }

        CVPixelBufferLockBaseAddress(imageBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(imageBuffer, .readOnly) }

        // Work on luma (Y) plane of YUV420 — no colour conversion, fastest access
        guard CVPixelBufferGetPlaneCount(imageBuffer) >= 1 else { return nil }

        let fullWidth  = CVPixelBufferGetWidthOfPlane(imageBuffer, 0)
        let fullHeight = CVPixelBufferGetHeightOfPlane(imageBuffer, 0)
        let bytesPerRow = CVPixelBufferGetBytesPerRowOfPlane(imageBuffer, 0)

        guard let base = CVPixelBufferGetBaseAddressOfPlane(imageBuffer, 0),
              fullWidth > 0, fullHeight > 0 else { return nil }

        let luma = base.assumingMemoryBound(to: UInt8.self)

        // Center horizontal strip: columns 35 %–65 % of width
        let stripLeft  = fullWidth * 35 / 100
        let stripWidth = max(1, fullWidth * 30 / 100)

        // Search rows 20 %–80 % of height — skip edges
        let searchStart = fullHeight * 20 / 100
        let searchEnd   = fullHeight * 80 / 100
        let searchCount = searchEnd - searchStart
        guard searchCount > 2 else { return nil }

        // Per-row mean luma across strip using vDSP (SIMD-vectorised)
        var rowMeans  = [Float](repeating: 0, count: searchCount)
        var rowFloats = [Float](repeating: 0, count: stripWidth)

        for i in 0 ..< searchCount {
            let row    = searchStart + i
            let rowPtr = luma.advanced(by: row * bytesPerRow + stripLeft)
            vDSP_vfltu8(rowPtr, 1, &rowFloats, 1, vDSP_Length(stripWidth))
            var mean: Float = 0
            vDSP_meanv(rowFloats, 1, &mean, vDSP_Length(stripWidth))
            rowMeans[i] = mean
        }

        // Largest positive first-order difference = sharpest brightness drop top→bottom = waterline
        var maxDrop: Float = 0
        var waterlineIndex = searchCount / 2

        for i in 0 ..< (searchCount - 1) {
            let drop = rowMeans[i] - rowMeans[i + 1]
            if drop > maxDrop {
                maxDrop      = drop
                waterlineIndex = i
            }
        }

        let waterlineRow  = searchStart + waterlineIndex
        let waterlineYNorm = Double(waterlineRow) / Double(fullHeight)
        // 30 luma units ≈ reliable hull/water edge; clamp to [0, 1]
        let confidence = Double(min(maxDrop / 30.0, 1.0))

        return ["waterlineYNorm": waterlineYNorm, "confidence": confidence] as [String: Any]
    }
}
```

Save to `modules/waterline-detector/ios/WaterlineDetectorPlugin.swift`.

- [ ] **Step 2: Write the ObjC registration file**

This calls `+load` at app start to register the Swift class under the name `"detectWaterline"`. The Swift header name follows CocoaPods convention: `<pod_name_underscored>-Swift.h`.

```objc
#import <VisionCamera/FrameProcessorPlugin.h>
#import <VisionCamera/FrameProcessorPluginRegistry.h>
#import "waterline_detector-Swift.h"

@interface WaterlineDetectorPlugin (FrameProcessorPlugin)
@end

@implementation WaterlineDetectorPlugin (FrameProcessorPlugin)
+ (void)load {
    [FrameProcessorPluginRegistry
        addFrameProcessorPlugin:@"detectWaterline"
                withInitializer:^FrameProcessorPlugin *(VisionCameraProxyHolder *proxy,
                                                        NSDictionary *options) {
            return [[WaterlineDetectorPlugin alloc] initWithProxy:proxy withOptions:options];
        }];
}
@end
```

Save to `modules/waterline-detector/ios/WaterlineDetectorPlugin.m`.

> **Note on the Swift header import:** If the build fails with "file not found" on `waterline_detector-Swift.h`, open the `.xcworkspace` in Xcode, select the `waterline-detector` target → Build Settings → search "Swift Compiler - General" → "Objective-C Generated Interface Header Name". Use whatever value appears there.

- [ ] **Step 3: Commit**

```bash
git add modules/waterline-detector/ios/
git commit -m "feat: Swift luma-plane waterline detector VisionCamera plugin"
```

---

### Task 3: Expo Module Wrapper (Swift)

**Files:**
- Create: `modules/waterline-detector/ios/WaterlineDetectorModule.swift`

**Interfaces:**
- Consumes: `ExpoModulesCore.Module`
- Produces: Expo module named `"WaterlineDetector"` — required for autolinking to include the pod in the app target (even though it exposes no JS API)

- [ ] **Step 1: Write the module**

```swift
import ExpoModulesCore

public class WaterlineDetectorModule: Module {
    public func definition() -> ModuleDefinition {
        Name("WaterlineDetector")
        // No JS API — the frame processor plugin is the sole interface.
    }
}
```

Save to `modules/waterline-detector/ios/WaterlineDetectorModule.swift`.

- [ ] **Step 2: Commit**

```bash
git add modules/waterline-detector/ios/WaterlineDetectorModule.swift
git commit -m "feat: Expo module wrapper for waterline-detector autolinking"
```

---

### Task 4: WaterlineSmoother (TypeScript, TDD)

**Files:**
- Create: `src/utils/WaterlineSmoother.ts`
- Create: `src/utils/__tests__/WaterlineSmoother.test.ts`
- Modify: `package.json` (add jest config + dev dep)

**Interfaces:**
- Produces: `class WaterlineSmoother { admit(yNorm: number, confidence: number): number | null; get mean(): number; get size(): number; clear(): void }`

- [ ] **Step 1: Add Jest**

In root `package.json`, add to `"devDependencies"`:
```json
"jest": "^29.7.0",
"@types/jest": "^29.5.14",
"jest-expo": "^56.0.0",
"ts-jest": "^29.4.0"
```

Add top-level `"jest"` key:
```json
"jest": {
  "preset": "jest-expo",
  "testMatch": ["**/__tests__/**/*.test.ts"]
}
```

Add to `"scripts"`:
```json
"test": "jest"
```

Then run:
```bash
npm install
```

- [ ] **Step 2: Write failing tests**

```typescript
import { WaterlineSmoother } from '../WaterlineSmoother'

describe('WaterlineSmoother', () => {
  it('returns null when confidence is below threshold', () => {
    const s = new WaterlineSmoother()
    expect(s.admit(0.5, 0.1)).toBeNull()
    expect(s.size).toBe(0)
  })

  it('admits readings at or above threshold', () => {
    const s = new WaterlineSmoother()
    const result = s.admit(0.5, 0.3)
    expect(result).not.toBeNull()
    expect(s.size).toBe(1)
  })

  it('returns mean of admitted readings', () => {
    const s = new WaterlineSmoother()
    s.admit(0.4, 1.0)
    const result = s.admit(0.6, 1.0)
    expect(result).toBeCloseTo(0.5)
  })

  it('evicts oldest reading when capacity exceeded', () => {
    const s = new WaterlineSmoother(3, 0.0)
    s.admit(0.1, 1.0)
    s.admit(0.2, 1.0)
    s.admit(0.3, 1.0)
    s.admit(0.9, 1.0) // evicts 0.1
    expect(s.size).toBe(3)
    // mean of 0.2, 0.3, 0.9 = 0.4667
    expect(s.mean).toBeCloseTo(0.4667, 3)
  })

  it('clear resets buffer', () => {
    const s = new WaterlineSmoother()
    s.admit(0.5, 1.0)
    s.clear()
    expect(s.size).toBe(0)
    expect(s.mean).toBe(0.5) // default mid-screen
  })

  it('returns 0.5 when buffer is empty (safe default)', () => {
    const s = new WaterlineSmoother()
    expect(s.mean).toBe(0.5)
  })
})
```

Save to `src/utils/__tests__/WaterlineSmoother.test.ts`.

- [ ] **Step 3: Run to verify tests fail**

```bash
npm test -- --testPathPattern=WaterlineSmoother
```

Expected: FAIL — `Cannot find module '../WaterlineSmoother'`

- [ ] **Step 4: Implement WaterlineSmoother**

```typescript
export class WaterlineSmoother {
  private readonly buffer: number[] = []
  private readonly capacity: number
  private readonly minConfidence: number

  constructor(capacity = 45, minConfidence = 0.3) {
    this.capacity = capacity
    this.minConfidence = minConfidence
  }

  admit(yNorm: number, confidence: number): number | null {
    if (confidence < this.minConfidence) return null
    this.buffer.push(yNorm)
    if (this.buffer.length > this.capacity) this.buffer.shift()
    return this.mean
  }

  get mean(): number {
    if (this.buffer.length === 0) return 0.5
    return this.buffer.reduce((a, b) => a + b, 0) / this.buffer.length
  }

  get size(): number {
    return this.buffer.length
  }

  clear(): void {
    this.buffer.length = 0
  }
}
```

Save to `src/utils/WaterlineSmoother.ts`.

- [ ] **Step 5: Run to verify tests pass**

```bash
npm test -- --testPathPattern=WaterlineSmoother
```

Expected: PASS — 6 tests passing

- [ ] **Step 6: Commit**

```bash
git add src/utils/WaterlineSmoother.ts src/utils/__tests__/ package.json package-lock.json
git commit -m "feat: WaterlineSmoother rolling buffer with swell averaging"
```

---

### Task 5: useWaterlineDetector Hook

**Files:**
- Create: `src/hooks/useWaterlineDetector.ts`

**Interfaces:**
- Consumes: `detectWaterline` from `waterline-detector`; `WaterlineSmoother`; `useFrameProcessor`, `runOnJS`
- Produces: `function useWaterlineDetector(onUpdate: (yNorm: number, bufferSize: number) => void): FrameProcessor`

- [ ] **Step 1: Write the hook**

```typescript
import { useFrameProcessor } from 'react-native-vision-camera'
import { runOnJS } from 'react-native-reanimated'
import { useRef, useCallback, useEffect } from 'react'
import { WaterlineSmoother } from '../utils/WaterlineSmoother'
import { detectWaterline } from 'waterline-detector'

type WaterlineCallback = (yNorm: number, bufferSize: number) => void

export function useWaterlineDetector(onUpdate: WaterlineCallback) {
  const smoother = useRef(new WaterlineSmoother())

  useEffect(() => {
    return () => { smoother.current.clear() }
  }, [])

  const handleResult = useCallback((yNorm: number, confidence: number) => {
    const smoothed = smoother.current.admit(yNorm, confidence)
    if (smoothed !== null) {
      onUpdate(smoothed, smoother.current.size)
    }
  }, [onUpdate])

  return useFrameProcessor((frame) => {
    'worklet'
    const result = detectWaterline(frame)
    runOnJS(handleResult)(result.waterlineYNorm, result.confidence)
  }, [handleResult])
}
```

Save to `src/hooks/useWaterlineDetector.ts`.

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useWaterlineDetector.ts
git commit -m "feat: useWaterlineDetector hook wrapping frame processor + smoother"
```

---

### Task 6: WaterlineGuide — Display-Only

**Files:**
- Modify: `src/components/WaterlineGuide.tsx`

**Interfaces:**
- Consumes: `SharedValue<number>` for position (Reanimated); removes `onYChange` callback
- Produces: `function WaterlineGuide(props: { yNorm: SharedValue<number>; draftLabel?: string; confidence?: 'HIGH' | 'MED' | 'LOW' })`

- [ ] **Step 1: Rewrite WaterlineGuide**

Replace the entire file content with:

```typescript
import React from 'react'
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import Animated, {
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated'

type Props = {
  yNorm: SharedValue<number>
  draftLabel?: string
  confidence?: 'HIGH' | 'MED' | 'LOW'
}

const CONFIDENCE_COLOR: Record<string, string> = {
  HIGH: '#00FF88',
  MED: '#FFD700',
  LOW: '#FF6B35',
}

export function WaterlineGuide({ yNorm, draftLabel, confidence }: Props) {
  const { height } = useWindowDimensions()
  const color = confidence ? CONFIDENCE_COLOR[confidence] : '#FFFFFF'

  const lineStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: yNorm.value * height }],
  }))

  return (
    <Animated.View style={[styles.container, lineStyle]}>
      <View style={[styles.line, { borderColor: color }]} />
      {draftLabel ? (
        <View style={[styles.label, { backgroundColor: color + 'CC' }]}>
          <Text style={styles.labelText}>{draftLabel}</Text>
        </View>
      ) : null}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 44,
    justifyContent: 'center',
    marginTop: -22,
  },
  line: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  label: {
    position: 'absolute',
    right: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  labelText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000',
    fontVariant: ['tabular-nums'],
  },
})
```

- [ ] **Step 2: Commit**

```bash
git add src/components/WaterlineGuide.tsx
git commit -m "feat: WaterlineGuide converted to display-only with SharedValue prop"
```

---

### Task 7: DraftOverlay — Add bufferSize / Stabilising

**Files:**
- Modify: `src/components/DraftOverlay.tsx`

**Interfaces:**
- Consumes: existing props + `bufferSize: number`
- Produces: shows "Stabilising… N/10" when `bufferSize > 0 && bufferSize < 10`

- [ ] **Step 1: Add bufferSize prop and stabilising indicator**

Replace the entire file:

```typescript
import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import type { DraftReading } from '../utils/DraftInterpolator'

type Props = {
  reading: DraftReading | null
  marksCount: number
  scanning: boolean
  debugMsg?: string
  bufferSize: number
}

const CONFIDENCE_COLOR: Record<string, string> = {
  HIGH: '#00FF88',
  MED: '#FFD700',
  LOW: '#FF6B35',
}

export function DraftOverlay({ reading, marksCount, scanning, debugMsg, bufferSize }: Props) {
  const color = reading ? CONFIDENCE_COLOR[reading.confidence] : '#ffffff66'
  const stabilising = bufferSize > 0 && bufferSize < 10

  return (
    <View style={styles.container}>
      <Text style={[styles.primary, { color }]}>
        {reading ? `${reading.draft.toFixed(2)} m` : '— m'}
      </Text>

      {reading && (
        <Text style={[styles.badge, { color }]}>{reading.confidence}</Text>
      )}

      {stabilising && (
        <Text style={styles.stabilising}>Stabilising… {bufferSize}/10</Text>
      )}

      <Text style={styles.secondary}>
        {marksCount > 0
          ? `${marksCount} mark${marksCount !== 1 ? 's' : ''} detected`
          : 'No marks detected'}
      </Text>

      {scanning && <Text style={styles.scanning}>Scanning…</Text>}

      {debugMsg ? (
        <Text style={styles.debug} numberOfLines={3}>{debugMsg}</Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 50,
    left: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 14,
    borderRadius: 10,
  },
  primary: {
    fontSize: 36,
    fontWeight: 'bold',
    fontVariant: ['tabular-nums'],
  },
  badge: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 4,
  },
  stabilising: {
    fontSize: 11,
    color: '#FFD700',
    marginBottom: 4,
  },
  secondary: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
  },
  scanning: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 2,
  },
  debug: {
    fontSize: 10,
    color: '#FFD700',
    marginTop: 4,
    maxWidth: 280,
  },
})
```

- [ ] **Step 2: Commit**

```bash
git add src/components/DraftOverlay.tsx
git commit -m "feat: DraftOverlay shows stabilising progress during buffer warm-up"
```

---

### Task 8: Wire DraftCameraScreen

**Files:**
- Modify: `src/screens/DraftCameraScreen.tsx`

**Interfaces:**
- Consumes: `useWaterlineDetector`, `useSharedValue`, `withTiming`, `WaterlineGuide` (SharedValue API), `DraftOverlay` (bufferSize prop)
- Produces: fully wired screen with auto waterline, `video={true}` on Camera

- [ ] **Step 1: Rewrite DraftCameraScreen**

Replace the entire file:

```typescript
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { StyleSheet, useWindowDimensions, View, Text } from 'react-native'
import { Camera, useCameraDevice } from 'react-native-vision-camera'
import { useSharedValue, withTiming } from 'react-native-reanimated'
import { useMLKitOCR } from '../hooks/useMLKitOCR'
import { interpolateDraft } from '../utils/DraftInterpolator'
import type { DraftReading } from '../utils/DraftInterpolator'
import { WaterlineGuide } from '../components/WaterlineGuide'
import { DraftOverlay } from '../components/DraftOverlay'
import { useWaterlineDetector } from '../hooks/useWaterlineDetector'

const STABILISE_THRESHOLD = 10

export default function DraftCameraScreen() {
  const device = useCameraDevice('back')
  const cameraRef = useRef<Camera>(null)

  const { marks, scanning, debugMsg } = useMLKitOCR(cameraRef, true)
  const [reading, setReading] = useState<DraftReading | null>(null)
  const [bufferSize, setBufferSize] = useState(0)

  const waterlineYNorm = useSharedValue(0.5)

  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission()
      if (status !== 'granted') {
        console.warn('Camera permission not granted')
      }
    })()
  }, [])

  const handleWaterline = useCallback((yNorm: number, size: number) => {
    waterlineYNorm.value = withTiming(yNorm, { duration: 100 })
    setBufferSize(size)
    if (size >= STABILISE_THRESHOLD) {
      setReading(interpolateDraft(marks, yNorm))
    }
  }, [marks, waterlineYNorm])

  const frameProcessor = useWaterlineDetector(handleWaterline)

  if (!device) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>No camera device found</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        photo={true}
        video={true}
        frameProcessor={frameProcessor}
      />

      <WaterlineGuide
        yNorm={waterlineYNorm}
        draftLabel={reading ? `${reading.draft.toFixed(2)} m` : undefined}
        confidence={reading?.confidence}
      />

      <DraftOverlay
        reading={reading}
        marksCount={marks.length}
        scanning={scanning}
        debugMsg={debugMsg}
        bufferSize={bufferSize}
      />

      {bufferSize === 0 && (
        <View style={styles.noSignal}>
          <Text style={styles.noSignalText}>Point camera at hull</Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  errorText: { color: '#fff', fontSize: 16 },
  noSignal: {
    position: 'absolute',
    top: '40%',
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  noSignalText: { color: '#fff', fontSize: 16 },
})
```

- [ ] **Step 2: Commit**

```bash
git add src/screens/DraftCameraScreen.tsx
git commit -m "feat: wire auto waterline detection into DraftCameraScreen"
```

---

### Task 9: Native Build and Smoke Test

**Files:** None created/modified — this task is verification only.

- [ ] **Step 1: Install pods**

```bash
cd ios && pod install && cd ..
```

Expected: `Pod installation complete!` — `waterline-detector` pod should appear in the install list. If it does not, run `npx expo install` first, then `pod install` again.

- [ ] **Step 2: Build and run on device**

```bash
npx expo run:ios --device
```

Expected: app builds and launches. Watch Metro output for errors.

- [ ] **Step 3: Verify plugin loads**

With the app open, check Xcode console / Metro for any error containing `detectWaterline`. If you see `"detectWaterline: plugin not found"`, the ObjC `+load` did not fire — verify `WaterlineDetectorPlugin.m` is in the Xcode target (Products → Build Phases → Compile Sources).

- [ ] **Step 4: Smoke test on device against the hull**

Point camera at any high-contrast horizontal boundary (table edge, doorframe, ship hull). Observe:
- The dashed guide line moves to the detected boundary automatically
- Debug overlay shows `Stabilising… N/10` for ~0.3s then switches to a draft reading
- "Point camera at hull" prompt disappears once a confident reading is established

- [ ] **Step 5: Test low-confidence fallback**

Point camera at the sky or a blank wall. Observe: `bufferSize` stops increasing (readings rejected), guide line holds its last position, "Point camera at hull" prompt reappears after current buffer drains (note: buffer does not auto-drain — this is acceptable for v1; if readings are rejected the size stops growing but doesn't reset).

> If you want the buffer to drain over time, add a `setTimeout` in `handleWaterline` that calls `smoother.current.clear()` after 5s of no admitted readings — but this is out of scope for this plan.

- [ ] **Step 6: Commit verification note**

```bash
git commit --allow-empty -m "chore: smoke test passed — waterline autodetect working on device"
```
