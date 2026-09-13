import type { ExperimentRecord, SimParams, TrajFrame } from '@shared/types'
import { SPIN_MAX, TEMP_FLAME_MAX, TEMP_FLAME_MIN } from './constants'
import { createGlass, type Glass } from './geometry'
import { measure, stepGlass, type GlassMetrics } from './engine'

/**
 * 工艺实验纯逻辑内核（无 DOM 依赖，可直接单测）。
 *
 * 规则：选取一条已有轨迹作为基准，复制为实验方案；只允许修改指定帧区间
 * [fromFrame, toFrame) 内的一项旋钮参数，其余输入（工具头、指针、按压、
 * 其他三个旋钮）逐帧克隆、与基准完全一致。两条方案都从同一团料泡出发，
 * 用相同的固定步长离线推进，结果天然可比、可复现。
 */

export class ExperimentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExperimentError'
  }
}

/** 实验方案（UI 草稿，未填充基准取值） */
export interface ExperimentDraft {
  param: keyof SimParams
  value: number
  fromFrame: number
  toFrame: number
}

/** 已校验的实验条件（buildExperimentCondition 的结果，可直接持久化） */
export interface ExperimentCondition {
  baselineFrames: number
  fromFrame: number
  toFrame: number
  param: keyof SimParams
  value: number
  /** 基准轨迹在修改区间内该参数的逐帧取值，供结果页对照展示 */
  baselineValues: number[]
}

/** 一次仿真的完整产出（末帧玻璃状态 + 指标；玻璃供结果页画器形缩略图） */
export interface ExperimentArm {
  glass: Glass
  metrics: GlassMetrics
}

/** 双臂对照结果 */
export interface ExperimentOutcome {
  baseline: ExperimentArm
  variant: ExperimentArm
  /** 实验方案末帧是否报废（贯穿裂纹） */
  ruinedChanged: boolean
}

/** 四项旋钮的元数据（区间与工坊滑块一致；标签 / 单位供 UI 复用） */
export interface ParamMeta {
  key: keyof SimParams
  label: string
  unit: string
  min: number
  max: number
  step: number
}

export const EXPERIMENT_PARAMS: ParamMeta[] = [
  { key: 'temperature', label: '火焰温度', unit: '℃', min: TEMP_FLAME_MIN, max: TEMP_FLAME_MAX, step: 10 },
  { key: 'spin', label: '旋转速度', unit: ' rpm', min: 0, max: SPIN_MAX, step: 1 },
  { key: 'pullForce', label: '拉伸力度', unit: '', min: 0, max: 1, step: 0.01 },
  { key: 'blowPressure', label: '吹气压力', unit: '', min: 0, max: 1, step: 0.01 }
]

export const PARAM_META: Record<keyof SimParams, ParamMeta> = Object.fromEntries(
  EXPERIMENT_PARAMS.map((m) => [m.key, m])
) as Record<keyof SimParams, ParamMeta>

const PARAM_KEYS = new Set<keyof SimParams>(EXPERIMENT_PARAMS.map((m) => m.key))

/** 一条实验至少要有两帧（与轨迹回放的最低帧数一致） */
export const MIN_EXPERIMENT_FRAMES = 2

/** 用户输入上限（实验名 / 结论），与输入框 maxLength 保持一致 */
export const MAX_EXPERIMENT_NAME = 30
export const MAX_EXPERIMENT_CONCLUSION = 200

/**
 * 读取基准轨迹在 [from, to) 区间内某旋钮的逐帧取值。
 * 供设置面板在选定区间 / 参数后展示“基准值范围”。
 * 边界取整并钳制到帧范围内：输入框允许瞬时的小数 / 越界草稿值，实时预览不得因此崩溃。
 */
export function readBaselineValues(
  frames: TrajFrame[],
  param: keyof SimParams,
  from: number,
  to: number
): number[] {
  const start = Math.max(0, Math.floor(from))
  const end = Math.min(frames.length, Math.floor(to))
  const out: number[] = []
  for (let i = start; i < end; i++) out.push(frames[i].input.params[param])
  return out
}

