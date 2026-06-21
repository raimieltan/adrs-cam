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
