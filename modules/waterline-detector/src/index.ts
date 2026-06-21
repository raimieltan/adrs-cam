import { VisionCameraProxy, type Frame } from 'react-native-vision-camera'

const plugin = VisionCameraProxy.initFrameProcessorPlugin('detectWaterline', {})

export type WaterlinePluginResult = {
  waterlineYNorm: number
  confidence: number
}

export function detectWaterline(frame: Frame): WaterlinePluginResult | null {
  'worklet'
  if (plugin == null) {
    throw new Error('detectWaterline: plugin not found — rebuild the app after adding the module')
  }
  const raw = plugin.call(frame)
  if (raw == null) return null
  return raw as WaterlinePluginResult
}
