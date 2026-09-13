import { describe, expect, it } from 'vitest'
import type { TrajFrame } from '@shared/types'
import { Engine, type GlassMetrics } from './engine'
import {
  ExperimentError,
  EXPERIMENT_PAGE_SIZE,
  PARAM_META,
  armStatus,
  buildExperimentCondition,
  buildVariantFrames,
  computeMetricDeltas,
  DEFAULT_EXPERIMENT_FILTER,
  filterExperiments,
  formatDelta,
  isDefaultExperimentFilter,
  paginateExperiments,
  parseExperimentCondition,
  parseExperimentOutcome,
  readBaselineValues,
  runExperiment,
  runFrames,
  serializeExperimentCondition,
  serializeExperimentOutcome,
  statusKeyOfMetrics,
  type ExperimentFilterable,
  type ExperimentDraft
} from './experiment'

/** 录制一段包含全部工具头、参数随帧变化的轨迹 */
function recordTrajectory(frames = 240): TrajFrame[] {
  const e = new Engine()
  const tools = ['flame', 'blow', 'pull', 'marver', 'cool'] as const
  for (let i = 0; i < frames; i++) {
    e.setTool(tools[i % tools.length])
    e.setPointer(0, 0.3 + (i % 7) * 0.06)
    e.setPressure(i % 5 === 0 ? 0 : 0.85)
    // 旋钮逐帧变化：保证“只覆盖一项旋钮”可被检验
    e.setParams({
      temperature: 700 + (i % 6) * 80,
      spin: 20 + (i % 4) * 25,
      pullForce: ((i % 11) / 10) * 0.8,
      blowPressure: ((i % 9) / 8) * 0.7
    })
    e.tick()
  }
  return e.traj.slice()
}

function draft(over: Partial<ExperimentDraft> = {}): ExperimentDraft {
  return { param: 'temperature', value: 900, fromFrame: 30, toFrame: 90, ...over }
}

describe('工艺实验：方案构建与输入隔离', () => {
  it('实验方案逐帧克隆基准：区间外完全一致，区间内仅一项旋钮变化', () => {
    const frames = recordTrajectory()
    const cond = buildExperimentCondition(frames, draft())
    const variant = buildVariantFrames(frames, cond)

    expect(variant).toHaveLength(frames.length)
    for (let i = 0; i < frames.length; i++) {
      if (i >= cond.fromFrame && i < cond.toFrame) {
        const v = variant[i]
        const b = frames[i]
        // dt / 工具头 / 指针 / 按压保持一致
        expect(v.dt).toBe(b.dt)
        expect(v.input.tool).toBe(b.input.tool)
        expect(v.input.x).toBe(b.input.x)
        expect(v.input.y).toBe(b.input.y)
        expect(v.input.pressure).toBe(b.input.pressure)
        // 只有目标旋钮被覆盖
        expect(v.input.params.temperature).toBe(cond.value)
        expect(v.input.params.spin).toBe(b.input.params.spin)
        expect(v.input.params.pullForce).toBe(b.input.params.pullForce)
        expect(v.input.params.blowPressure).toBe(b.input.params.blowPressure)
      } else {
        // 区间外：与基准是同一帧对象（纯复制，未做任何改写）
        expect(variant[i]).toBe(frames[i])
      }
    }
  })

  it('不修改基准轨迹本身', () => {
    const frames = recordTrajectory()
    const before = JSON.stringify(frames)
    const cond = buildExperimentCondition(frames, draft())
    runExperiment(frames, cond)
    expect(JSON.stringify(frames)).toBe(before)
  })

  it('基准取值逐帧读出', () => {
    const frames = recordTrajectory()
    const values = readBaselineValues(frames, 'spin', 10, 14)
    expect(values).toEqual(frames.slice(10, 14).map((f) => f.input.params.spin))
  })

  it('实时预览对小数 / 越界帧边界安全（取整并钳制，不抛异常）', () => {
    const frames = recordTrajectory()
    // 设置面板会在输入过程中直接读到小数 / 负 / 超界边界
    expect(readBaselineValues(frames, 'spin', 10.9, 14.2)).toEqual(
      readBaselineValues(frames, 'spin', 10, 14)
    )
    expect(readBaselineValues(frames, 'spin', -5, 3)).toEqual(
      readBaselineValues(frames, 'spin', 0, 3)
    )
    expect(readBaselineValues(frames, 'spin', 238, 999)).toEqual(
      readBaselineValues(frames, 'spin', 238, 240)
    )
    // 空 / 倒置区间返回空数组，交给汇总展示“—”，而不是读到 undefined 帧
    expect(readBaselineValues(frames, 'spin', 10.5, 10.9)).toEqual([])
  })

  it('四个旋钮参数的元数据区间与滑块一致', () => {
    expect(PARAM_META.temperature.min).toBe(400)
    expect(PARAM_META.temperature.max).toBe(1200)
    expect(PARAM_META.spin.max).toBe(120)
    expect(PARAM_META.pullForce.max).toBe(1)
    expect(PARAM_META.blowPressure.max).toBe(1)
  })
})

