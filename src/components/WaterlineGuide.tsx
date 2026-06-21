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
