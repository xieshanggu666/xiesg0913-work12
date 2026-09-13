import { create } from 'zustand'
import type {
  ExperimentRecord,
  SimParams,
  SnapshotRecord,
  StoryboardPresetRecord,
  ToolId,
  TrajFrame
} from '@shared/types'
import {
  DEFAULT_INPUT,
  Engine,
  measure,
  type GlassMetrics
} from '../engine/engine'
import { restoreGlass, type GlassSnapshot } from '../engine/geometry'
import { summarizeMetrics, type GlassStatusSummary } from '../engine/describe'
import {
  MAX_EXPERIMENT_CONCLUSION,
  MAX_EXPERIMENT_NAME,
  parseExperimentRecord,
  serializeExperimentCondition,
  serializeExperimentOutcome,
  type ExperimentCondition,
  type ExperimentOutcome
} from '../engine/experiment'
import { parseTrajectory, serializeTrajectory } from '../engine/trajectory'
import {
  MAX_ANNOTATION_TEXT,
  addFrameAnnotation,
  parseAnnotations,
  removeFrameAnnotation,
  serializeAnnotations,
  type FrameAnnotation
} from '../engine/annotations'
import {
  deleteExperiment,
  deletePreset,
  deleteSnapshot,
  listExperiments,
  listPresets,
  listSnapshots,
  openAnnotationsFile,
  openTrajectoryFile,
  saveAnnotationsFile,
  saveExperiment,
  savePreset,
  saveSnapshot,
  saveTrajectoryFile,
  updateExperimentConclusion
} from './storage'

export interface SnapshotMeta {
  record: SnapshotRecord
  snapshot: GlassSnapshot
  /** 由快照玻璃状态算出的状态概述（列表 / 分镜展示用） */
  summary: GlassStatusSummary
}

/** 列表中一条已解析的工艺实验（条件 / 结果 JSON 在刷新时解析，损坏记录被跳过） */
export interface ExperimentMeta {
  record: ExperimentRecord
  condition: ExperimentCondition
  outcome: ExperimentOutcome
}

interface StudioState {
  engine: Engine
  tool: ToolId
  params: SimParams
  /** 每次 tick 自增，用于驱动 React 刷新读数（不存整块玻璃） */
  frameTick: number
  metrics: GlassMetrics
  pointerActive: boolean
  /** 回放模式（时间轴可见）；播到末帧会停在末帧保持该状态 */
  replaying: boolean
  /** 回放正在播放（false = 暂停，含拖动定位 / 单帧步进后的暂停） */
  replayPlaying: boolean
  replayProgress: number
  /** 时间轴当前帧（已回放的帧数） */
  replayFrame: number
  /** 回放总帧数 */
  replayFrameCount: number
  /** 回放速度倍率 */
  replaySpeed: number
  /** 当前轨迹的帧标注（与轨迹文件分开保存，互不改写） */
  annotations: FrameAnnotation[]
  snapshots: SnapshotMeta[]
  /** 分镜导出配置预设（与快照分开持久化，互不改写） */
  presets: StoryboardPresetRecord[]
  /** 已保存的工艺实验（条件 + 结果 + 用户结论，独立持久化） */
  experiments: ExperimentMeta[]
  toast: string | null
  busy: boolean

  bump: () => void
  setTool: (t: ToolId) => void
  setParam: <K extends keyof SimParams>(k: K, v: SimParams[K]) => void
  setPointerActive: (v: boolean) => void

  refreshSnapshots: () => Promise<void>
  addSnapshot: (title: string, note: string, thumb: string) => Promise<boolean>
  removeSnapshot: (id: number) => Promise<void>
  loadSnapshot: (meta: SnapshotMeta) => void

  refreshPresets: () => Promise<void>
  addPreset: (
    name: string,
    title: string,
    queue: { id: number; on: boolean }[]
  ) => Promise<boolean>
  removePreset: (id: number) => Promise<void>