describe('工艺实验：条件校验', () => {
  it('轨迹太短被拒绝', () => {
    const frames = recordTrajectory().slice(0, 1)
    expect(() => buildExperimentCondition(frames, draft())).toThrow(ExperimentError)
    expect(() => buildExperimentCondition([], draft())).toThrow(/至少需要 2 帧/)
  })

  it('空区间 / 越界区间被拒绝', () => {
    const frames = recordTrajectory()
    expect(() => buildExperimentCondition(frames, draft({ fromFrame: 100, toFrame: 100 }))).toThrow(
      /帧区间无效/
    )
    expect(() => buildExperimentCondition(frames, draft({ fromFrame: -1, toFrame: 10 }))).toThrow(
      /帧区间无效/
    )
    expect(() => buildExperimentCondition(frames, draft({ fromFrame: 0, toFrame: 999 }))).toThrow(
      /帧区间无效/
    )
    expect(() => buildExperimentCondition(frames, draft({ fromFrame: 120, toFrame: 60 }))).toThrow(
      /帧区间无效/
    )
  })

  it('实验值超出旋钮范围被拒绝', () => {
    const frames = recordTrajectory()
    expect(() => buildExperimentCondition(frames, draft({ param: 'spin', value: 200 }))).toThrow(
      /超出范围/
    )
    expect(() => buildExperimentCondition(frames, draft({ param: 'blowPressure', value: -0.1 }))).toThrow(
      /超出范围/
    )
    expect(() =>
      buildExperimentCondition(frames, draft({ param: 'temperature', value: NaN }))
    ).toThrow(/实验值无效/)
  })

  it('修改整段轨迹（0 到末帧）合法', () => {
    const frames = recordTrajectory(30)
    const cond = buildExperimentCondition(frames, draft({ fromFrame: 0, toFrame: 30 }))
    expect(cond.baselineValues).toHaveLength(30)
  })

  it('小数帧区间按取整后区间执行，与对应的整数区间结果一致', () => {
    const frames = recordTrajectory()
    const condFloat = buildExperimentCondition(
      frames,
      draft({ param: 'spin', value: 100, fromFrame: 10.9, toFrame: 60.2 })
    )
    expect(condFloat.fromFrame).toBe(10)
    expect(condFloat.toFrame).toBe(60)
    const condInt = buildExperimentCondition(
      frames,
      draft({ param: 'spin', value: 100, fromFrame: 10, toFrame: 60 })
    )
    expect(runExperiment(frames, condFloat)).toEqual(runExperiment(frames, condInt))
  })
})

