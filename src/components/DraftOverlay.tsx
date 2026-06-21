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