/** 区间内基准取值的最小 / 最大 / 平均值（结果页对照行用） */
export function summarizeBaselineValues(values: number[]): { min: number; max: number; avg: number } {
  if (values.length === 0) return { min: NaN, max: NaN, avg: NaN }
  let min = Infinity
  let max = -Infinity
  let sum = 0
  for (const v of values) {
    if (v < min) min = v
    if (v > max) max = v
    sum += v
  }
  return { min, max, avg: sum / values.length }
}

/** 把 UI 草稿 + 基准轨迹构造成已校验的实验条件；非法时抛出面向用户的中文错误 */
export function buildExperimentCondition(
  frames: TrajFrame[],
  draft: ExperimentDraft
): ExperimentCondition {
  if (!Array.isArray(frames) || frames.length < MIN_EXPERIMENT_FRAMES) {
    throw new ExperimentError('基准轨迹太短，至少需要 2 帧才能发起工艺实验')
  }
  if (!PARAM_KEYS.has(draft.param)) {
    throw new ExperimentError('请选择一项旋钮参数')
  }
  const meta = PARAM_META[draft.param]
  const value = Number(draft.value)
  if (!Number.isFinite(value)) {
    throw new ExperimentError(`实验值无效：${meta.label}`)
  }
  if (value < meta.min || value > meta.max) {
    throw new ExperimentError(`${meta.label}实验值超出范围（${meta.min} ~ ${meta.max}）`)
  }
  const n = frames.length
  const from = Math.floor(draft.fromFrame)
  const to = Math.floor(draft.toFrame)
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > n || from >= to) {
    throw new ExperimentError('帧区间无效：起始帧需在 0 到末帧之间，且区间至少包含 1 帧')
  }
  return {
    baselineFrames: n,
    fromFrame: from,
    toFrame: to,
    param: draft.param,
    value,
    baselineValues: readBaselineValues(frames, draft.param, from, to)
  }
}

/**
 * 复制实验方案轨迹：逐帧深拷贝基准帧，仅在 [from, to) 区间内覆盖指定旋钮；
 * 区间外的帧与基准严格一致，基准数组本身不被修改。
 */
export function buildVariantFrames(frames: TrajFrame[], cond: ExperimentCondition): TrajFrame[] {
  return frames.map((f, i) => {
    if (i < cond.fromFrame || i >= cond.toFrame) return f
    return {
      dt: f.dt,
      input: {
        tool: f.input.tool,
        x: f.input.x,
        y: f.input.y,
        pressure: f.input.pressure,
        params: { ...f.input.params, [cond.param]: cond.value }
      }
    }
  })
}

/** 从料泡出发顺序施加整条轨迹，返回末帧玻璃与指标（纯函数，不触碰工坊引擎） */
export function runFrames(frames: TrajFrame[]): ExperimentArm {
  const glass = createGlass()
  for (const f of frames) stepGlass(glass, f.input, f.dt)
  return { glass, metrics: measure(glass) }
}

/**
 * 运行一次工艺实验：基准方案与实验方案分别从同一团料泡离线推进，
 * 返回双臂末帧器形 / 指标与报废状态变化。
 */
export function runExperiment(
  frames: TrajFrame[],
  cond: ExperimentCondition
): ExperimentOutcome {
  if (frames.length !== cond.baselineFrames) {
    throw new ExperimentError('基准轨迹帧数与实验条件不符，无法对照')
  }
  const baseline = runFrames(frames)
  const variant = runFrames(buildVariantFrames(frames, cond))
  return {
    baseline,
    variant,
    ruinedChanged: baseline.metrics.isRuined !== variant.metrics.isRuined
  }
}

/** 指标差值行（结果对照表用） */
export interface MetricDelta {
  key: keyof GlassMetrics
  label: string
  unit: string
  baseline: number
  variant: number
  /** 实验 − 基准 */
  delta: number
  /** 配色级别：尺寸 / 温度变化为中性，裂纹 / 应力 / 气泡恶化转红、改善转绿 */
  tone: 'plain' | 'good' | 'bad'
  precision: number
}