  /** 读取已保存的工艺实验；损坏记录跳过并给出提示 */
  refreshExperiments: () => Promise<void>
  /** 保存一次实验的条件 / 结果 / 缩略图与用户结论；返回是否成功 */
  saveExperimentResult: (input: {
    name: string
    condition: ExperimentCondition
    outcome: ExperimentOutcome
    baselineThumb: string
    variantThumb: string
    conclusion: string
  }) => Promise<boolean>
  /** 更新某条实验的用户结论（条件 / 结果不可改，实验只能重做） */
  saveExperimentConclusion: (id: number, conclusion: string) => Promise<void>
  removeExperiment: (id: number) => Promise<void>

  playReplay: () => void
  stopReplay: () => void
  /** 每帧从引擎同步回放进度 / 帧号 / 播放状态（由渲染循环调用） */
  syncReplay: () => void
  toggleReplayPlay: () => void
  /** 拖动定位到第 index 帧 */
  seekFrame: (index: number) => void
  /** 前后单帧步进（自动暂停） */
  stepFrame: (delta: number) => void
  setReplaySpeed: (v: number) => void
  /** 为当前帧添加文字标注；内容非法时提示并返回 false */
  addAnnotation: (text: string) => boolean
  removeAnnotation: (id: number) => void
  exportAnnotations: () => Promise<void>
  importAnnotations: () => Promise<void>
  exportTrajectory: () => Promise<void>
  importTrajectory: () => Promise<void>

