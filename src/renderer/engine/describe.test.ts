import { describe, expect, it } from 'vitest'
import type { GlassMetrics } from './engine'
import { createGlass } from './geometry'
import { describeGlass, summarizeMetrics } from './describe'

function metrics(patch: Partial<GlassMetrics>): GlassMetrics {
  return {
    avgTemp: 900,
    avgThickness: 0.2,
    avgBubbles: 0.1,
    maxStress: 0,
    maxCracks: 0,
    isRuined: false,
    rimRadius: 0.1,
    neckRadius: 0.08,
    bodyRadius: 0.2,
    elongation: 1.2,
    isVase: false,
    ...patch
  }
}

describe('状态概述', () => {
  it('未成型且无报废时为「成形中」', () => {
    const s = summarizeMetrics(metrics({}))
    expect(s.status).toBe('成形中')
    expect(s.tone).toBe('plain')
    expect(s.warnings).toEqual([])
  })

  it('达到花瓶判定为「已成型」，贯穿开裂为「已报废」', () => {
    expect(summarizeMetrics(metrics({ isVase: true })).status).toBe('已成型')
    expect(summarizeMetrics(metrics({ isVase: true })).tone).toBe('good')
    const ruined = summarizeMetrics(metrics({ isRuined: true, maxCracks: 1 }))
    expect(ruined.status).toBe('已报废')
    expect(ruined.tone).toBe('bad')
    // 报废件不再重复标注「有裂纹」
    expect(ruined.warnings).not.toContain('有裂纹')
  })

  it('按阈值给出裂纹 / 气泡 / 应力警示', () => {
    const s = summarizeMetrics(metrics({ maxCracks: 0.5, avgBubbles: 0.4, maxStress: 80 }))
    expect(s.warnings).toEqual(['有裂纹', '多气泡', '高应力'])
    expect(summarizeMetrics(metrics({ maxCracks: 0.39 })).warnings).toEqual([])
  })

  it('汇总行包含状态、温度与伸长', () => {
    const s = summarizeMetrics(metrics({ avgTemp: 856.4, elongation: 1.234 }))
    expect(s.line).toBe('成形中 · 856℃ · 伸长×1.23')
  })

  it('describeGlass 直接由玻璃状态生成一句话', () => {
    const line = describeGlass(createGlass())
    expect(line).toContain('成形中')
    expect(line).toContain('℃')
  })
})
