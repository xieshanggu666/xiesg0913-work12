import type {
  ExperimentRecord,
  ForgeBridge,
  SnapshotRecord,
  StoryboardPanel,
  StoryboardPresetRecord
} from '@shared/types'

/**
 * 存储适配：Electron 下走 SQLite（window.forge），
 * 浏览器 / 单测环境降级到 localStorage，保证离线可用。
 */

const LS_KEY = 'glass-forge:snapshots'
// 预设与快照分开持久化：互不改写
const LS_PRESET_KEY = 'glass-forge:storyboard-presets'
// 自增 id 计数器：删除记录后新记录不复用旧 id
// （预设按 id 引用快照，max(id)+1 在删除最新记录后会串号）
const LS_SNAPSHOT_SEQ = 'glass-forge:snapshot-seq'
const LS_PRESET_SEQ = 'glass-forge:preset-seq'
// 工艺实验与快照 / 预设分开持久化：实验只读地复制一条轨迹，互不影响
const LS_EXPERIMENT_KEY = 'glass-forge:experiments'
const LS_EXPERIMENT_SEQ = 'glass-forge:experiment-seq'

function bridge(): ForgeBridge | undefined {
  return typeof window !== 'undefined' ? window.forge : undefined
}

/** 单调递增的 id：取计数器与现存最大 id 的较大者再 +1，保证删除后不复用 */
function nextId(seqKey: string, records: { id: number | null }[]): number {
  const stored = Number(localStorage.getItem(seqKey) ?? '0')
  const maxInUse = records.reduce((m, r) => Math.max(m, r.id ?? 0), 0)
  const next = Math.max(Number.isFinite(stored) ? stored : 0, maxInUse) + 1
  localStorage.setItem(seqKey, String(next))
  return next
}

function readLocal(): SnapshotRecord[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as SnapshotRecord[]
  } catch {
    return []
  }
}

function writeLocal(records: SnapshotRecord[]): void {
  localStorage.setItem(LS_KEY, JSON.stringify(records))
}

export async function listSnapshots(): Promise<SnapshotRecord[]> {
  const b = bridge()
  if (b) return b.listSnapshots()
  return readLocal().sort((a, b2) => b2.created_at - a.created_at)
}

export async function saveSnapshot(
  record: Omit<SnapshotRecord, 'id' | 'created_at'>
): Promise<SnapshotRecord> {
  const b = bridge()
  if (b) return b.saveSnapshot(record)
  const all = readLocal()
  const full: SnapshotRecord = {
    ...record,
    id: nextId(LS_SNAPSHOT_SEQ, all),
    created_at: Date.now()
  }
  all.push(full)
  writeLocal(all)
  return full
}

export async function deleteSnapshot(id: number): Promise<void> {
  const b = bridge()
  if (b) {
    await b.deleteSnapshot(id)
    return
  }
  writeLocal(readLocal().filter((r) => r.id !== id))
}

function readLocalPresets(): StoryboardPresetRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_PRESET_KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? (parsed as StoryboardPresetRecord[]) : []
  } catch {
    return []
  }
}

function writeLocalPresets(records: StoryboardPresetRecord[]): void {
  localStorage.setItem(LS_PRESET_KEY, JSON.stringify(records))
}

export async function listPresets(): Promise<StoryboardPresetRecord[]> {
  const b = bridge()
  if (b) return b.listPresets()
  return readLocalPresets().sort((a, b2) =>
    a.created_at !== b2.created_at ? a.created_at - b2.created_at : (a.id ?? 0) - (b2.id ?? 0)
  )
}

export async function savePreset(
  record: Omit<StoryboardPresetRecord, 'id' | 'created_at'>
): Promise<StoryboardPresetRecord> {
  const b = bridge()
  if (b) return b.savePreset(record)
  const all = readLocalPresets()
  const full: StoryboardPresetRecord = {
    ...record,
    id: nextId(LS_PRESET_SEQ, all),
    created_at: Date.now()
  }
  all.push(full)
  writeLocalPresets(all)
  return full
}

export async function deletePreset(id: number): Promise<void> {
  const b = bridge()
  if (b) {
    await b.deletePreset(id)
    return
  }
  writeLocalPresets(readLocalPresets().filter((r) => r.id !== id))
}

function readLocalExperiments(): ExperimentRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LS_EXPERIMENT_KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? (parsed as ExperimentRecord[]) : []
  } catch {
    return []
  }
}