describe('工艺实验：双臂运行与确定性', () => {
  it('基准臂结果与直接离线回放基准轨迹一致', () => {
    const frames = recordTrajectory()
    const cond = buildExperimentCondition(frames, draft())
    const outcome = runExperiment(frames, cond)
    const direct = runFrames(frames)
    expect(outcome.baseline.metrics).toEqual(direct.metrics)
  })

  it('实验值与区间取值完全相同时，所有指标差值为 0', () => {
    // 录一条全轨迹旋钮恒定的轨迹：实验值与基准相同时双臂必须逐帧一致
    const e = new Engine()
    for (let i = 0; i < 120; i++) {
      e.setTool('flame')
      e.setPointer(0, 0.5)
      e.setPressure(0.8)
      e.setParams({ temperature: 950, spin: 60, pullForce: 0.5, blowPressure: 0.5 })
      e.tick()
    }
    const flat = e.traj.slice()
    const cond = buildExperimentCondition(flat, {
      param: 'temperature',
      value: 950,
      fromFrame: 10,
      toFrame: 80
    })
    const outcome = runExperiment(flat, cond)
    for (const d of computeMetricDeltas(outcome.baseline.metrics, outcome.variant.metrics)) {
      expect(Math.abs(d.delta)).toBeLessThan(1e-12)
    }
    expect(outcome.ruinedChanged).toBe(false)
  })

  it('重复运行结果完全一致（确定性）', () => {
    const frames = recordTrajectory()
    const cond = buildExperimentCondition(frames, draft({ param: 'spin', value: 110 }))
    const a = runExperiment(frames, cond)
    const b = runExperiment(frames, cond)
    expect(JSON.stringify(a.variant)).toBe(JSON.stringify(b.variant))
  })

  it('不同旋钮参数产生可检测的指标差异', () => {
    // 每个旋钮配一段让它真正起作用的脚本（火焰帧够多 / 高温下吹制 / 高温下拉伸）
    const scripted = (fn: (e: Engine, i: number) => void, frames = 300): TrajFrame[] => {
      const e = new Engine()
      for (let i = 0; i < frames; i++) {
        fn(e, i)
        e.tick()
      }
      return e.traj.slice()
    }
    const target: Array<{ frames: TrajFrame[]; change: ExperimentDraft }> = [
      {
        frames: scripted((e) => {
          e.setTool('flame')
          e.setPointer(0, 0.5)
          e.setPressure(0.9)
          e.setParams({ temperature: 800, spin: 60, pullForce: 0.5, blowPressure: 0.5 })
        }),
        change: { param: 'temperature', value: 1200, fromFrame: 0, toFrame: 300 }
      },
      {
        frames: scripted((e, i) => {
          e.setTool(i < 150 ? 'flame' : 'blow')
          e.setPointer(0, 0.5)
          e.setPressure(0.9)
          e.setParams({ temperature: 1050, spin: 60, pullForce: 0.5, blowPressure: 0.4 })
        }),
        change: { param: 'blowPressure', value: 1, fromFrame: 0, toFrame: 300 }
      },
      {
        frames: recordTrajectory(600),
        change: { param: 'spin', value: 120, fromFrame: 0, toFrame: 600 }
      },
      {
        frames: recordTrajectory(600),
        change: { param: 'pullForce', value: 1, fromFrame: 200, toFrame: 500 }
      }
    ]
    for (const { frames, change } of target) {
      const cond = buildExperimentCondition(frames, change)
      const outcome = runExperiment(frames, cond)
      const changed = computeMetricDeltas(outcome.baseline.metrics, outcome.variant.metrics).some(
        (d) => Math.abs(d.delta) > 1e-6
      )
      expect(changed).toBe(true)
    }
  })

  it('强风冷淬火可制造报废对照，报废判定随结果展示', () => {
    // 高温保温后，在脆裂温区用强风冷硬吹；冷却旋钮实验值拉满更容易贯穿
    const e = new Engine()
    for (let i = 0; i < 300; i++) {
      e.setTool(i < 200 ? 'flame' : 'cool')
      e.setPointer(0, 0.5)
      e.setPressure(0.9)
      e.setParams({ temperature: 1100, spin: 20, pullForce: 0.2, blowPressure: 0.2 })
      e.tick()
    }
    const frames = e.traj.slice()
    // 该脚本是否报废不做硬性假设；但基准 / 实验双臂的报废状态必须与各自指标一致
    const cond = buildExperimentCondition(frames, {
      param: 'spin',
      value: 5,
      fromFrame: 180,
      toFrame: 300
    })
    const outcome = runExperiment(frames, cond)
    expect(outcome.variant.metrics.isRuined).toBe(
      armStatus(outcome.variant.metrics).tone === 'bad'
    )
    expect(outcome.ruinedChanged).toBe(
      outcome.baseline.metrics.isRuined !== outcome.variant.metrics.isRuined
    )
  })
})

