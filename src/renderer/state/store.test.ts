import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStudio } from './store'
import { Engine } from '../engine/engine'
import {
  buildExperimentCondition,
  runExperiment,
  type ExperimentCondition,
  type ExperimentOutcome
} from '../engine/experiment'
import type { TrajFrame } from '@shared/types'

/** storage.ts 的浏览器降级依赖 localStorage，node 环境下用内存 stub */
const lsData = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => lsData.get(k) ?? null,
  setItem: (k: string, v: string) => {
    lsData.set(k, String(v))
  },
  removeItem: (k: string) => {
    lsData.delete(k)
  },
  clear: () => lsData.clear()
})

function storedCount(): number {
  return (JSON.parse(lsData.get('glass-forge:snapshots') ?? '[]') as unknown[]).length
}

describe('快照删除', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    lsData.clear()
    await useStudio.getState().refreshSnapshots()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('删除立即生效：列表与存储同时移除', async () => {
    const ok = await useStudio.getState().addSnapshot('节点A', '备注', 'thumb')
    expect(ok).toBe(true)
    expect(useStudio.getState().snapshots).toHaveLength(1)
    const id = useStudio.getState().snapshots[0].record.id!

    await useStudio.getState().removeSnapshot(id)

    expect(useStudio.getState().snapshots).toHaveLength(0)
    expect(storedCount()).toBe(0)
    expect(useStudio.getState().toast).toBe('已删除快照「节点A」')
  })

  it('删除失败时保留快照并给出一致提示', async () => {
    await useStudio.getState().addSnapshot('节点A', '', 'thumb')
    const id = useStudio.getState().snapshots[0].record.id!

    // 让底层存储写入失败
    const ls = localStorage as unknown as { setItem: (k: string, v: string) => void }
    const original = ls.setItem
    ls.setItem = () => {
      throw new Error('磁盘写入失败')
    }
    try {
      await useStudio.getState().removeSnapshot(id)
    } finally {
      ls.setItem = original
    }

    expect(useStudio.getState().toast).toBe('删除快照失败：磁盘写入失败')
    expect(useStudio.getState().snapshots).toHaveLength(1)
  })
})

describe('回放时间轴与帧标注', () => {
  /** 录一段轨迹并进入回放模式 */
  function recordAndPlay(frames = 90): void {
    useStudio.getState().stopReplay()
    useStudio.getState().resetGlass()
    const e = useStudio.getState().engine
    for (let i = 0; i < frames; i++) {
      e.setTool('flame')
      e.setPointer(0, 0.5)
      e.setPressure(0.8)
      e.tick()
    }
    useStudio.getState().playReplay()
  }

  it('拖动定位 / 单帧步进 / 速度选择同步到状态', () => {
    recordAndPlay()
    expect(useStudio.getState().replaying).toBe(true)
    expect(useStudio.getState().replayPlaying).toBe(true)
    expect(useStudio.getState().replayFrameCount).toBe(90)

    useStudio.getState().seekFrame(30)
    expect(useStudio.getState().replayFrame).toBe(30)
    // 拖动定位不改变播放 / 暂停状态
    expect(useStudio.getState().replayPlaying).toBe(true)

    useStudio.getState().stepFrame(1)
    expect(useStudio.getState().replayFrame).toBe(31)
    // 单帧步进自动暂停
    expect(useStudio.getState().replayPlaying).toBe(false)

    useStudio.getState().stepFrame(-2)
    expect(useStudio.getState().replayFrame).toBe(29)

    useStudio.getState().setReplaySpeed(2)
    expect(useStudio.getState().replaySpeed).toBe(2)
    expect(useStudio.getState().engine.replaySpeed).toBe(2)

    useStudio.getState().toggleReplayPlay()
    expect(useStudio.getState().replayPlaying).toBe(true)

    useStudio.getState().stopReplay()
    expect(useStudio.getState().replaying).toBe(false)
    expect(useStudio.getState().replayFrame).toBe(0)
  })

  it('当前帧标注的添加与删除', () => {
    recordAndPlay()
    useStudio.getState().seekFrame(12)
    expect(useStudio.getState().addAnnotation('  鼓腹完成  ')).toBe(true)
    expect(useStudio.getState().addAnnotation('开始收颈')).toBe(true)
    // 空内容 / 纯空白拒绝并提示
    expect(useStudio.getState().addAnnotation('   ')).toBe(false)
    expect(useStudio.getState().toast).toBe('标注内容不能为空')

    const anns = useStudio.getState().annotations
    expect(anns).toHaveLength(2)
    expect(anns[0].frame).toBe(12)
    expect(anns[0].text).toBe('鼓腹完成')

    useStudio.getState().removeAnnotation(anns[0].id)
    expect(useStudio.getState().annotations).toHaveLength(1)
    expect(useStudio.getState().annotations[0].text).toBe('开始收颈')
  })

  it('停止回放保留标注；取新料重来清空标注', () => {
    recordAndPlay()
    useStudio.getState().seekFrame(5)
    useStudio.getState().addAnnotation('标记')
    expect(useStudio.getState().annotations).toHaveLength(1)

    // 停止回放：轨迹还在，标注保留，再次回放仍可见
    useStudio.getState().stopReplay()
    expect(useStudio.getState().annotations).toHaveLength(1)

    // 取新料重来：轨迹清空，依附帧号的标注一并失效
    useStudio.getState().resetGlass()
    expect(useStudio.getState().annotations).toHaveLength(0)
    expect(useStudio.getState().replaying).toBe(false)
  })

  it('没有轨迹时不能导入标注', async () => {
    useStudio.getState().stopReplay()
    useStudio.getState().resetGlass()
    await useStudio.getState().importAnnotations()
    expect(useStudio.getState().toast).toBe('请先录制或导入一条轨迹，再导入与它配套的标注')
  })
})

