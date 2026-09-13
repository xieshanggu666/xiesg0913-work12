import { describe, expect, it } from 'vitest'
import { Engine, DEFAULT_PARAMS, measure, stepGlass } from './engine'
import { createGlass, fromGlassJSON, toGlassJSON } from './geometry'
import type { FrameInput } from '@shared/types'

function input(tool: FrameInput['tool'], y: number, pressure = 0.9, patch: Partial<FrameInput['params']> = {}): FrameInput {
  return { tool, y, x: 0, pressure, params: { ...DEFAULT_PARAMS, ...patch } }
}

function settle(engine: Engine, frames: number): void {
  for (let i = 0; i < frames; i++) engine.tick()
}

describe('初始料泡', () => {
  it('是一团无裂纹、低气泡的熔融球', () => {
    const g = createGlass()
    const m = measure(g)
    expect(m.avgTemp).toBeGreaterThan(850)
    expect(m.maxCracks).toBe(0)
    expect(m.maxStress).toBe(0)
    expect(m.avgBubbles).toBeLessThan(0.2)
    // 球体中部最宽
    const rs = g.stations.map((s) => s.r)
    expect(Math.max(...rs)).toBe(rs[Math.floor(rs.length / 2)])
  })
})

describe('火焰工具', () => {
  it('局部加热焦点站点，远处不升温', () => {
    const e = new Engine()
    e.reset()
    const cold = e.glass.stations.map((s) => s.temp)
    e.setTool('flame')
    e.setParams({ temperature: 1200 })
    e.setPointer(0, 0.5)
    e.setPressure(1)
    settle(e, 60)
    const hot = e.glass.stations.map((s) => s.temp)
    expect(hot[12]).toBeGreaterThan(cold[12] + 150)
    expect(hot[0]).toBeLessThan(cold[0] + 60)
  })

  it('停止加热后整体向室温回落', () => {
    const e = new Engine()
    e.setPressure(0)
    const t0 = measure(e.glass).avgTemp
    settle(e, 300)
    expect(measure(e.glass).avgTemp).toBeLessThan(t0)
  })
})

describe('吹管工具', () => {
  it('只在热区膨胀并拉薄壁', () => {
    const g = createGlass()
    const before = g.stations[12].r
    const tBefore = g.stations[12].thickness
    for (let i = 0; i < 120; i++) {
      stepGlass(g, input('flame', 0.45, 1))
      stepGlass(g, input('blow', 0.45, 1, { blowPressure: 1 }))
    }
    const after = g.stations[12]
    expect(after.r).toBeGreaterThan(before * 1.15)
    expect(after.thickness).toBeLessThan(tBefore * 0.9)
  })

  it('冷玻璃吹不动', () => {
    const g = createGlass(25, 40)
    const before = g.stations[12].r
    for (let i = 0; i < 120; i++) stepGlass(g, input('blow', 0.48, 1))
    expect(g.stations[12].r).toBeCloseTo(before, 2)
  })
})

describe('拉制工具', () => {
  it('热区收窄并让整件伸长', () => {
    const g = createGlass()
    const e0 = g.elongation
    for (let i = 0; i < 150; i++) {
      stepGlass(g, input('flame', 0.72, 1, { temperature: 1100 }))
      stepGlass(g, input('pull', 0.72, 1, { pullForce: 1 }))
    }
    expect(g.elongation).toBeGreaterThan(e0 + 0.05)
  })

  it('对冷玻璃硬拉会累积应力', () => {
    const g = createGlass(25, 80)
    for (let i = 0; i < 120; i++) stepGlass(g, input('pull', 0.5, 1, { pullForce: 1 }))
    expect(Math.max(...g.stations.map((s) => s.stress))).toBeGreaterThan(20)
  })
})

describe('炭铲', () => {
  it('压灭气泡并小幅增厚', () => {
    const g = createGlass()
    g.stations[12].bubbles = 0.8
    for (let i = 0; i < 120; i++) stepGlass(g, input('marver', 0.48, 1))
    expect(g.stations[12].bubbles).toBeLessThan(0.5)
  })
})