/** 参与对照的数值指标与展示规则（成型 / 报废两个布尔量单独展示） */
export const METRIC_DELTA_SPECS: Array<{
  key: keyof GlassMetrics
  label: string
  unit: string
  precision: number
  /** 差值方向的好坏：highGood=true 时升高为改善 */
  highGood?: boolean
}> = [
  { key: 'avgTemp', label: '平均温度', unit: '℃', precision: 0 },
  { key: 'avgThickness', label: '平均壁厚', unit: '', precision: 3 },
  { key: 'elongation', label: '伸长系数', unit: '×', precision: 3 },
  { key: 'bodyRadius', label: '腹径', unit: '', precision: 3 },
  { key: 'neckRadius', label: '颈径', unit: '', precision: 3 },
  { key: 'rimRadius', label: '口径', unit: '', precision: 3 },
  { key: 'avgBubbles', label: '气泡含量', unit: '', precision: 3, highGood: false },
  { key: 'maxStress', label: '最大应力', unit: '', precision: 1, highGood: false },
  { key: 'maxCracks', label: '裂纹程度', unit: '', precision: 2, highGood: false }
]

const EPS: Partial<Record<keyof GlassMetrics, number>> = {
  avgTemp: 0.5,
  avgThickness: 0.0005,
  elongation: 0.0005,
  bodyRadius: 0.0005,
  neckRadius: 0.0005,
  rimRadius: 0.0005,
  avgBubbles: 0.0005,
  maxStress: 0.05,
  maxCracks: 0.005
}

/** 计算双臂关键指标差值；无方向的指标（尺寸 / 温度）恒为中性配色 */
export function computeMetricDeltas(baseline: GlassMetrics, variant: GlassMetrics): MetricDelta[] {
  return METRIC_DELTA_SPECS.map((spec) => {
    const b = baseline[spec.key] as number
    const v = variant[spec.key] as number
    const delta = v - b
    let tone: MetricDelta['tone'] = 'plain'
    if (spec.highGood !== undefined && Math.abs(delta) > (EPS[spec.key] ?? 0)) {
      const better = spec.highGood ? delta > 0 : delta < 0
      tone = better ? 'good' : 'bad'
    }
    return { key: spec.key, label: spec.label, unit: spec.unit, baseline: b, variant: v, delta, tone, precision: spec.precision }
  })
}

/** 差值带符号格式化（+ / −），半径类内部单位 ×100 展示为厘米口径由 UI 自行处理 */
export function formatDelta(d: MetricDelta): string {
  const v = Math.abs(d.delta) < 0.0005 ? 0 : d.delta
  const sign = v > 0 ? '+' : v < 0 ? '−' : '±'
  return `${sign}${v.toFixed(d.precision)}${d.unit}`
}

/** 实验方案末帧的一句话结论状态（与快照概述措辞一致：已报废 / 已成型 / 成形中） */
export function armStatus(m: GlassMetrics): { status: string; tone: 'good' | 'plain' | 'bad' } {
  if (m.isRuined) return { status: '已报废', tone: 'bad' }
  if (m.isVase) return { status: '已成型', tone: 'good' }
  return { status: '成形中', tone: 'plain' }
}

/* ---------- 列表筛选 / 排序（纯函数，可直接单测） ---------- */

/** 实验结果筛选键：与 armStatus 的三种结论一一对应 */
export type ExperimentStatusKey = 'vase' | 'forming' | 'ruined'

export const EXPERIMENT_STATUS_OPTIONS: ReadonlyArray<{ key: ExperimentStatusKey; label: string }> = [
  { key: 'vase', label: '已成型' },
  { key: 'forming', label: '成形中' },
  { key: 'ruined', label: '已报废' }
]

/** 由实验方案末帧指标得到结果筛选键（判定口径与 armStatus 完全一致） */
export function statusKeyOfMetrics(m: GlassMetrics): ExperimentStatusKey {
  if (m.isRuined) return 'ruined'
  if (m.isVase) return 'vase'
  return 'forming'
}

/** 实验列表筛选条件：关键词 + 旋钮类型 + 实验结果，多个条件同时生效 */
export interface ExperimentFilter {
  /** 名称与用户结论搜索词；空白分隔的多个词需同时命中（AND） */
  keyword: string
  /** 旋钮类型筛选，'' 表示不限 */
  param: '' | keyof SimParams
  /** 实验方案结果筛选，'' 表示不限 */
  status: '' | ExperimentStatusKey
  /** 时间排序：desc 新→旧（与列表默认一致），asc 旧→新 */
  timeOrder: 'asc' | 'desc'
}