describe('工艺实验：差值表与持久化往返', () => {
  it('差值 = 实验 − 基准，带符号格式化', () => {
    const frames = recordTrajectory()
    const cond = buildExperimentCondition(frames, draft({ param: 'temperature', value: 1150 }))
    const outcome = runExperiment(frames, cond)
    for (const d of computeMetricDeltas(outcome.baseline.metrics, outcome.variant.metrics)) {
      expect(d.delta).toBeCloseTo(d.variant - d.baseline, 10)
      if (Math.abs(d.delta) > 0.0005) {
        expect(formatDelta(d).startsWith(d.delta > 0 ? '+' : '−')).toBe(true)
      }
    }
  })

  it('条件 / 结果序列化后解析往返一致，损坏 JSON 抛出中文错误', () => {
    const frames = recordTrajectory()
    const cond = buildExperimentCondition(frames, draft({ param: 'pullForce', value: 0.9 }))
    const outcome = runExperiment(frames, cond)

    const cond2 = parseExperimentCondition(serializeExperimentCondition(cond))
    expect(cond2).toEqual(cond)
    const outcome2 = parseExperimentOutcome(serializeExperimentOutcome(outcome))
    expect(outcome2.variant.metrics).toEqual(outcome.variant.metrics)
    expect(outcome2.baseline.metrics).toEqual(outcome.baseline.metrics)
    expect(outcome2.ruinedChanged).toBe(outcome.ruinedChanged)

    expect(() => parseExperimentCondition('{bad json')).toThrow(/实验条件/)
    expect(() => parseExperimentOutcome('{bad json')).toThrow(/实验结果/)
    expect(() =>
      parseExperimentCondition(JSON.stringify({ ...cond, fromFrame: -5 }))
    ).toThrow(/帧区间无效/)
    expect(() =>
      parseExperimentCondition(
        JSON.stringify({ ...cond, baselineValues: [1, 2] })
      )
    ).toThrow(/基准取值/)
  })
})

