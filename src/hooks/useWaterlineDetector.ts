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
