import type { StoryboardPanel } from '@shared/types'

export interface PanelRect {
  x: number
  y: number
  w: number
  h: number
}

export interface BoardLayout {
  width: number
  height: number
  panels: PanelRect[]
  titleY: number
  margin: number
}

export const BOARD_TITLE_H = 64
export const BOARD_PADDING = 48
export const PANEL_GAP = 36
export const PANEL_CAPTION_H = 46
export const PANEL_RATIO = 0.82 // 缩略图高 / 宽

/** 分镜导出队列中的一项：快照 id + 是否选中导出 */
export interface BoardPick {
  id: number
  on: boolean
}

/**
 * 导出队列调和（纯函数）：
 * - 保留已有节点的手动顺序与勾选状态；
 * - 新出现的快照按创建时间从早到晚追加到队尾；
 * - 已删除的快照从队列移除。
 * 只产出本次分镜的队列，不改写快照数据本身。
 */
export function reconcileBoardQueue(
  prev: BoardPick[],
  records: { id: number | null; created_at: number }[]
): BoardPick[] {
  const alive = new Set<number>()
  for (const r of records) {
    if (r.id != null) alive.add(r.id)
  }
  const kept = prev.filter((p) => alive.has(p.id))
  const known = new Set(kept.map((p) => p.id))
  const fresh = records
    .filter((r): r is { id: number; created_at: number } => r.id != null && !known.has(r.id))
    .sort((a, b) =>
      a.created_at !== b.created_at ? a.created_at - b.created_at : a.id - b.id
    )
    .map((r) => ({ id: r.id, on: true }))
  return [...kept, ...fresh]
}

/** 批量设置勾选状态：全选 / 全不选，顺序保持不变，不改原数组 */
export function setBoardAllPicked(picks: BoardPick[], on: boolean): BoardPick[] {
  return picks.map((p) => (p.on === on ? p : { ...p, on }))
}

/**
 * 恢复时间顺序（纯函数）：按快照创建时间从早到晚排列。
 * - 各节点当前的勾选状态原样保留；
 * - 时间相同时使用稳定规则排序：先按创建时间，再按 id 升序，
 *   id 缺失的记录排在最后（与初始入队顺序一致）；
 * - 队列中找不到对应记录的节点保持原相对顺序追加到队尾。
 */
export function restoreBoardOrder(
  picks: BoardPick[],
  records: { id: number | null; created_at: number }[]
): BoardPick[] {
  const timeById = new Map<number, number>()
  for (const r of records) {
    if (r.id != null) timeById.set(r.id, r.created_at)
  }
  return picks
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const ta = timeById.get(a.p.id)
      const tb = timeById.get(b.p.id)
      if (ta == null && tb == null) return a.i - b.i
      if (ta == null) return 1
      if (tb == null) return -1
      if (ta !== tb) return ta - tb
      if (a.p.id !== b.p.id) return a.p.id - b.p.id
      return a.i - b.i
    })
    .map(({ p }) => p)
}

/** 将队列中 index 处节点上移（dir=-1）/下移（dir=1）一位；越界时原样返回，不改原数组 */
export function moveBoardItem<T>(items: T[], index: number, dir: -1 | 1): T[] {
  const j = index + dir
  if (index < 0 || index >= items.length || j < 0 || j >= items.length) return items
  const next = items.slice()
  const tmp = next[index]
  next[index] = next[j]
  next[j] = tmp
  return next
}

/**
 * 纯布局计算：给定分镜数量与目标宽度，输出每格的矩形。
 * 1~2 格一行，3~4 格两行，5+ 格每行 3 个。
 */
export function layoutBoard(count: number, targetWidth = 1400): BoardLayout {
  let cols = 1
  if (count >= 2) cols = 2
  if (count >= 5) cols = 3
  const rows = Math.max(1, Math.ceil(count / cols))
  const margin = BOARD_PADDING
  const gap = PANEL_GAP
  const panelW = (targetWidth - margin * 2 - gap * (cols - 1)) / cols
  const panelH = panelW * PANEL_RATIO + PANEL_CAPTION_H
  const height = BOARD_TITLE_H + margin + rows * panelH + (rows - 1) * gap + margin

  const panels: PanelRect[] = []
  for (let i = 0; i < count; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    panels.push({
      x: margin + col * (panelW + gap),
      y: BOARD_TITLE_H + margin + row * (panelH + gap),
      w: panelW,
      h: panelH
    })
  }
  return { width: targetWidth, height, panels, titleY: 42, margin }
}

/** 在 canvas 上合成制作分镜，返回 PNG dataURL */
export async function renderStoryboard(
  panels: StoryboardPanel[],
  title: string
): Promise<string> {
  const layout = layoutBoard(panels.length)
  const canvas = document.createElement('canvas')
  canvas.width = layout.width
  canvas.height = layout.height
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#101319'
  ctx.fillRect(0, 0, layout.width, layout.height)

  ctx.fillStyle = '#e8e4da'
  ctx.font = 'bold 30px sans-serif'
  ctx.textBaseline = 'middle'
  ctx.fillText(title, layout.margin, layout.titleY)
  ctx.font = '15px sans-serif'
  ctx.fillStyle = '#7d8794'
  ctx.fillText(
    `琉璃工房 · 制作分镜 · ${panels.length} 个工序节点`,
    layout.margin + ctx.measureText(title).width + 24,
    layout.titleY + 2
  )

  const thumbH = (w: number): number => w * PANEL_RATIO
  await Promise.all(
    panels.map(
      (p, i) =>
        new Promise<void>((resolve) => {
          const rect = layout.panels[i]
          const img = new Image()
          img.onload = (): void => {
            ctx.fillStyle = '#171b22'
            ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
            ctx.drawImage(img, rect.x, rect.y, rect.w, thumbH(rect.w))
            ctx.fillStyle = '#d8d4ca'
            ctx.font = 'bold 17px sans-serif'
            ctx.fillText(`${i + 1}. ${p.title}`, rect.x + 14, rect.y + thumbH(rect.w) + 18)
            ctx.fillStyle = '#8b95a3'
            ctx.font = '14px sans-serif'
            ctx.fillText(p.caption, rect.x + 14, rect.y + thumbH(rect.w) + 36)
            ctx.strokeStyle = 'rgba(255,255,255,0.08)'
            ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1)
            resolve()
          }
          img.onerror = (): void => resolve()
          img.src = p.thumb
        })
    )
  )

  return canvas.toDataURL('image/png')
}