describe('工艺实验', () => {
  /** 录一段火焰轨迹并离线跑出双臂结果（纯逻辑，不经过 canvas） */
  function makeOutcome(): {
    frames: TrajFrame[]
    cond: ExperimentCondition
    outcome: ExperimentOutcome
  } {
    const e = new Engine()
    for (let i = 0; i < 120; i++) {
      e.setTool('flame')
      e.setPointer(0, 0.5)
      e.setPressure(0.8)
      e.setParams({ temperature: 900, spin: 60, pullForce: 0.5, blowPressure: 0.5 })
      e.tick()
    }
    const frames = e.traj.slice()
    const cond = buildExperimentCondition(frames, {
      param: 'temperature',
      value: 1150,
      fromFrame: 10,
      toFrame: 90
    })
    return { frames, cond, outcome: runExperiment(frames, cond) }
  }

  beforeEach(async () => {
    lsData.clear()
    await useStudio.getState().refreshExperiments()
  })

  it('保存条件、结果与结论：列表与存储同时出现', async () => {
    const { cond, outcome } = makeOutcome()
    const ok = await useStudio.getState().saveExperimentResult({
      name: '  收颈段升温实验  ',
      condition: cond,
      outcome,
      baselineThumb: 'b',
      variantThumb: 'v',
      conclusion: ' 升温后腹径变大 '
    })
    expect(ok).toBe(true)
    const list = useStudio.getState().experiments
    expect(list).toHaveLength(1)
    const meta = list[0]
    expect(meta.record.name).toBe('收颈段升温实验')
    expect(meta.record.conclusion).toBe('升温后腹径变大')
    expect(meta.condition.fromFrame).toBe(10)
    expect(meta.outcome.variant.metrics.avgTemp).toBe(outcome.variant.metrics.avgTemp)

    const stored = JSON.parse(lsData.get('glass-forge:experiments') ?? '[]') as unknown[]
    expect(stored).toHaveLength(1)
    expect(useStudio.getState().toast).toBe('已保存工艺实验「收颈段升温实验」')
  })

  it('空名称 / 超长结论被拒绝且不落库', async () => {
    const { cond, outcome } = makeOutcome()
    const ok1 = await useStudio.getState().saveExperimentResult({
      name: '   ',
      condition: cond,
      outcome,
      baselineThumb: '',
      variantThumb: '',
      conclusion: ''
    })
    expect(ok1).toBe(false)
    expect(useStudio.getState().experiments).toHaveLength(0)
    expect(useStudio.getState().toast).toBe('请填写实验名称')

    const ok2 = await useStudio.getState().saveExperimentResult({
      name: '实验',
      condition: cond,
      outcome,
      baselineThumb: '',
      variantThumb: '',
      conclusion: '结'.repeat(201)
    })
    expect(ok2).toBe(false)
    expect(useStudio.getState().experiments).toHaveLength(0)
  })

  it('更新用户结论后列表内容同步；实验条件不可经此动作改写', async () => {
    const { cond, outcome } = makeOutcome()
    await useStudio.getState().saveExperimentResult({
      name: '实验A',
      condition: cond,
      outcome,
      baselineThumb: '',
      variantThumb: '',
      conclusion: ''
    })
    const id = useStudio.getState().experiments[0].record.id!
    await useStudio.getState().saveExperimentConclusion(id, '转速提高后气泡减少')
    expect(useStudio.getState().experiments[0].record.conclusion).toBe('转速提高后气泡减少')
    expect(useStudio.getState().toast).toBe('已更新实验结论')
    // 条件 / 结果 JSON 未被触碰
    const stored = JSON.parse(lsData.get('glass-forge:experiments') ?? '[]') as Array<{
      condition_json: string
    }>
    expect(JSON.parse(stored[0].condition_json).value).toBe(1150)
  })

  it('删除实验立即生效', async () => {
    const { cond, outcome } = makeOutcome()
    await useStudio.getState().saveExperimentResult({
      name: '实验B',
      condition: cond,
      outcome,
      baselineThumb: '',
      variantThumb: '',
      conclusion: ''
    })
    const id = useStudio.getState().experiments[0].record.id!
    await useStudio.getState().removeExperiment(id)
    expect(useStudio.getState().experiments).toHaveLength(0)
    expect(JSON.parse(lsData.get('glass-forge:experiments') ?? '[]') as unknown[]).toHaveLength(0)
    expect(useStudio.getState().toast).toBe('已删除实验「实验B」')
  })

  it('存储中损坏的实验记录被跳过并计数提示', async () => {
    const { cond, outcome } = makeOutcome()
    await useStudio.getState().saveExperimentResult({
      name: '完好实验',
      condition: cond,
      outcome,
      baselineThumb: '',
      variantThumb: '',
      conclusion: ''
    })
    const raw = JSON.parse(lsData.get('glass-forge:experiments') ?? '[]') as Array<
      Record<string, unknown>
    >
    raw.push({ id: 99, name: '坏的', condition_json: '{oops', outcome_json: '{}' })
    raw.push({ id: 100, name: '也坏', condition_json: '{}', outcome_json: '{oops' })
    lsData.set('glass-forge:experiments', JSON.stringify(raw))

    await useStudio.getState().refreshExperiments()
    expect(useStudio.getState().experiments).toHaveLength(1)
    expect(useStudio.getState().experiments[0].record.name).toBe('完好实验')
    expect(useStudio.getState().toast).toContain('2 条记录数据损坏')
  })
})