describe('淬火与裂纹', () => {
  it('把炽热玻璃在脆裂温区骤冷会产生应力甚至裂纹', () => {
    const g = createGlass()
    // 先保持整体灼热
    for (let i = 0; i < 30; i++) stepGlass(g, input('flame', 0.5, 1, { temperature: 1150 }))
    // 强风冷定点淬火
    for (let i = 0; i < 600; i++) stepGlass(g, input('cool', 0.5, 1))
    const m = measure(g)
    expect(m.maxStress + m.maxCracks * 100).toBeGreaterThan(30)
  })

  it('缓慢冷却（不动工具、低旋转）不产生裂纹', () => {
    const g = createGlass()
    for (let i = 0; i < 2400; i++) stepGlass(g, { ...input('cool', 0.5, 0), params: DEFAULT_PARAMS })
    expect(measure(g).maxCracks).toBe(0)
  })
})

describe('快照序列化', () => {
  it('toJSON / fromJSON 往返不丢状态', () => {
    const e = new Engine()
    settle(e, 45)
    const json = toGlassJSON(e.glass)
    const restored = fromGlassJSON(json)
    expect(restored.stations.length).toBe(e.glass.stations.length)
    restored.stations.forEach((s, i) => {
      expect(s.r).toBeCloseTo(e.glass.stations[i].r, 5)
      expect(s.temp).toBeCloseTo(e.glass.stations[i].temp, 5)
      expect(s.cracks).toBeCloseTo(e.glass.stations[i].cracks, 5)
    })
  })
})

describe('轨迹录制与回放', () => {
  it('回放同一轨迹逐帧复现最终器形（确定性）', () => {
    const e = new Engine()
    const script: Array<[FrameInput['tool'], number]> = [
      ['flame', 0.45],
      ['blow', 0.45],
      ['pull', 0.75],
      ['flame', 0.3],
      ['blow', 0.3],
      ['marver', 0.5]
    ]
    for (let f = 0; f < 600; f++) {
      const [tool, y] = script[Math.floor(f / 100) % script.length]
      e.setTool(tool)
      e.setPointer(0, y)
      e.setPressure(0.9)
      e.tick()
    }
    const traj = e.traj.slice()
    const finalJSON = toGlassJSON(e.glass)

    const e2 = new Engine()
    e2.startReplay(traj)
    for (let i = 0; i < traj.length * 2 && !e2.replayAtEnd; i++) e2.tick()
    expect(e2.replayAtEnd).toBe(true)
    expect(toGlassJSON(e2.glass)).toEqual(finalJSON)
  })
})

describe('完整制瓶流程', () => {
  it('加热-鼓腹-收颈-开口可以达到花瓶判定', () => {
    const e = new Engine()
    // 1) 整体保温
    e.setTool('flame')
    e.setParams({ temperature: 1100 })
    e.setPressure(0.9)
    for (let f = 0; f < 150; f++) {
      e.setPointer(0, 0.3 + 0.4 * Math.sin(f / 20))
      e.tick()
    }
    // 2) 下腹吹鼓
    e.setTool('blow')
    e.setParams({ blowPressure: 1 })
    for (let f = 0; f < 260; f++) {
      e.setPointer(0, 0.28 + 0.08 * Math.sin(f / 25))
      e.tick()
    }
    // 3) 肩部加热后拉制收颈
    e.setTool('flame')
    e.setParams({ temperature: 1100 })
    for (let f = 0; f < 120; f++) {
      e.setPointer(0, 0.72)
      e.tick()
    }
    e.setTool('pull')
    e.setParams({ pullForce: 1 })
    for (let f = 0; f < 260; f++) {
      e.setPointer(0, 0.74)
      e.tick()
    }
    // 4) 口沿补热再吹开
    e.setTool('flame')
    for (let f = 0; f < 120; f++) {
      e.setPointer(0, 0.92)
      e.tick()
    }
    e.setTool('blow')
    for (let f = 0; f < 200; f++) {
      e.setPointer(0, 0.95)
      e.tick()
    }
    const m = measure(e.glass)
    expect(m.maxCracks).toBeLessThan(0.4)
    expect(m.isVase).toBe(true)
  })
})
