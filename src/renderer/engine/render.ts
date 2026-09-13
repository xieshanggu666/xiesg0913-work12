import type { FrameInput } from '@shared/types'
import { TOOL_LABELS } from './constants'
import type { Glass } from './geometry'
import { softness } from './geometry'
import { makeRng } from './rng'
import type { GlassMetrics } from './engine'

export interface RenderState {
  glass: Glass
  input: FrameInput
  metrics: GlassMetrics
  time: number
  /** 指针是否悬停在画布上 */
  pointerActive: boolean
}

/** 温度 → 玻璃体色（冷却后为半透明墨青，熔融时亮黄白） */
function glassColor(temp: number): [number, number, number] {
  const stops: Array<[number, [number, number, number]]> = [
    [20, [38, 78, 96]],
    [300, [70, 120, 140]],
    [550, [196, 92, 48]],
    [750, [232, 138, 52]],
    [950, [255, 200, 96]],
    [1150, [255, 246, 214]]
  ]
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i]
    const [t1, c1] = stops[i + 1]
    if (temp <= t1) {
      const k = (temp - t0) / (t1 - t0)
      return [
        c0[0] + (c1[0] - c0[0]) * k,
        c0[1] + (c1[1] - c0[1]) * k,
        c0[2] + (c1[2] - c0[2]) * k
      ]
    }
  }
  return stops[stops.length - 1][1]
}

