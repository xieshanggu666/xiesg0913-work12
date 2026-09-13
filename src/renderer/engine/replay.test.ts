import { describe, expect, it } from 'vitest'
import { Engine } from './engine'
import { createGlass, toGlassJSON } from './geometry'
import type { FrameInput } from '@shared/types'

/** 录一段覆盖全部工具头的轨迹（与回放确定性测试同款脚本） */
function recordScripted(engine: Engine, frames = 600): void {
  const script: Array<[FrameInput['tool'], number]> = [
    ['flame', 0.45],
    ['blow', 0.45],
    ['pull', 0.75],
    ['flame', 0.3],
    ['blow', 0.3],
    ['marver', 0.5]
  ]
  for (let f = 0; f < frames; f++) {
    const [tool, y] = script[Math.floor(f / 100) % script.length]
    engine.setTool(tool)
    engine.setPointer(0, y)
    engine.setPressure(0.9)
    engine.tick()
  }
}

/** 顺序播到末帧（带迭代上限：回放意外暂停时快速失败，而不是死循环） */
function playToEnd(e: Engine): void {
  for (let i = 0; i < e.replayLength * 4 + 10 && !e.replayAtEnd; i++) e.tick()
  expect(e.replayAtEnd).toBe(true)
}

describe('回放时间轴', () => {
  it('拖动定位：任意帧的玻璃状态与顺序播放到该帧一致', () => {
    const e = new Engine()
    recordScripted(e, 400)
    const frames = e.traj.slice()

    // 参考：顺序播放，记录若干帧位置的玻璃状态
    const probes = [0, 50, 137, 399, 400]
    const snapshots = new Map<number, string>([[0, toGlassJSON(createGlass())]])
    const ref = new Engine()
    ref.startReplay(frames)
    while (!ref.replayAtEnd) {
      ref.tick()
      if (probes.includes(ref.replayFrame)) snapshots.set(ref.replayFrame, toGlassJSON(ref.glass))
    }
    expect(snapshots.size).toBe(probes.length)

    // 乱序拖动（含回退、到末帧、回料泡），定位结果必须确定
    const e2 = new Engine()
    e2.startReplay(frames)
    for (const p of [137, 50, 400, 0, 399, 137]) {
      e2.seekReplay(p)
      expect(e2.replayFrame).toBe(p)
      expect(toGlassJSON(e2.glass)).toBe(snapshots.get(p))
    }
  })

  it('暂停时 tick 不推进，继续后按原速播放', () => {
    const e = new Engine()
    recordScripted(e, 60)
    e.startReplay(e.traj.slice())
    e.tick()
    e.tick()
    e.pauseReplay()
    const idx = e.replayFrame
    const json = toGlassJSON(e.glass)
    e.tick()
    e.tick()
    expect(e.replayFrame).toBe(idx)
    expect(toGlassJSON(e.glass)).toBe(json)
    e.resumeReplay()
    e.tick()
    expect(e.replayFrame).toBe(idx + 1)
  })

  it('前后单帧步进并自动暂停，越界钳制', () => {
    const e = new Engine()
    recordScripted(e, 60)
    e.startReplay(e.traj.slice())
    e.seekReplay(10)
    e.stepReplay(1)
    expect(e.replayFrame).toBe(11)
    expect(e.replayPaused).toBe(true)
    e.stepReplay(-1)
    expect(e.replayFrame).toBe(10)
    e.stepReplay(-100)
    expect(e.replayFrame).toBe(0)
    e.stepReplay(999)
    expect(e.replayFrame).toBe(e.replayLength)
    expect(e.replayPaused).toBe(true)
  })

  it('播放速度倍率：2× 每步长两帧，0.5× 两步长一帧', () => {
    const e = new Engine()
    recordScripted(e, 60)
    e.startReplay(e.traj.slice())
    e.setReplaySpeed(2)
    e.tick()
    expect(e.replayFrame).toBe(2)
    e.setReplaySpeed(0.5)
    e.tick()
    expect(e.replayFrame).toBe(2)
    e.tick()
    expect(e.replayFrame).toBe(3)
    // 非法速度不改变当前倍率
    e.setReplaySpeed(NaN)
    expect(e.replaySpeed).toBe(0.5)
  })

  it('播到末帧停在末帧不退出回放，可拖回；末帧再播放从头开始', () => {
    const e = new Engine()
    recordScripted(e, 30)
    const frames = e.traj.slice()
    const finalJSON = toGlassJSON(e.glass)

    let ended = 0
    const e2 = new Engine()
    e2.onReplayEnd = () => ended++
    e2.startReplay(frames)
    playToEnd(e2)
    expect(ended).toBe(1)
    // 停在末帧保持回放态，器形与顺序播放一致
    expect(e2.isReplaying).toBe(true)
    expect(e2.replayPaused).toBe(true)
    expect(toGlassJSON(e2.glass)).toBe(finalJSON)

    // 拖回中间继续播放
    e2.seekReplay(5)
    expect(e2.replayFrame).toBe(5)
    e2.resumeReplay()
    e2.tick()
    expect(e2.replayFrame).toBe(6)

    // 拖到末帧不触发完成回调；末帧再播放 = 从头再播
    e2.seekReplay(frames.length)
    expect(e2.replayPaused).toBe(true)
    expect(ended).toBe(1)
    e2.resumeReplay()
    expect(e2.replayFrame).toBe(0)
    expect(e2.replayPaused).toBe(false)
  })

  it('拖动定位不改变轨迹内容', () => {
    const e = new Engine()
    recordScripted(e, 120)
    const frames = e.traj.slice()
    const before = JSON.stringify(frames)
    const e2 = new Engine()
    e2.startReplay(frames)
    e2.seekReplay(60)
    e2.stepReplay(-5)
    e2.seekReplay(0)
    // 暂停中拖动定位保持暂停，手动继续后再播到末帧
    expect(e2.replayPaused).toBe(true)
    e2.resumeReplay()
    playToEnd(e2)
    expect(JSON.stringify(frames)).toBe(before)
  })
})