  resetGlass: () => void
  showToast: (msg: string) => void
  setBusy: (v: boolean) => void
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useStudio = create<StudioState>((set, get) => {
  const engine = new Engine()
  // 播到末帧：引擎停在末帧（replayPlaying 由 syncReplay 同步为 false），这里只负责提示
  engine.onReplayEnd = () => {
    get().showToast('成形轨迹回放完成')
  }

  return {
    engine,
    tool: engine.input.tool,
    params: { ...engine.input.params },
    frameTick: 0,
    metrics: engine.metrics(),
    pointerActive: false,
    replaying: false,
    replayPlaying: false,
    replayProgress: 0,
    replayFrame: 0,
    replayFrameCount: 0,
    replaySpeed: 1,
    annotations: [],
    snapshots: [],
    presets: [],
    experiments: [],
    toast: null,
    busy: false,

    bump: () => {
      const { engine: e } = get()
      set({ frameTick: get().frameTick + 1, metrics: e.metrics() })
    },

    setTool: (t) => {
      get().engine.setTool(t)
      set({ tool: t })
    },

    setParam: (k, v) => {
      const p = { ...get().params, [k]: v }
      get().engine.setParams({ [k]: v })
      set({ params: p })
    },

    setPointerActive: (v) => set({ pointerActive: v }),

    refreshSnapshots: async () => {
      try {
        const records = await listSnapshots()
        const metas: SnapshotMeta[] = []
        let corrupt = 0
        for (const record of records) {
          try {
            const snapshot = JSON.parse(record.glass_json) as GlassSnapshot
            metas.push({
              record,
              snapshot,
              summary: summarizeMetrics(measure(restoreGlass(snapshot)))
            })
          } catch {
            corrupt++
          }
        }
        set({ snapshots: metas })
        if (corrupt > 0) {
          get().showToast(`读取快照列表失败：${corrupt} 条记录数据损坏已跳过`)
        }
      } catch (err) {
        get().showToast(`读取快照列表失败：${(err as Error).message}`)
      }
    },

    addSnapshot: async (title, note, thumb) => {
      const { engine: e, showToast, refreshSnapshots } = get()
      try {
        const record = await saveSnapshot({
          title,
          note,
          glass_json: JSON.stringify(e.snapshot()),
          thumb
        })
        await refreshSnapshots()
        showToast(`已保存快照「${record.title}」`)
        return true
      } catch (err) {
        showToast(`保存快照失败：${(err as Error).message}`)
        return false
      }
    },

    removeSnapshot: async (id) => {
      const title = get().snapshots.find((m) => m.record.id === id)?.record.title
      try {
        await deleteSnapshot(id)
        await get().refreshSnapshots()
        get().showToast(title ? `已删除快照「${title}」` : '已删除快照')
      } catch (err) {
        get().showToast(`删除快照失败：${(err as Error).message}`)
      }
    },

    loadSnapshot: (meta) => {
      const { engine: e, stopReplay } = get()
      try {
        stopReplay()
        e.restore(meta.snapshot)
        e.clearTraj()
        // 轨迹已清空，旧轨迹的帧标注一并失效
        set({ metrics: e.metrics(), annotations: [] })
        get().bump()
        get().showToast(`已读取快照「${meta.record.title}」`)
      } catch (err) {
        get().showToast(`读取快照失败：${(err as Error).message}`)
      }
    },

    refreshPresets: async () => {
      try {
        const presets = await listPresets()
        set({ presets })
      } catch (err) {
        get().showToast(`读取预设列表失败：${(err as Error).message}`)
      }
    },

    addPreset: async (name, title, queue) => {
      const { snapshots, showToast } = get()
      // 没有快照时保存的预设必然无效（队列里没有任何可对应的工序节点），直接阻止
      const alive = new Set(
        snapshots.map((m) => m.record.id).filter((id): id is number => id != null)
      )
      const cleanQueue = queue.filter((q) => alive.has(q.id))
      if (snapshots.length === 0 || cleanQueue.length === 0) {
        showToast('当前没有快照，无法保存预设')
        return false
      }
      try {
        const record = await savePreset({ name, title, queue: cleanQueue })
        await get().refreshPresets()
        showToast(`已保存预设「${record.name}」`)
        return true
      } catch (err) {
        showToast(`保存预设失败：${(err as Error).message}`)
        return false
      }
    },

    removePreset: async (id) => {
      const name = get().presets.find((p) => p.id === id)?.name
      try {
        await deletePreset(id)
        await get().refreshPresets()
        get().showToast(name ? `已删除预设「${name}」` : '已删除预设')
      } catch (err) {
        get().showToast(`删除预设失败：${(err as Error).message}`)
      }
    },

    refreshExperiments: async () => {
      try {
        const records = await listExperiments()
        const metas: ExperimentMeta[] = []
        let corrupt = 0
        for (const record of records) {
          try {
            const { condition, outcome } = parseExperimentRecord(record)
            metas.push({ record, condition, outcome })
          } catch {
            corrupt++
          }
        }
        set({ experiments: metas })
        if (corrupt > 0) {
          get().showToast(`读取实验列表失败：${corrupt} 条记录数据损坏已跳过`)
        }
      } catch (err) {
        get().showToast(`读取实验列表失败：${(err as Error).message}`)
      }
    },

    saveExperimentResult: async ({ name, condition, outcome, baselineThumb, variantThumb, conclusion }) => {
      const { showToast } = get()
      const trimmedName = name.trim()
      if (!trimmedName) {
        showToast('请填写实验名称')
        return false
      }
      if (trimmedName.length > MAX_EXPERIMENT_NAME) {
        showToast(`实验名称最长 ${MAX_EXPERIMENT_NAME} 字`)
        return false
      }
      if (conclusion.length > MAX_EXPERIMENT_CONCLUSION) {
        showToast(`实验结论最长 ${MAX_EXPERIMENT_CONCLUSION} 字`)
        return false
      }
      try {
        await saveExperiment({
          name: trimmedName,
          condition_json: serializeExperimentCondition(condition),
          outcome_json: serializeExperimentOutcome(outcome),
          baseline_thumb: baselineThumb,
          variant_thumb: variantThumb,
          conclusion: conclusion.trim()
        })
        await get().refreshExperiments()
        showToast(`已保存工艺实验「${trimmedName}」`)
        return true
      } catch (err) {
        showToast(`保存实验失败：${(err as Error).message}`)
        return false
      }
    },

    saveExperimentConclusion: async (id, conclusion) => {
      const { showToast } = get()
      if (conclusion.length > MAX_EXPERIMENT_CONCLUSION) {
        showToast(`实验结论最长 ${MAX_EXPERIMENT_CONCLUSION} 字`)
        return
      }
      try {
        await updateExperimentConclusion(id, conclusion.trim())
        await get().refreshExperiments()
        showToast('已更新实验结论')
      } catch (err) {
        showToast(`更新结论失败：${(err as Error).message}`)
      }
    },

    removeExperiment: async (id) => {
      const name = get().experiments.find((m) => m.record.id === id)?.record.name
      try {
        await deleteExperiment(id)
        await get().refreshExperiments()
        get().showToast(name ? `已删除实验「${name}」` : '已删除实验')
      } catch (err) {
        get().showToast(`删除实验失败：${(err as Error).message}`)
      }
    },

    playReplay: () => {
      const { engine: e } = get()
      if (e.traj.length < 2) {
        get().showToast('还没有可回放的成形轨迹')
        return
      }
      // reset 会清空轨迹，先留存帧序列，回放结束后仍可再次回放 / 导出
      const frames = e.traj.slice()
      e.reset()
      e.traj = frames
      e.setReplaySpeed(get().replaySpeed)
      e.startReplay()
      set({
        replaying: true,
        replayPlaying: true,
        replayProgress: 0,
        replayFrame: 0,
        replayFrameCount: frames.length,
        tool: 'flame',
        params: { ...DEFAULT_INPUT.params }
      })
    },

    stopReplay: () => {
      const { engine: e } = get()
      e.cancelReplay()
      set({
        replaying: false,
        replayPlaying: false,
        replayProgress: 0,
        replayFrame: 0,
        replayFrameCount: 0
      })
    },

    syncReplay: () => {
      const { engine: e } = get()
      if (!e.isReplaying) return
      set({
        replayProgress: e.replayProgressValue,
        replayFrame: e.replayFrame,
        replayFrameCount: e.replayLength,
        replayPlaying: !e.replayPaused
      })
    },

    toggleReplayPlay: () => {
      const { engine: e } = get()
      if (!e.isReplaying) return
      if (e.replayPaused) e.resumeReplay()
      else e.pauseReplay()
      get().syncReplay()
    },

    seekFrame: (index) => {
      const { engine: e } = get()
      if (!e.isReplaying) return
      e.seekReplay(index)
      get().syncReplay()
      // 立即刷新当前帧的温度 / 成型指标读数
      get().bump()
    },

    stepFrame: (delta) => {
      const { engine: e } = get()
      if (!e.isReplaying) return
      e.stepReplay(delta)
      get().syncReplay()
      get().bump()
    },

    setReplaySpeed: (v) => {
      get().engine.setReplaySpeed(v)
      set({ replaySpeed: get().engine.replaySpeed })
    },

    addAnnotation: (text) => {
      const { engine: e, annotations, showToast } = get()
      if (!e.isReplaying) return false
      const trimmed = text.trim()
      if (!trimmed) {
        showToast('标注内容不能为空')
        return false
      }
      if (trimmed.length > MAX_ANNOTATION_TEXT) {
        showToast(`标注最长 ${MAX_ANNOTATION_TEXT} 字`)
        return false
      }
      set({ annotations: addFrameAnnotation(annotations, e.replayFrame, trimmed) })
      showToast(`已在第 ${e.replayFrame} 帧添加标注`)
      return true
    },

    removeAnnotation: (id) => {
      set({ annotations: removeFrameAnnotation(get().annotations, id) })
      get().showToast('已删除标注')
    },

    exportAnnotations: async () => {
      const { engine: e, annotations, showToast } = get()
      if (annotations.length === 0) {
        showToast('还没有可导出的标注')
        return
      }
      try {
        // 标注独立成文件：轨迹 JSON 的内容与格式都不受影响
        const json = serializeAnnotations(annotations, e.traj.length)
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
        const path = await saveAnnotationsFile(json, `玻璃轨迹标注-${stamp}.json`)
        if (path) showToast(`标注已导出：${path}`)
      } catch (err) {
        showToast(`导出标注失败：${(err as Error).message}`)
      }
    },

    importAnnotations: async () => {
      const { engine: e, showToast } = get()
      if (e.traj.length === 0) {
        showToast('请先录制或导入一条轨迹，再导入与它配套的标注')
        return
      }
      let file: { name: string; text: string } | null
      try {
        file = await openAnnotationsFile()
      } catch (err) {
        showToast(`导入标注失败：${(err as Error).message}`)
        return
      }
      if (!file) return
      try {
        const { annotations } = parseAnnotations(file.text)
        // 标注依附于帧号：超出当前轨迹范围说明与轨迹文件不配套
        const over = annotations.find((a) => a.frame >= e.traj.length)
        if (over) {
          showToast(
            `导入标注失败：标注对应第 ${over.frame} 帧，超出当前轨迹（共 ${e.traj.length} 帧），请确认与轨迹文件配套`
          )
          return
        }
        set({ annotations })
        showToast(`已导入「${file.name}」的 ${annotations.length} 条标注`)
      } catch (err) {
        showToast(`导入标注失败：${(err as Error).message}`)
      }
    },

    exportTrajectory: async () => {
      const { engine: e, showToast } = get()
      if (e.traj.length < 2) {
        showToast('还没有可导出的成形轨迹')
        return
      }
      try {
        const json = serializeTrajectory(e.traj)
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
        const path = await saveTrajectoryFile(json, `玻璃轨迹-${stamp}.json`)
        if (path) showToast(`轨迹已导出：${path}`)
      } catch (err) {
        showToast(`导出失败：${(err as Error).message}`)
      }
    },

    importTrajectory: async () => {
      const { engine: e, showToast, stopReplay } = get()
      let file: { name: string; text: string } | null
      try {
        file = await openTrajectoryFile()
      } catch (err) {
        showToast(`导入失败：${(err as Error).message}`)
        return
      }
      if (!file) return
      let frames: TrajFrame[]
      try {
        frames = parseTrajectory(file.text)
      } catch (err) {
        showToast(`导入失败：${(err as Error).message}`)
        return
      }
      stopReplay()
      e.loadTrajectory(frames)
      e.setReplaySpeed(get().replaySpeed)
      set({
        replaying: true,
        replayPlaying: true,
        replayProgress: 0,
        replayFrame: 0,
        replayFrameCount: frames.length,
        tool: 'flame',
        params: { ...DEFAULT_INPUT.params },
        // 新轨迹与旧标注不配套，清空；旧轨迹文件本身不含标注字段，导入后即为空列表
        annotations: []
      })
      showToast(`已导入「${file.name}」（${frames.length} 帧），从料泡开始回放`)
    },

    resetGlass: () => {
      get().engine.reset()
      set({
        tool: 'flame',
        params: { ...DEFAULT_INPUT.params },
        metrics: get().engine.metrics(),
        replaying: false,
        replayPlaying: false,
        replayProgress: 0,
        replayFrame: 0,
        replayFrameCount: 0,
        // 轨迹已清空，依附于帧号的标注一并失效
        annotations: []
      })
      get().bump()
    },

    showToast: (msg) => {
      set({ toast: msg })
      if (toastTimer) clearTimeout(toastTimer)
      toastTimer = setTimeout(() => set({ toast: null }), 2600)
    },

    setBusy: (v) => set({ busy: v })
  }
})