export const DEFAULT_EXPERIMENT_FILTER: ExperimentFilter = {
  keyword: '',
  param: '',
  status: '',
  timeOrder: 'desc'
}

export function isDefaultExperimentFilter(f: ExperimentFilter): boolean {
  return (
    f.keyword.trim() === '' &&
    f.param === '' &&
    f.status === '' &&
    f.timeOrder === DEFAULT_EXPERIMENT_FILTER.timeOrder
  )
}

/** 筛选所需的一条实验的最小结构（store 的 ExperimentMeta 天然满足） */
export interface ExperimentFilterable {
  record: Pick<ExperimentRecord, 'id' | 'name' | 'conclusion' | 'created_at'>
  condition: Pick<ExperimentCondition, 'param'>
  outcome: { variant: { metrics: GlassMetrics } }
}

/**
 * 按条件筛选并排序实验列表（不修改传入数组）：
 * - 关键词：在名称与用户结论中做不区分大小写的包含匹配，多个词需全部命中；
 * - 旋钮类型 / 结果状态：精确匹配实验条件旋钮与实验方案末帧结论；
 * - 以上条件同时生效（交集）；
 * - 排序：按保存时间升 / 降序，同时间以 id 次序兜底，保证顺序稳定。
 */
export function filterExperiments<T extends ExperimentFilterable>(
  items: readonly T[],
  filter: ExperimentFilter
): T[] {
  const tokens = filter.keyword
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  const dir = filter.timeOrder === 'asc' ? 1 : -1
  return items
    .filter((item) => {
      if (filter.param !== '' && item.condition.param !== filter.param) return false
      if (filter.status !== '' && statusKeyOfMetrics(item.outcome.variant.metrics) !== filter.status) {
        return false
      }
      if (tokens.length > 0) {
        const haystack = `${item.record.name}\n${item.record.conclusion}`.toLowerCase()
        if (!tokens.every((t) => haystack.includes(t))) return false
      }
      return true
    })
    .slice()
    .sort((a, b) => {
      if (a.record.created_at !== b.record.created_at) {
        return dir * (a.record.created_at - b.record.created_at)
      }
      return dir * ((a.record.id ?? 0) - (b.record.id ?? 0))
    })
}

/* ---------- 列表分段（轻量分页，纯函数，可直接单测） ---------- */

/** 列表单段条数：右栏空间有限，每段最多渲染 8 条，避免一次挂载大量缩略图 */
export const EXPERIMENT_PAGE_SIZE = 8

/** 一段列表的窗口信息（页码从 1 起，已钳制到有效范围） */
export interface ExperimentPageWindow {
  /** 当前段页码（1 起） */
  page: number
  /** 总段数（总数为 0 时也为 1，调用方按空列表自行渲染空态） */
  pageCount: number
  /** 当前段首条在筛选结果中的下标（含） */
  start: number
  /** 当前段末条之后的下标（不含） */
  end: number
}

/**
 * 由筛选结果总数与请求页码算出有效分段窗口：
 * 请求页超出末段时回退到最后一个有效段（删除末段记录 / 保存结论改变命中数时用），
 * 非正 / 非有限值一律视为首段。不抛异常，保证瞬时草稿状态下列表仍可渲染。
 */
export function paginateExperiments(
  total: number,
  requestedPage: number,
  pageSize: number = EXPERIMENT_PAGE_SIZE
): ExperimentPageWindow {
  const size = Math.max(1, Math.floor(pageSize))
  const safeTotal = Math.max(0, Math.floor(total))
  const pageCount = Math.max(1, Math.ceil(safeTotal / size))
  // 非有限值（NaN / ±Infinity）视为首段；越界整数页交给 min/max 钳到有效段
  const raw = Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1
  const page = Math.min(pageCount, Math.max(1, raw))
  const start = (page - 1) * size
  return { page, pageCount, start, end: Math.min(safeTotal, start + size) }
}

/* ---------- 持久化记录的序列化 / 严格解析（损坏时抛错，由列表层跳过） ---------- */

const METRIC_FIELDS = [
  'avgTemp',
  'avgThickness',
  'avgBubbles',
  'maxStress',
  'maxCracks',
  'rimRadius',
  'neckRadius',
  'bodyRadius',
  'elongation'
] as const