export function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, rs: RenderState): void {
  const { glass, input, metrics, time } = rs
  const s = glass.stations
  const n = s.length

  ctx.clearRect(0, 0, w, h)

  // 背景：深色工坊
  const bg = ctx.createLinearGradient(0, 0, 0, h)
  bg.addColorStop(0, '#14171d')
  bg.addColorStop(1, '#0b0d11')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)

  const cx = w / 2
  const scale = h / 3.35
  const bottomY = h - 36
  const py = (worldY: number): number => bottomY - worldY * scale
  const rx = (r: number): number => r * scale
  // 回转体的“正视”透视：纵深轴压扁
  const zy = (r: number): number => r * scale * 0.28

  const worldY = (i: number): number => (i / (n - 1)) * glass.elongation

  const outer = (i: number): [number, number, number] => [
    cx,
    py(worldY(i)),
    rx(s[i].r)
  ]

  // 高温辉光（在玻璃下方绘制）
  if (metrics.avgTemp > 500) {
    const glow = Math.min(1, softness(metrics.avgTemp))
    const g = ctx.createRadialGradient(cx, h * 0.55, 10, cx, h * 0.55, h * 0.42)
    g.addColorStop(0, `rgba(255,150,50,${0.16 * glow})`)
    g.addColorStop(1, 'rgba(255,150,50,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  // 吹管铁杆（从底部伸出）
  ctx.strokeStyle = '#4a4e57'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(cx, bottomY)
  ctx.lineTo(cx, h)
  ctx.stroke()

  // 外壁路径
  const traceOuter = (dir: 1 | -1): void => {
    for (let i = 0; i < n; i++) {
      const [, y, r] = outer(i)
      const x = cx + dir * r
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
  }

  ctx.beginPath()
  traceOuter(1)
  for (let i = n - 1; i >= 0; i--) {
    const [, y, r] = outer(i)
    ctx.lineTo(cx - r, y)
  }
  ctx.closePath()

  // 体色：按站点温度做垂直渐变（offset 0 在底部，与站点 i=0 对应）
  const grad = ctx.createLinearGradient(0, py(0), 0, py(glass.elongation))
  for (let i = 0; i < n; i += 3) {
    const [rC, gC, bC] = glassColor(s[i].temp)
    grad.addColorStop(i / (n - 1), `rgb(${rC | 0},${gC | 0},${bC | 0})`)
  }
  ctx.fillStyle = grad
  ctx.fill()

  // 夹出玻璃区域，后续气泡 / 高光 / 内壁都在体内绘制
  ctx.save()
  ctx.beginPath()
  traceOuter(1)
  for (let i = n - 1; i >= 0; i--) {
    const [, y, r] = outer(i)
    ctx.lineTo(cx - r, y)
  }
  ctx.closePath()
  ctx.clip()

  // 内壁（内腔）：用半透明深色填充，体现壁厚
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const st = s[i]
    const inner = Math.max(0, st.r - st.thickness) * scale
    const x = cx + inner
    const y = py(worldY(i)) + zy(Math.max(0, st.r - st.thickness))
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  for (let i = n - 1; i >= 0; i--) {
    const st = s[i]
    const inner = Math.max(0, st.r - st.thickness) * scale
    const x = cx - inner
    const y = py(worldY(i)) - zy(Math.max(0, st.r - st.thickness))
    ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fillStyle = 'rgba(10,12,16,0.62)'
  ctx.fill()

  // 气泡：确定性种子，位置随旋转相位移动
  const spinPhase = (time * input.params.spin * 2 * Math.PI) / 60
  for (let i = 1; i < n - 1; i++) {
    const st = s[i]
    if (st.bubbles < 0.04) continue
    const rng = makeRng(i * 7919 + 13)
    const count = Math.round(st.bubbles * 4)
    for (let b = 0; b < count; b++) {
      const ang = rng() * Math.PI * 2 + spinPhase * (0.5 + rng())
      const depth = rng()
      const rad = (st.r - st.thickness * (0.2 + depth * 0.7)) * scale
      const bx = cx + Math.cos(ang) * rad
      const by = py(worldY(i)) + Math.sin(ang) * rad * 0.28
      const br = (2 + rng() * 4.5) * (0.7 + softness(st.temp) * 0.6)
      ctx.beginPath()
      ctx.arc(bx, by, br, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255,240,205,${0.12 + depth * 0.25})`
      ctx.fill()
    }
  }

  // 裂纹：沿站点的深色折线，温度高时透出红热
  for (let i = 1; i < n - 1; i++) {
    const st = s[i]
    if (st.cracks < 0.03) continue
    const rng = makeRng(i * 104729 + 7)
    const lines = Math.min(3, 1 + Math.floor(st.cracks * 3))
    for (let l = 0; l < lines; l++) {
      ctx.beginPath()
      let px = cx + (rng() * 2 - 1) * st.r * scale * 0.8
      let pyy = py(worldY(i)) - st.r * scale * 0.4
      ctx.moveTo(px, pyy)
      const segs = 4 + Math.floor(rng() * 4)
      for (let k = 0; k < segs; k++) {
        px += (rng() * 2 - 1) * 9
        pyy += 6 + rng() * 8
        ctx.lineTo(px, pyy)
      }
      const hot = softness(st.temp)
      ctx.strokeStyle =
        hot > 0.2
          ? `rgba(255,120,60,${Math.min(0.9, st.cracks * (0.4 + hot * 0.5))})`
          : `rgba(8,6,8,${Math.min(0.85, st.cracks * 0.8)})`
      ctx.lineWidth = 1.1 + st.cracks * 1.6
      ctx.stroke()
    }
  }

  // 纵向玻璃高光（随旋转移动的两条）
  for (const sign of [-1, 1]) {
    const phase = (spinPhase * sign) % (Math.PI * 2)
    const xoff = Math.sin(phase) * 0.8
    if (Math.abs(xoff) > 0.95) continue
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const [, y, r] = outer(i)
      const x = cx + sign * r * (0.35 + xoff * 0.35)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.13)'
    ctx.lineWidth = 7
    ctx.lineCap = 'round'
    ctx.stroke()
  }
  ctx.restore()

  // 口沿椭圆（最顶端前后两半）
  {
    const [, y, r] = outer(n - 1)
    const z = zy(s[n - 1].r)
    const [rc, gc, bc] = glassColor(s[n - 1].temp)
    ctx.strokeStyle = `rgb(${rc | 0},${gc | 0},${bc | 0})`
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.ellipse(cx, y, r, z, 0, 0, Math.PI * 2)
    ctx.stroke()
  }

  // 轮廓线
  ctx.beginPath()
  traceOuter(1)
  ctx.moveTo(cx - s[0].r * scale, py(0))
  for (let i = 1; i < n; i++) {
    const [, y, r] = outer(i)
    ctx.lineTo(cx - r, y)
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.lineWidth = 1.5
  ctx.stroke()

  // 工具头光标
  if (rs.pointerActive) {
    const y = bottomY - input.y * glass.elongation * scale
    const x = cx + input.x * scale * 0.85
    const active = input.pressure > 0
    ctx.save()
    ctx.translate(x, y)
    const color = {
      flame: '#ff8a3c',
      blow: '#8fd0ff',
      pull: '#b78bff',
      marver: '#9aa7b4',
      cool: '#7ce8d8'
    }[input.tool]
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.globalAlpha = active ? 0.95 : 0.5
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.arc(0, 0, 13 + (active ? Math.sin(time * 18) * 2 : 0), 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.font = '12px sans-serif'
    ctx.fillText(TOOL_LABELS[input.tool], 18, 4)
    ctx.restore()
  }
}

/** 离屏缩略图（快照 / 分镜用） */
export function drawThumbnail(
  glass: Glass,
  input: FrameInput,
  metrics: GlassMetrics,
  size = 240
): string {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = Math.round(size * 0.82)
  const ctx = canvas.getContext('2d')!
  drawScene(ctx, canvas.width, canvas.height, {
    glass,
    input,
    metrics,
    time: 0,
    pointerActive: false
  })
  return canvas.toDataURL('image/png')
}