describe('工艺实验：列表筛选与排序', () => {
  function metrics(over: Partial<GlassMetrics> = {}): GlassMetrics {
    return {
      avgTemp: 500,
      avgThickness: 0.1,
      avgBubbles: 0,
      maxStress: 0,
      maxCracks: 0,
      isRuined: false,
      rimRadius: 0.2,
      neckRadius: 0.15,
      bodyRadius: 0.5,
      elongation: 1.2,
      isVase: false,
      ...over
    }
  }

  function item(
    id: number,
    name: string,
    created_at: number,
    param: ExperimentFilterable['condition']['param'],
    variant: Partial<GlassMetrics>,
    conclusion = ''
  ): ExperimentFilterable {
    return {
      record: { id, name, conclusion, created_at },
      condition: { param },
      outcome: { variant: { metrics: metrics(variant) } }
    }
  }

  const vaseM = { isVase: true }
  const ruinedM = { isRuined: true }
  const formingM = {}

  // 保存时间故意打乱传入顺序，验证排序不依赖插入顺序
  const items: ExperimentFilterable[] = [
    item(3, '强风报废实验', 3000, 'blowPressure', ruinedM, '直接吹过脆裂温区'),
    item(1, '保温成型实验', 1000, 'temperature', vaseM, '高温保温后成型良好'),
    item(4, '拉伸对照', 4000, 'pullForce', formingM, ''),
    item(2, '高速旋转实验', 2000, 'spin', vaseM, '气泡更少')
  ]

  it('结果筛选键与 armStatus 的三种结论一一对应', () => {
    expect(statusKeyOfMetrics(metrics(ruinedM))).toBe('ruined')
    expect(statusKeyOfMetrics(metrics(vaseM))).toBe('vase')
    expect(statusKeyOfMetrics(metrics(formingM))).toBe('forming')
    // armStatus 的中文结论应与筛选键语义一致
    expect(armStatus(metrics(ruinedM)).status).toBe('已报废')
    expect(armStatus(metrics(vaseM)).status).toBe('已成型')
    expect(armStatus(metrics(formingM)).status).toBe('成形中')
  })

  it('默认条件不过滤，按时间倒序排列（与列表默认一致）', () => {
    const out = filterExperiments(items, DEFAULT_EXPERIMENT_FILTER)
    expect(out.map((x) => x.record.id)).toEqual([4, 3, 2, 1])
    expect(isDefaultExperimentFilter(DEFAULT_EXPERIMENT_FILTER)).toBe(true)
  })

  it('时间正序：从早到晚；同时间以 id 兜底', () => {
    const out = filterExperiments(items, { ...DEFAULT_EXPERIMENT_FILTER, timeOrder: 'asc' })
    expect(out.map((x) => x.record.id)).toEqual([1, 2, 3, 4])
    const sameTime = [
      item(2, '二', 500, 'spin', vaseM),
      item(1, '一', 500, 'spin', vaseM)
    ]
    expect(
      filterExperiments(sameTime, { ...DEFAULT_EXPERIMENT_FILTER, timeOrder: 'asc' }).map(
        (x) => x.record.id
      )
    ).toEqual([1, 2])
    expect(isDefaultExperimentFilter({ ...DEFAULT_EXPERIMENT_FILTER, timeOrder: 'asc' })).toBe(false)
  })

  it('关键词在名称与结论中不区分大小写匹配，多个词需同时命中（AND）', () => {
    const byName = filterExperiments(items, { ...DEFAULT_EXPERIMENT_FILTER, keyword: '保温' })
    expect(byName.map((x) => x.record.id)).toEqual([1])
    // 命中结论而非名称
    const byConclusion = filterExperiments(items, {
      ...DEFAULT_EXPERIMENT_FILTER,
      keyword: '气泡'
    })
    expect(byConclusion.map((x) => x.record.id)).toEqual([2])
    // 大小写不敏感
    const caseInsensitive = filterExperiments(
      [item(5, 'SPIN Trial', 5000, 'spin', vaseM)],
      { ...DEFAULT_EXPERIMENT_FILTER, keyword: 'spin' }
    )
    expect(caseInsensitive.map((x) => x.record.id)).toEqual([5])
    // 两个词分别命中名称 / 结论 → 交集
    const both = filterExperiments(items, {
      ...DEFAULT_EXPERIMENT_FILTER,
      keyword: '保温 成型'
    })
    expect(both.map((x) => x.record.id)).toEqual([1])
    // 一个词无命中 → 整体无结果
    const miss = filterExperiments(items, {
      ...DEFAULT_EXPERIMENT_FILTER,
      keyword: '保温 不存在的词'
    })
    expect(miss).toHaveLength(0)
  })

  it('按旋钮类型筛选', () => {
    const spin = filterExperiments(items, { ...DEFAULT_EXPERIMENT_FILTER, param: 'spin' })
    expect(spin.map((x) => x.record.id)).toEqual([2])
    const pull = filterExperiments(items, { ...DEFAULT_EXPERIMENT_FILTER, param: 'pullForce' })
    expect(pull.map((x) => x.record.id)).toEqual([4])
  })

  it('按实验结果“已成型 / 成形中 / 已报废”筛选', () => {
    const vases = filterExperiments(items, { ...DEFAULT_EXPERIMENT_FILTER, status: 'vase' })
    expect(vases.map((x) => x.record.id)).toEqual([2, 1])
    const forming = filterExperiments(items, { ...DEFAULT_EXPERIMENT_FILTER, status: 'forming' })
    expect(forming.map((x) => x.record.id)).toEqual([4])
    const ruined = filterExperiments(items, { ...DEFAULT_EXPERIMENT_FILTER, status: 'ruined' })
    expect(ruined.map((x) => x.record.id)).toEqual([3])
  })

  it('多个条件同时生效取交集，且筛选 / 排序不修改原数组', () => {
    const snapshot = JSON.stringify(items)
    const out = filterExperiments(items, {
      keyword: '实验',
      param: 'temperature',
      status: 'vase',
      timeOrder: 'asc'
    })
    expect(out.map((x) => x.record.id)).toEqual([1])
    // 原数组顺序 / 内容不变
    expect(JSON.stringify(items)).toBe(snapshot)
  })

  it('无匹配时返回空数组（与“尚无实验”由 UI 层依据总数区分）', () => {
    expect(filterExperiments([], DEFAULT_EXPERIMENT_FILTER)).toEqual([])
    expect(
      filterExperiments(items, { ...DEFAULT_EXPERIMENT_FILTER, keyword: '完全不存在' })
    ).toEqual([])
  })

  it('分段作用于筛选 / 排序后的结果，不改变其顺序', () => {
    const out = filterExperiments(items, DEFAULT_EXPERIMENT_FILTER) // 倒序 [4,3,2,1]
    const w = paginateExperiments(out.length, 1, 2)
    expect(out.slice(w.start, w.end).map((x) => x.record.id)).toEqual([4, 3])
    const w2 = paginateExperiments(out.length, 2, 2)
    expect(out.slice(w2.start, w2.end).map((x) => x.record.id)).toEqual([2, 1])
  })
})