function asMetrics(v: unknown, where: string): GlassMetrics {
  if (typeof v !== 'object' || v === null) throw new ExperimentError(`${where}数据损坏`)
  const o = v as Record<string, unknown>
  for (const k of METRIC_FIELDS) {
    if (typeof o[k] !== 'number' || !Number.isFinite(o[k])) {
      throw new ExperimentError(`${where}数据损坏：指标 ${k} 无效`)
    }
  }
  if (typeof o.isRuined !== 'boolean' || typeof o.isVase !== 'boolean') {
    throw new ExperimentError(`${where}数据损坏：缺少成型 / 报废判定`)
  }
  return {
    avgTemp: o.avgTemp as number,
    avgThickness: o.avgThickness as number,
    avgBubbles: o.avgBubbles as number,
    maxStress: o.maxStress as number,
    maxCracks: o.maxCracks as number,
    isRuined: o.isRuined as boolean,
    rimRadius: o.rimRadius as number,
    neckRadius: o.neckRadius as number,
    bodyRadius: o.bodyRadius as number,
    elongation: o.elongation as number,
    isVase: o.isVase as boolean
  }
}

export function parseExperimentCondition(text: string): ExperimentCondition {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new ExperimentError('实验条件不是有效 JSON，可能已损坏')
  }
  const c = data as Record<string, unknown>
  const n = c.baselineFrames
  const from = c.fromFrame
  const to = c.toFrame
  if (
    typeof n !== 'number' ||
    typeof from !== 'number' ||
    typeof to !== 'number' ||
    !Number.isInteger(n) ||
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    n < MIN_EXPERIMENT_FRAMES ||
    from < 0 ||
    to > n ||
    from >= to
  ) {
    throw new ExperimentError('实验条件的帧区间无效')
  }
  if (!PARAM_KEYS.has(c.param as keyof SimParams)) {
    throw new ExperimentError('实验条件的旋钮参数无效')
  }
  if (typeof c.value !== 'number' || !Number.isFinite(c.value)) {
    throw new ExperimentError('实验条件的实验值无效')
  }
  if (!Array.isArray(c.baselineValues) || c.baselineValues.length !== to - from) {
    throw new ExperimentError('实验条件的基准取值数据损坏')
  }
  const baselineValues = (c.baselineValues as unknown[]).map((v) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new ExperimentError('基准取值数据损坏')
    return v
  })
  return {
    baselineFrames: n,
    fromFrame: from,
    toFrame: to,
    param: c.param as keyof SimParams,
    value: c.value,
    baselineValues
  }
}

export function parseExperimentOutcome(text: string): ExperimentOutcome {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new ExperimentError('实验结果不是有效 JSON，可能已损坏')
  }
  const o = data as Record<string, unknown>
  if (typeof o !== 'object' || o === null || typeof o.baseline !== 'object' || typeof o.variant !== 'object') {
    throw new ExperimentError('实验结果结构损坏')
  }
  return {
    baseline: {
      glass: createGlass(),
      metrics: asMetrics((o.baseline as Record<string, unknown>).metrics, '基准结果')
    },
    variant: {
      glass: createGlass(),
      metrics: asMetrics((o.variant as Record<string, unknown>).metrics, '实验结果')
    },
    ruinedChanged: Boolean(o.ruinedChanged)
  }
}

export function serializeExperimentCondition(cond: ExperimentCondition): string {
  return JSON.stringify(cond)
}

/** 结果只持久化双臂指标（器形由两张末帧缩略图承载，避免冗余的站点状态） */
export function serializeExperimentOutcome(outcome: ExperimentOutcome): string {
  return JSON.stringify({
    baseline: { metrics: outcome.baseline.metrics },
    variant: { metrics: outcome.variant.metrics },
    ruinedChanged: outcome.ruinedChanged
  })
}

/** 解析一条已保存的实验记录；condition / outcome JSON 损坏时抛错，列表层跳过并计数 */
export function parseExperimentRecord(record: ExperimentRecord): {
  condition: ExperimentCondition
  outcome: ExperimentOutcome
} {
  return {
    condition: parseExperimentCondition(record.condition_json),
    outcome: parseExperimentOutcome(record.outcome_json)
  }
}