function writeLocalExperiments(records: ExperimentRecord[]): void {
  localStorage.setItem(LS_EXPERIMENT_KEY, JSON.stringify(records))
}

export async function listExperiments(): Promise<ExperimentRecord[]> {
  const b = bridge()
  if (b) return b.listExperiments()
  return readLocalExperiments().sort((a, b2) => b2.created_at - a.created_at)
}

export async function saveExperiment(
  record: Omit<ExperimentRecord, 'id' | 'created_at'>
): Promise<ExperimentRecord> {
  const b = bridge()
  if (b) return b.saveExperiment(record)
  const all = readLocalExperiments()
  const full: ExperimentRecord = {
    ...record,
    id: nextId(LS_EXPERIMENT_SEQ, all),
    created_at: Date.now()
  }
  all.push(full)
  writeLocalExperiments(all)
  return full
}

export async function updateExperimentConclusion(id: number, conclusion: string): Promise<void> {
  const b = bridge()
  if (b) {
    await b.updateExperimentConclusion(id, conclusion)
    return
  }
  const all = readLocalExperiments().map((r) => (r.id === id ? { ...r, conclusion } : r))
  writeLocalExperiments(all)
}

export async function deleteExperiment(id: number): Promise<void> {
  const b = bridge()
  if (b) {
    await b.deleteExperiment(id)
    return
  }
  writeLocalExperiments(readLocalExperiments().filter((r) => r.id !== id))
}

export async function exportStoryboard(panels: StoryboardPanel[], title: string): Promise<string> {
  // 动态引入，避免纯逻辑测试加载 DOM 依赖
  const { renderStoryboard } = await import('../engine/storyboard')
  return renderStoryboard(panels, title)
}

/** 保存分镜 PNG；返回保存路径，用户在系统对话框中取消时返回 null */
export async function saveStoryboardFile(dataUrl: string, name: string): Promise<string | null> {
  const b = bridge()
  if (b) {
    const res = await b.exportStoryboard(dataUrl, name)
    if (res.canceled) return null
    if (!res.ok) throw new Error(res.error ?? '导出失败')
    return res.path ?? ''
  }
  // 浏览器降级：直接触发下载
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = name
  a.click()
  return name
}

/** 浏览器降级：把文本内容触发为下载 */
function downloadTextFile(text: string, name: string): string {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
  return name
}

/** 浏览器降级：弹出文件选择并读取文本；用户取消时返回 null */
function pickTextFile(): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      const reader = new FileReader()
      reader.onload = () => resolve({ name: file.name, text: String(reader.result ?? '') })
      reader.onerror = () => resolve(null)
      reader.readAsText(file)
    })
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}

/** 导出轨迹 JSON；返回保存路径，用户取消时返回 null */
export async function saveTrajectoryFile(json: string, name: string): Promise<string | null> {
  const b = bridge()
  if (b) {
    const res = await b.exportTrajectory(json, name)
    if (res.canceled) return null
    if (!res.ok) throw new Error(res.error ?? '导出失败')
    return res.path ?? ''
  }
  return downloadTextFile(json, name)
}

/** 弹出文件选择并读取轨迹 JSON 文本；用户取消时返回 null */
export async function openTrajectoryFile(): Promise<{ name: string; text: string } | null> {
  const b = bridge()
  if (b) {
    const res = await b.importTrajectory()
    if (res.canceled) return null
    if (!res.ok) throw new Error(res.error ?? '读取文件失败')
    return { name: res.name ?? '轨迹文件', text: res.text ?? '' }
  }
  return pickTextFile()
}

/** 导出帧标注 JSON（与轨迹文件分开保存）；返回保存路径，用户取消时返回 null */
export async function saveAnnotationsFile(json: string, name: string): Promise<string | null> {
  const b = bridge()
  if (b) {
    const res = await b.exportAnnotations(json, name)
    if (res.canceled) return null
    if (!res.ok) throw new Error(res.error ?? '导出失败')
    return res.path ?? ''
  }
  return downloadTextFile(json, name)
}

/** 弹出文件选择并读取帧标注 JSON 文本；用户取消时返回 null */
export async function openAnnotationsFile(): Promise<{ name: string; text: string } | null> {
  const b = bridge()
  if (b) {
    const res = await b.importAnnotations()
    if (res.canceled) return null
    if (!res.ok) throw new Error(res.error ?? '读取文件失败')
    return { name: res.name ?? '标注文件', text: res.text ?? '' }
  }
  return pickTextFile()
}