describe('工艺实验：列表分段（轻量分页）', () => {
  it('默认每段 8 条', () => {
    expect(EXPERIMENT_PAGE_SIZE).toBe(8)
  })

  it('总数不足一段：只有一段，窗口覆盖全部', () => {
    expect(paginateExperiments(0, 1)).toEqual({ page: 1, pageCount: 1, start: 0, end: 0 })
    expect(paginateExperiments(3, 1)).toEqual({ page: 1, pageCount: 1, start: 0, end: 3 })
    expect(paginateExperiments(8, 1)).toEqual({ page: 1, pageCount: 1, start: 0, end: 8 })
  })

  it('超过一段：按页大小切分，末段只含剩余条数', () => {
    expect(paginateExperiments(18, 1)).toEqual({ page: 1, pageCount: 3, start: 0, end: 8 })
    expect(paginateExperiments(18, 2)).toEqual({ page: 2, pageCount: 3, start: 8, end: 16 })
    expect(paginateExperiments(18, 3)).toEqual({ page: 3, pageCount: 3, start: 16, end: 18 })
  })

  it('请求页超出末段（删除末段记录后）回退到最后一个有效段', () => {
    // 18 条时第 3 段有效；删掉 3 条变 15 条只有两段，旧的第 3 段应钳到第 2 段
    expect(paginateExperiments(15, 3)).toEqual({ page: 2, pageCount: 2, start: 8, end: 15 })
    // 整列表删空也不越界：停在首段空窗口
    expect(paginateExperiments(0, 5)).toEqual({ page: 1, pageCount: 1, start: 0, end: 0 })
  })

  it('非正 / 非有限 / 小数页码安全钳制，不抛异常', () => {
    expect(paginateExperiments(20, 0).page).toBe(1)
    expect(paginateExperiments(20, -7).page).toBe(1)
    expect(paginateExperiments(20, NaN).page).toBe(1)
    expect(paginateExperiments(20, Infinity).page).toBe(1)
    // 超出末段的有限页回退到最后一个有效段
    expect(paginateExperiments(20, 999).page).toBe(3)
    expect(paginateExperiments(20, 1.9)).toEqual({ page: 1, pageCount: 3, start: 0, end: 8 })
  })

  it('可传入自定义页大小，非法页大小按 1 处理', () => {
    expect(paginateExperiments(10, 2, 4)).toEqual({ page: 2, pageCount: 3, start: 4, end: 8 })
    expect(paginateExperiments(10, 1, 0)).toEqual({ page: 1, pageCount: 10, start: 0, end: 1 })
  })
})
