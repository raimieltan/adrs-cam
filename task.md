# ADRS POC – Live Camera Feed Module

## Goal

Enable **real-time video ingestion from mobile camera** and stream frames into the **OpenCV draft detection pipeline**.

This replaces MP4 input with live camera feed while keeping processing fully offline.

---

# Recommended Approach (POC)

Use:

- `react-native-vision-camera`
- Frame Processor Plugin (JS + optional native bridge)
- Optional: direct OpenCV native hook later

This is the fastest path to working real-time CV on both iOS + Android.

---

# Architecture (Live Mode)


Camera Sensor
↓
VisionCamera Frame Processor
↓
Frame Buffer (Shared Work Queue)
↓
OpenCV Native Module (C++ optional)
↓
Draft Detection Pipeline
↓
Wave Smoothing Engine
↓
UI Overlay (React Native)


---

# Installation

## Required dependency

```bash
yarn add react-native-vision-camera

iOS:

cd ios && pod install
Permissions
AndroidManifest.xml
<uses-permission android:name="android.permission.CAMERA" />
Info.plist (iOS)
<key>NSCameraUsageDescription</key>
<string>ADRS requires camera access for draft reading</string>
Camera Screen (Core POC)
DraftCameraScreen.tsx
import React, { useEffect } from "react";
import { View, Text } from "react-native";
import { Camera, useCameraDevice, useFrameProcessor } from "react-native-vision-camera";
import { runOnJS } from "react-native-reanimated";
import { useDraftStore } from "../store/draftStore";

export default function DraftCameraScreen() {
  const device = useCameraDevice("back");
  const setFrameResult = useDraftStore((s) => s.setFrameResult);

  useEffect(() => {
    (async () => {
      const cameraPermission = await Camera.requestCameraPermission();
      if (cameraPermission !== "authorized") {
        console.warn("Camera permission not granted");
      }
    })();
  }, []);

  const frameProcessor = useFrameProcessor((frame) => {
    "worklet";

    // Send frame to native/OpenCV pipeline
    const result = processFrame(frame);

    runOnJS(setFrameResult)(result);
  }, []);

  if (!device) return <Text>No camera device found</Text>;

  return (
    <View style={{ flex: 1 }}>
      <Camera
        style={{ flex: 1 }}
        device={device}
        isActive={true}
        frameProcessor={frameProcessor}
        frameProcessorFps={10}
      />

      <DraftOverlay />
    </View>
  );
}
Frame Processor Bridge (POC Stub)
Option A (JS stub first)
export function processFrame(frame: any) {
  // POC fallback: simulate OpenCV result
  return {
    rawDraft: 11 + Math.random() * 0.2,
    stableDraft: 11.05,
    waterlineY: 260,
    confidence: 0.8 + Math.random() * 0.1,
  };
}
Option B (REAL OpenCV Hook – recommended next step)
Native binding signature
struct FrameResult {
    float rawDraft;
    float stableDraft;
    float confidence;
    int waterlineY;
};

FrameResult processFrame(Mat frame);
Frame Rate Control

Set:

frameProcessorFps={10}
Why:
stabilizes CPU usage
enough for wave averaging
reduces jitter noise
Draft Overlay Component
import React from "react";
import { View, Text } from "react-native";
import { useDraftStore } from "../store/draftStore";

export function DraftOverlay() {
  const { rawDraft, stableDraft, confidence } = useDraftStore();

  return (
    <View style={{ position: "absolute", bottom: 50, left: 20 }}>
      <Text style={{ fontSize: 32, color: "white" }}>
        {stableDraft?.toFixed(2)} m
      </Text>

      <Text style={{ color: "white" }}>
        Raw: {rawDraft?.toFixed(2)}
      </Text>

      <Text style={{ color: "white" }}>
        Confidence: {Math.round(confidence * 100)}%
      </Text>
    </View>
  );
}
Zustand Store
import { create } from "zustand";

type DraftState = {
  rawDraft: number;
  stableDraft: number;
  confidence: number;
  waterlineY: number;
  setFrameResult: (data: any) => void;
};

export const useDraftStore = create<DraftState>((set) => ({
  rawDraft: 0,
  stableDraft: 0,
  confidence: 0,
  waterlineY: 0,

  setFrameResult: (data) =>
    set(() => ({
      rawDraft: data.rawDraft,
      stableDraft: data.stableDraft,
      confidence: data.confidence,
      waterlineY: data.waterlineY,
    })),
}));
OpenCV Integration Hook Point

Replace processFrame(frame) with:

FrameResult processFrame(Mat frame) {
    Mat processed = preprocess(frame);

    auto marks = detectDraftMarks(processed);
    int waterline = detectWaterline(processed);

    float draft = computeDraft(marks, waterline);
    float stable = smoothDraft(draft);

    return {draft, stable, 0.85, waterline};
}
Performance Notes (IMPORTANT)

For live feed stability:

MUST DO
cap FPS at 10–12
resize frames to ~720p or lower
convert to grayscale before OpenCV pipeline
reuse Mats (avoid allocations per frame)
DO NOT
process full 4K frames
run OCR every frame
block JS thread
Wave Stability Layer (Live Mode)

Use rolling buffer:

const buffer = [];

function smooth(value) {
  buffer.push(value);
  if (buffer.length > 15) buffer.shift();

  return buffer.reduce((a, b) => a + b) / buffer.length;
}
Success Criteria (Live Camera POC)

System is valid if:

Camera feed renders smoothly
Frame processing runs at ≥8 FPS
Draft values update continuously
UI does not freeze
Stability improves over ~10 frames
No internet required