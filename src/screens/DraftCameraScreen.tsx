import React, { useCallback, useEffect, useRef, useState } from 'react'
import { StyleSheet, View, Text, TouchableOpacity, useWindowDimensions } from 'react-native'
import { Camera, useCameraDevice } from 'react-native-vision-camera'
import { useSharedValue, withTiming } from 'react-native-reanimated'
import { useMLKitOCR } from '../hooks/useMLKitOCR'
import { interpolateDraft } from '../utils/DraftInterpolator'
import type { DraftReading } from '../utils/DraftInterpolator'
import type { ScaleMark } from '../utils/DraftScaleParser'
import { WaterlineGuide } from '../components/WaterlineGuide'
import { DraftOverlay } from '../components/DraftOverlay'
import { useWaterlineDetector } from '../hooks/useWaterlineDetector'

const STABILISE_THRESHOLD = 10

function MarkDebugOverlay({ marks }: { marks: ScaleMark[] }) {
  const { height } = useWindowDimensions()
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {marks.map((mark, i) => {
        const isAnchor = Number.isInteger(mark.value)
        const top = mark.yNorm * height
        const label = isAnchor ? `${mark.value}M` : `${mark.value.toFixed(1)}m`
        return (
          <View key={i} style={[styles.markLine, { top, borderColor: isAnchor ? '#00FF88' : '#FFD700' }]}>
            <View style={[styles.markLineBar, { backgroundColor: isAnchor ? '#00FF88' : '#FFD700' }]} />
            <Text style={[styles.markLabel, { color: isAnchor ? '#00FF88' : '#FFD700' }]}>{label}</Text>
          </View>
        )
      })}
    </View>
  )
}

export default function DraftCameraScreen() {
  const device = useCameraDevice('back')
  const cameraRef = useRef<Camera>(null)
  const { height: screenHeight } = useWindowDimensions()

  const { marks, scanning, debugMsg } = useMLKitOCR(cameraRef, true)
  const [reading, setReading] = useState<DraftReading | null>(null)
  const [bufferSize, setBufferSize] = useState(0)
  const [debugMode, setDebugMode] = useState(false)

  const waterlineYNorm = useSharedValue(0.5)

  useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission()
      if (status !== 'granted') {
        console.warn('Camera permission not granted')
      }
    })()
  }, [])

  const marksRef = useRef(marks)
  useEffect(() => { marksRef.current = marks }, [marks])

  const handleWaterline = useCallback((yNorm: number, size: number) => {
    waterlineYNorm.value = withTiming(yNorm, { duration: 100 })
    setBufferSize(size)
    if (size >= STABILISE_THRESHOLD) {
      setReading(interpolateDraft(marksRef.current, yNorm))
    }
  }, [waterlineYNorm])

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
        pixelFormat="yuv"
        frameProcessor={frameProcessor}
      />

      {debugMode && <MarkDebugOverlay marks={marks} />}

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

      <TouchableOpacity style={styles.gear} onPress={() => setDebugMode(d => !d)}>
        <Text style={styles.gearText}>⚙</Text>
      </TouchableOpacity>

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
  gear: {
    position: 'absolute',
    top: 60,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gearText: { fontSize: 22, color: '#fff' },
  markLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderStyle: 'dashed',
  },
  markLineBar: {
    flex: 1,
    height: 1,
  },
  markLabel: {
    fontSize: 11,
    fontWeight: 'bold',
    paddingHorizontal: 6,
    paddingVertical: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
})
