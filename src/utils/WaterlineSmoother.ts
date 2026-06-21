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
