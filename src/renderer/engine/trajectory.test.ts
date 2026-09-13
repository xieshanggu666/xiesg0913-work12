import { describe, expect, it } from 'vitest'
import { Engine } from './engine'
import { toGlassJSON } from './geometry'
import {
  TRAJ_FILE_KIND,
  TRAJ_FILE_VERSION,
  TrajectoryParseError,
  parseTrajectory,
  serializeTrajectory
} from './trajectory'
import type { FrameInput, TrajFrame } from '@shared/types'

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

function validFile(frames: TrajFrame[]): string {
  return JSON.stringify({ kind: TRAJ_FILE_KIND, version: TRAJ_FILE_VERSION, frames })
}

describe('轨迹文件导出 / 导入', () => {
  it('序列化 → 解析往返不丢帧', () => {
    const e = new Engine()
    recordScripted(e)
    const frames = parseTrajectory(serializeTrajectory(e.traj))
    expect(frames.length).toBe(e.traj.length)
    expect(frames).toEqual(e.traj)
  })

  it('导入的轨迹从料泡开始回放，最终器形与原轨迹一致', () => {
    const e = new Engine()
    recordScripted(e)
    const finalJSON = toGlassJSON(e.glass)
    const fileText = serializeTrajectory(e.traj)

    // 模拟导入：解析文件 → 载入新引擎 → 从料泡逐帧复现
    const frames = parseTrajectory(fileText)
    const e2 = new Engine()
    e2.loadTrajectory(frames)
    expect(e2.isReplaying).toBe(true)
    for (let i = 0; i < frames.length * 2 && !e2.replayAtEnd; i++) e2.tick()
    expect(e2.replayAtEnd).toBe(true)
    expect(toGlassJSON(e2.glass)).toEqual(finalJSON)
    // 导入的轨迹保留为当前轨迹，可再次回放 / 导出
    expect(e2.traj.length).toBe(frames.length)
  })

  it('拒绝非 JSON 文本', () => {
    expect(() => parseTrajectory('这不是 JSON {{{')).toThrowError(/有效的 JSON/)
    expect(() => parseTrajectory('')).toThrowError(TrajectoryParseError)
  })

  it('拒绝被截断的文件', () => {
    const e = new Engine()
    recordScripted(e, 60)
    const json = serializeTrajectory(e.traj)
    expect(() => parseTrajectory(json.slice(0, json.length - 20))).toThrowError(/有效的 JSON/)
  })

  it('拒绝缺少 kind 标记的对象', () => {
    expect(() => parseTrajectory('{"frames":[1]}')).toThrowError(/不是琉璃工房的轨迹文件/)
    expect(() => parseTrajectory('[1,2,3]')).toThrowError(/不是轨迹对象|不是琉璃工房的轨迹文件/)
  })

  it('拒绝高于当前支持的版本', () => {
    const text = JSON.stringify({
      kind: TRAJ_FILE_KIND,
      version: TRAJ_FILE_VERSION + 1,
      frames: [{}]
    })
    expect(() => parseTrajectory(text)).toThrowError(/版本.*升级应用/)
  })

  it('拒绝缺失或空的帧数据', () => {
    expect(() =>
      parseTrajectory(JSON.stringify({ kind: TRAJ_FILE_KIND, version: TRAJ_FILE_VERSION }))
    ).toThrowError(/缺少帧数据/)
    expect(() => parseTrajectory(validFile([]))).toThrowError(/不含任何帧/)
  })

  it('指出损坏帧的位置与原因', () => {
    const e = new Engine()
    recordScripted(e, 10)
    const good = e.traj

    // 缺 dt
    const noDt = JSON.parse(validFile(good)) as { frames: Array<Record<string, unknown>> }
    delete noDt.frames[3].dt
    expect(() => parseTrajectory(JSON.stringify(noDt))).toThrowError(/第 4 帧.*dt/)

    // 非法工具名
    const badTool = JSON.parse(validFile(good)) as {
      frames: Array<{ input: { tool: string } }>
    }
    badTool.frames[0].input.tool = 'hammer'
    expect(() => parseTrajectory(JSON.stringify(badTool))).toThrowError(/第 1 帧.*未知工具/)

    // 参数缺字段
    const badParams = JSON.parse(validFile(good)) as {
      frames: Array<{ input: { params: Record<string, unknown> } }>
    }
    delete badParams.frames[2].input.params.spin
    expect(() => parseTrajectory(JSON.stringify(badParams))).toThrowError(/第 3 帧.*spin/)
  })

  it('拒绝超出取值范围的数值', () => {
    const e = new Engine()
    recordScripted(e, 10)
    const good = e.traj

    const mutate = (fn: (frames: TrajFrame[]) => void): string => {
      const file = JSON.parse(validFile(good)) as { frames: TrajFrame[] }
      fn(file.frames)
      return JSON.stringify(file)
    }

    // 火焰温度超出旋钮范围
    expect(() =>
      parseTrajectory(mutate((f) => { f[0].input.params.temperature = 9999 }))
    ).toThrowError(/第 1 帧.*temperature.*超出范围/)
    // 旋转速度为负
    expect(() =>
      parseTrajectory(mutate((f) => { f[1].input.params.spin = -5 }))
    ).toThrowError(/第 2 帧.*spin.*超出范围/)
    // 拉伸力度 > 1
    expect(() =>
      parseTrajectory(mutate((f) => { f[0].input.params.pullForce = 2 }))
    ).toThrowError(/第 1 帧.*pullForce.*超出范围/)
    // 按压强度 > 1
    expect(() =>
      parseTrajectory(mutate((f) => { f[0].input.pressure = 1.5 }))
    ).toThrowError(/第 1 帧.*pressure.*超出范围/)
    // 指针位置越界
    expect(() =>
      parseTrajectory(mutate((f) => { f[0].input.y = 2 }))
    ).toThrowError(/第 1 帧.*y.*超出范围/)
    expect(() =>
      parseTrajectory(mutate((f) => { f[0].input.x = -3 }))
    ).toThrowError(/第 1 帧.*x.*超出范围/)
    // 步长过大
    expect(() =>
      parseTrajectory(mutate((f) => { f[0].dt = 100 }))
    ).toThrowError(/第 1 帧.*dt.*超出范围/)
  })

  it('接受边界值（区间端点不误判）', () => {
    const lo: TrajFrame = {
      dt: 1 / 30,
      input: {
        tool: 'flame',
        x: -1,
        y: 0,
        pressure: 0,
        params: { temperature: 400, spin: 0, pullForce: 0, blowPressure: 0 }
      }
    }
    const hi: TrajFrame = {
      dt: 1 / 30,
      input: {
        tool: 'blow',
        x: 1,
        y: 1,
        pressure: 1,
        params: { temperature: 1200, spin: 120, pullForce: 1, blowPressure: 1 }
      }
    }
    const frames = parseTrajectory(validFile([lo, hi]))
    expect(frames).toEqual([lo, hi])
  })
})
