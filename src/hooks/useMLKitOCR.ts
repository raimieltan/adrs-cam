import { useRef, useState, useEffect, useCallback } from "react";
import type { Camera } from "react-native-vision-camera";
import MLKit from "react-native-mlkit-ocr";
import { parseScaleMarks } from "../utils/DraftScaleParser";
import type { ScaleMark } from "../utils/DraftScaleParser";

const SCAN_INTERVAL_MS = 2500;
const STARTUP_DELAY_MS = 3000; // wait for AVCaptureSession to fully start

export function useMLKitOCR(
  cameraRef: React.RefObject<Camera | null>,
  enabled: boolean,
  hintMetre: number | null = null
) {
  const [marks, setMarks] = useState<ScaleMark[]>([]);
  const [scanning, setScanning] = useState(false);
  const [debugMsg, setDebugMsg] = useState("waiting...");
  const busy = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Retain the last scan that included a valid metre anchor so OCR misreads
  // (e.g. "10M" → "UM") don't wipe out a known-good mark set.
  const lastAnchoredMarks = useRef<ScaleMark[]>([]);

  const scan = useCallback(async () => {
    if (!cameraRef.current || busy.current) return;
    busy.current = true;
    setScanning(true);
    try {
      const snapshot = await cameraRef.current.takePhoto({
        flash: "off",
        enableShutterSound: false,
      });
      // detectFromFile wants a bare fs path (no file:// prefix)
      const filePath = snapshot.path.startsWith("file://")
        ? snapshot.path.slice(7)
        : snapshot.path;
      const imageHeight = Math.max(snapshot.width, snapshot.height);
      setDebugMsg(`path:...${filePath.slice(-30)} ${snapshot.width}x${snapshot.height}`);

      const result = await MLKit.detectFromFile(filePath);
      const allText = result.flatMap((b) => b.lines.map((l) => l.text)).join("|");
      const parsed = parseScaleMarks(result, imageHeight, hintMetre);
      const hasAnchor = parsed.some((m) => Number.isInteger(m.value));

      if (parsed.length > 0 && hasAnchor) {
        lastAnchoredMarks.current = parsed;
        setMarks(parsed);
        setDebugMsg(`blk:${result.length} OCR:"${allText.slice(0, 80)}" → ${parsed.length}marks`);
      } else if (lastAnchoredMarks.current.length > 0) {
        // OCR missed the metre anchor this scan — keep last good marks
        setDebugMsg(`blk:${result.length} OCR:"${allText.slice(0, 80)}" → ${parsed.length}marks (cached)`);
      } else {
        if (parsed.length > 0) setMarks(parsed);
        setDebugMsg(`blk:${result.length} OCR:"${allText.slice(0, 80)}" → ${parsed.length}marks`);
      }
    } catch (e: unknown) {
      // "Cannot Record" (-11803) = session not ready yet, skip silently
      const msg = e instanceof Error ? e.message : String(e);
      setDebugMsg(`skip: ${msg.slice(0, 60)}`);
    } finally {
      busy.current = false;
      setScanning(false);
    }
  }, [cameraRef, hintMetre]);

  useEffect(() => {
    if (!enabled) return;
    const startup = setTimeout(() => {
      scan();
      intervalRef.current = setInterval(scan, SCAN_INTERVAL_MS);
    }, STARTUP_DELAY_MS);
    return () => {
      clearTimeout(startup);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [enabled, scan]);

  return { marks, scanning, debugMsg };
}
