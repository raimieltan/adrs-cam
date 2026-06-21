import { WaterlineSmoother } from '../WaterlineSmoother'

describe('WaterlineSmoother', () => {
  it('returns null when confidence is below threshold', () => {
    const s = new WaterlineSmoother()
    expect(s.admit(0.5, 0.1)).toBeNull()
    expect(s.size).toBe(0)
  })

  it('admits readings at or above threshold', () => {
    const s = new WaterlineSmoother()
    const result = s.admit(0.5, 0.3)
    expect(result).not.toBeNull()
    expect(s.size).toBe(1)
  })

  it('returns mean of admitted readings', () => {
    const s = new WaterlineSmoother()
    s.admit(0.4, 1.0)
    const result = s.admit(0.6, 1.0)
    expect(result).toBeCloseTo(0.5)
  })

  it('evicts oldest reading when capacity exceeded', () => {
    const s = new WaterlineSmoother(3, 0.0)
    s.admit(0.1, 1.0)
    s.admit(0.2, 1.0)
    s.admit(0.3, 1.0)
    s.admit(0.9, 1.0) // evicts 0.1
    expect(s.size).toBe(3)
    // mean of 0.2, 0.3, 0.9 = 0.4667
    expect(s.mean).toBeCloseTo(0.4667, 3)
  })

  it('clear resets buffer', () => {
    const s = new WaterlineSmoother()
    s.admit(0.5, 1.0)
    s.clear()
    expect(s.size).toBe(0)
    expect(s.mean).toBe(0.5) // default mid-screen
  })

  it('returns 0.5 when buffer is empty (safe default)', () => {
    const s = new WaterlineSmoother()
    expect(s.mean).toBe(0.5)
  })
})
