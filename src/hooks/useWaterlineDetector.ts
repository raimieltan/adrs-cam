import { useFrameProcessor } from 'react-native-vision-camera'
import { Worklets } from 'react-native-worklets-core'
import { useRef, useCallback, useEffect, useMemo } from 'react'
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

  // Worklets.createRunOnJS bridges from VisionCamera's worklets-core thread to JS.
  // runOnJS from Reanimated does not work here — different runtime.
  const handleResultJS = useMemo(
    () => Worklets.createRunOnJS(handleResult),
    [handleResult]
  )

  return useFrameProcessor((frame) => {
    'worklet'
    const result = detectWaterline(frame)
    if (result == null) return
    handleResultJS(result.waterlineYNorm, result.confidence)
  }, [handleResultJS])
}
