/**
 * 主进程 / preload / 渲染进程共享的类型定义。
 * 所有跨 IPC 传输的数据都必须是可 JSON 结构化克隆的普通对象。
 */

export type ToolId = 'flame' | 'blow' | 'pull' | 'marver' | 'cool'

/** 工坊旋钮参数（由 UI 滑块控制） */
export interface SimParams {
  /** 火焰目标温度 ℃（400 ~ 1200） */
  temperature: number
  /** 旋转速度 rpm（0 ~ 120） */
  spin: number
  /** 拉伸力度（0 ~ 1） */
  pullForce: number
  /** 吹气压力（0 ~ 1） */
  blowPressure: number
}

/** 一帧内指针 + 旋钮的全部输入（轨迹录制 / 回放单元） */
export interface FrameInput {
  tool: ToolId
  /** 指针在玻璃高度方向的归一化位置 0(底)~1(顶) */
  y: number
  /** 指针水平位置 -1(左)~1(右)，仅用于工具头渲染 */
  x: number
  /** 按压强度 0..1（松开/按下/触控压感的折中值） */
  pressure: number
  params: SimParams
}

/** 轨迹中的一个固定步长采样 */
export interface TrajFrame {
  dt: number
  input: FrameInput
}

/** SQLite 中保存的一条过程快照 */
export interface SnapshotRecord {
  id: number | null
  title: string
  note: string
  created_at: number
  /** GlassSnapshot 的 JSON 字符串 */
  glass_json: string
  /** dataURL 缩略图 */
  thumb: string
}

/** 分镜板上的一格（纯数据，布局计算在 renderer 内完成） */
export interface StoryboardPanel {
  title: string
  caption: string
  thumb: string
}

/**
 * 分镜导出配置预设：作品名 + 队列顺序与勾选状态。
 * 与快照数据分开持久化，保存 / 应用 / 删除预设都不改写快照内容与快照列表。
 */
export interface StoryboardPresetRecord {
  id: number | null
  name: string
  /** 分镜作品名 */
  title: string
  /** 导出队列：快照 id + 是否勾选，数组顺序即导出顺序 */
  queue: { id: number; on: boolean }[]
  created_at: number
}

/**
 * 工艺实验条件：复制一条基准轨迹，仅在帧区间 [fromFrame, toFrame) 内
 * 把指定的一项旋钮参数改为 value，其余输入（工具头 / 指针 / 按压 / 其他旋钮）逐帧保持一致。
 */
export interface ExperimentCondition {
  /** 基准轨迹总帧数（复制前） */
  baselineFrames: number
  /** 修改区间起始帧（含），0-based */
  fromFrame: number
  /** 修改区间结束帧（不含）；等于基准帧数表示改到末帧 */
  toFrame: number
  /** 只允许改动的一项旋钮参数 */
  param: keyof SimParams
  /** 实验值（受旋钮合法区间约束） */
  value: number
  /** 该参数在基准轨迹修改区间内的取值（逐帧记录，仅展示 / 校验用） */
  baselineValues: number[]
}

/** SQLite 中保存的一条工艺实验（条件 + 结果 + 用户结论，独立于快照与预设） */
export interface ExperimentRecord {
  id: number | null
  name: string
  created_at: number
  /** ExperimentCondition 的 JSON 字符串 */
  condition_json: string
  /** ExperimentOutcome 的 JSON 字符串（基准 / 实验双臂指标） */
  outcome_json: string
  /** 基准方案末帧 dataURL 缩略图 */
  baseline_thumb: string
  /** 实验方案末帧 dataURL 缩略图 */
  variant_thumb: string
  /** 用户写下的实验结论（可为空） */
  conclusion: string
}

export interface ExportResult {
  ok: boolean
  path?: string
  error?: string
  /** 用户在系统对话框中取消 */
  canceled?: boolean
}

/** 导入文件（打开对话框 + 读取文本）的结果 */
export interface ImportFileResult {
  ok: boolean
  canceled?: boolean
  /** 文件名（不含目录） */
  name?: string
  /** 文件文本内容 */
  text?: string
  error?: string
}

/** preload 暴露在 window.forge 上的接口 */
export interface ForgeBridge {
  listSnapshots(): Promise<SnapshotRecord[]>
  saveSnapshot(record: Omit<SnapshotRecord, 'id' | 'created_at'>): Promise<SnapshotRecord>
  deleteSnapshot(id: number): Promise<void>
  listPresets(): Promise<StoryboardPresetRecord[]>
  savePreset(
    record: Omit<StoryboardPresetRecord, 'id' | 'created_at'>
  ): Promise<StoryboardPresetRecord>
  deletePreset(id: number): Promise<void>
  listExperiments(): Promise<ExperimentRecord[]>
  saveExperiment(
    record: Omit<ExperimentRecord, 'id' | 'created_at'>
  ): Promise<ExperimentRecord>
  updateExperimentConclusion(id: number, conclusion: string): Promise<void>
  deleteExperiment(id: number): Promise<void>
  exportStoryboard(dataUrl: string, defaultName: string): Promise<ExportResult>
  exportTrajectory(json: string, defaultName: string): Promise<ExportResult>
  importTrajectory(): Promise<ImportFileResult>
  /** 帧标注与轨迹分开保存：独立的导出 / 导入通道，不经过轨迹文件 */
  exportAnnotations(json: string, defaultName: string): Promise<ExportResult>
  importAnnotations(): Promise<ImportFileResult>
}
