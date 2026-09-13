import { describe, expect, it } from 'vitest'
import {
  ANN_FILE_KIND,
  ANN_FILE_VERSION,
  MAX_ANNOTATION_TEXT,
  addFrameAnnotation,
  annotationsAtFrame,
  parseAnnotations,
  removeFrameAnnotation,
  serializeAnnotations
} from './annotations'
import { Engine } from './engine'
import { toGlassJSON } from './geometry'
import { parseTrajectory, serializeTrajectory } from './trajectory'
import type { FrameInput } from '@shared/types'

function recordScripted(engine: Engine, frames = 120): void {
  const script: Array<[FrameInput['tool'], number]> = [
    ['flame', 0.45],
    ['blow', 0.45],
    ['pull', 0.75]
  ]
  for (let f = 0; f < frames; f++) {
    const [tool, y] = script[Math.floor(f / 40) % script.length]
    engine.setTool(tool)
    engine.setPointer(0, y)
    engine.setPressure(0.9)
    engine.tick()
  }
}

describe('帧标注模型', () => {
  it('添加按帧号排序，删除按 id 移除，同帧可多条', () => {
    let list = addFrameAnnotation([], 30, '收颈')
    list = addFrameAnnotation(list, 10, '鼓腹')
    list = addFrameAnnotation(list, 30, '再补一刀')
    expect(list.map((a) => a.frame)).toEqual([10, 30, 30])
    expect(annotationsAtFrame(list, 30)).toHaveLength(2)
    expect(annotationsAtFrame(list, 10)).toHaveLength(1)

    list = removeFrameAnnotation(list, list[1].id)
    expect(annotationsAtFrame(list, 30)).toHaveLength(1)
    expect(annotationsAtFrame(list, 30)[0].text).toBe('再补一刀')
    // 删除后新标注不复用旧 id
    const next = addFrameAnnotation(list, 40, '开口')
    expect(next[next.length - 1].id).toBe(4)
  })

  it('序列化 → 解析往返：按帧号排序、id 重新编号', () => {
    let list = addFrameAnnotation([], 5, '开口')
    list = addFrameAnnotation(list, 2, '鼓腹完成')
    const { frameCount, annotations } = parseAnnotations(serializeAnnotations(list, 100))
    expect(frameCount).toBe(100)
    expect(annotations.map((a) => [a.frame, a.text])).toEqual([
      [2, '鼓腹完成'],
      [5, '开口']
    ])
    expect(annotations.map((a) => a.id)).toEqual([1, 2])
  })

  it('空标注列表的文件合法（没有标注也能导出 / 导入）', () => {
    const { frameCount, annotations } = parseAnnotations(serializeAnnotations([], 50))
    expect(frameCount).toBe(50)
    expect(annotations).toEqual([])
  })

  it('拒绝损坏文件并给出中文原因', () => {
    expect(() => parseAnnotations('不是 JSON {{{')).toThrowError(/有效的 JSON/)
    expect(() => parseAnnotations('{"annotations":[]}')).toThrowError(/不是琉璃工房的标注文件/)
    expect(() => parseAnnotations('[1,2,3]')).toThrowError(/不是标注对象|不是琉璃工房的标注文件/)
    expect(() =>
      parseAnnotations(
        JSON.stringify({
          kind: ANN_FILE_KIND,
          version: ANN_FILE_VERSION + 1,
          frameCount: 1,
          annotations: []
        })
      )
    ).toThrowError(/版本.*升级应用/)

    const base = { kind: ANN_FILE_KIND, version: ANN_FILE_VERSION, frameCount: 10 }
    expect(() =>
      parseAnnotations(JSON.stringify({ kind: ANN_FILE_KIND, version: 1, annotations: [] }))
    ).toThrowError(/frameCount/)
    expect(() =>
      parseAnnotations(JSON.stringify({ ...base, frameCount: -3 }))
    ).toThrowError(/frameCount/)
    expect(() => parseAnnotations(JSON.stringify(base))).toThrowError(/annotations/)
    expect(() =>
      parseAnnotations(JSON.stringify({ ...base, annotations: [{ frame: -1, text: 'x' }] }))
    ).toThrowError(/第 1 条标注.*帧号/)
    expect(() =>
      parseAnnotations(JSON.stringify({ ...base, annotations: [{ frame: 1.5, text: 'x' }] }))
    ).toThrowError(/第 1 条标注.*帧号/)
    expect(() =>
      parseAnnotations(JSON.stringify({ ...base, annotations: [{ frame: 0, text: '   ' }] }))
    ).toThrowError(/第 1 条标注.*为空/)
    expect(() =>
      parseAnnotations(
        JSON.stringify({ ...base, annotations: [{ frame: 0, text: 'x'.repeat(MAX_ANNOTATION_TEXT + 1) }] })
      )
    ).toThrowError(/第 1 条标注.*超过/)
  })
})

describe('标注与轨迹文件分离', () => {
  it('添加 / 删除 / 导出标注不改变轨迹内容', () => {
    const e = new Engine()
    recordScripted(e)
    const before = serializeTrajectory(e.traj)
    let anns = addFrameAnnotation([], 10, '鼓腹')
    anns = addFrameAnnotation(anns, 20, '收颈')
    serializeAnnotations(anns, e.traj.length)
    anns = removeFrameAnnotation(anns, anns[0].id)
    serializeAnnotations(anns, e.traj.length)
    expect(serializeTrajectory(e.traj)).toBe(before)
  })

  it('旧版轨迹文件（无标注字段）正常导入回放，标注默认为空', () => {
    const e = new Engine()
    recordScripted(e)
    const finalJSON = toGlassJSON(e.glass)
    // 旧版文件：只有 kind / version / frames，没有任何标注字段
    const oldFile = JSON.stringify({ kind: 'glass-forge-trajectory', version: 1, frames: e.traj })
    const frames = parseTrajectory(oldFile)

    const e2 = new Engine()
    e2.loadTrajectory(frames)
    for (let i = 0; i < frames.length * 2 && !e2.replayAtEnd; i++) e2.tick()
    expect(e2.replayAtEnd).toBe(true)
    expect(toGlassJSON(e2.glass)).toBe(finalJSON)
    // 回放全程不需要任何标注数据
    expect(annotationsAtFrame([], 0)).toEqual([])
  })

  it('标注文件与轨迹文件 kind 不同，互不混用', () => {
    const e = new Engine()
    recordScripted(e, 10)
    // 轨迹文件不能当标注文件导入
    expect(() => parseAnnotations(serializeTrajectory(e.traj))).toThrowError(
      /不是琉璃工房的标注文件/
    )
    // 标注文件也不能当轨迹文件导入
    expect(() => parseTrajectory(serializeAnnotations([], e.traj.length))).toThrowError(
      /不是琉璃工房的轨迹文件/
    )
  })
})
