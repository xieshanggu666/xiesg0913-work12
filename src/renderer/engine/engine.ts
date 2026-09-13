import type { FrameInput, SimParams, ToolId, TrajFrame } from '@shared/types'
import { FIXED_DT, MAX_TRAJ } from './constants'
import {
  avg,
  cloneGlass,
  createGlass,
  fromGlassJSON,
  toGlassJSON,
  type Glass,
  type GlassSnapshot
} from './geometry'
import {
  applyAmbient,
  applyBlow,
  applyCool,
  applyFlame,
  applyMarver,
  applyPull
} from './tools'

export const DEFAULT_PARAMS: SimParams = {
  temperature: 950,
  spin: 60,
  pullForce: 0.55,
  blowPressure: 0.55
}

export const DEFAULT_INPUT: FrameInput = {
  tool: 'flame',
  y: 0.5,
  x: 0,
  pressure: 0,
  params: { ...DEFAULT_PARAMS }
}

export interface GlassMetrics {
  avgTemp: number
  avgThickness: number
  avgBubbles: number
  maxStress: number
  maxCracks: number
  isRuined: boolean
  /** 瓶口半径：母线最顶端 */
  rimRadius: number
  /** 最窄处（瓶颈）半径 */
  neckRadius: number
  /** 最宽处（瓶腹）半径 */
  bodyRadius: number
  elongation: number
  /** 成型判定：收口 + 鼓腹 + 无贯穿裂纹 */
  isVase: boolean
}

/** 对整件应用一个固定步长 */
export function stepGlass(g: Glass, input: FrameInput, dt: number = FIXED_DT): void {
  const tempsBefore = g.stations.map((st) => st.temp)
  if (input.pressure > 0) {
    switch (input.tool) {
      case 'flame':
        applyFlame(g, input, dt)
        break
      case 'blow':
        applyBlow(g, input, dt)
        break
      case 'pull':
        applyPull(g, input, dt)
        break
      case 'marver':
        applyMarver(g, input, dt)
        break
      case 'cool':
        applyCool(g, input, dt)
        break
    }
  }
  applyAmbient(g, dt, input.params.spin, tempsBefore)
}

export function measure(g: Glass): GlassMetrics {
  const s = g.stations
  const n = s.length
  const rimRadius = s[n - 1].r
  const bodyRadius = Math.max(...s.map((st) => st.r))
  // 瓶颈取顶部 1/3 区间最窄处
  const neckRadius = Math.min(...s.slice(Math.floor(n * 0.6)).map((st) => st.r))
  const maxCracks = Math.max(...s.map((st) => st.cracks))
  const isVase =
    rimRadius > neckRadius * 1.25 &&
    bodyRadius > rimRadius * 1.15 &&
    g.elongation > 1.12 &&
    maxCracks < 0.4
  return {
    avgTemp: avg(s, (st) => st.temp),
    avgThickness: avg(s, (st) => st.thickness),
    avgBubbles: avg(s, (st) => st.bubbles),
    maxStress: Math.max(...s.map((st) => st.stress)),
    maxCracks,
    isRuined: maxCracks >= 1,
    rimRadius,
    neckRadius,
    bodyRadius,
    elongation: g.elongation,
    isVase
  }
}

export class Engine {
  glass: Glass
  input: FrameInput = { ...DEFAULT_INPUT, params: { ...DEFAULT_PARAMS } }
  time = 0
  traj: TrajFrame[] = []
  private trajMaxBytes = 0
  private replayFrames: TrajFrame[] | null = null
  private replayIndex = 0
  /** 回放暂停中（拖动定位 / 单帧步进会进入暂停） */
  replayPaused = false
  /** 回放速度倍率（0.5 / 1 / 2 / 4） */
  replaySpeed = 1
  /** 速度倍率的帧推进累加器：1× 时每个固定步长推进一帧 */
  private replayAcc = 0
  onReplayEnd: (() => void) | null = null

  constructor(glass?: Glass) {
    this.glass = glass ?? createGlass()
  }

  setTool(tool: ToolId): void {
    this.input.tool = tool
  }

  setParams(patch: Partial<SimParams>): void {
    Object.assign(this.input.params, patch)
  }

  setPointer(x: number, y: number): void {
    this.input.x = x
    this.input.y = y
  }

  setPressure(p: number): void {
    this.input.pressure = Math.max(0, Math.min(1, p))
  }

  get isReplaying(): boolean {
    return this.replayFrames !== null
  }

  /** 已回放的帧数（时间轴当前帧） */
  get replayFrame(): number {
    return this.replayIndex
  }

  /** 回放总帧数；非回放状态返回 0 */
  get replayLength(): number {
    return this.replayFrames?.length ?? 0
  }

  /** 已播到最后一帧（停在末帧不退出回放，可拖回任意位置） */
  get replayAtEnd(): boolean {
    return this.replayFrames !== null && this.replayIndex >= this.replayFrames.length
  }

  /** 0..1 的回放进度；非回放状态返回 0 */
  get replayProgressValue(): number {
    if (!this.replayFrames || this.replayFrames.length === 0) return 0
    return this.replayIndex / this.replayFrames.length
  }

  /** 固定步长推进；返回当前活跃输入 */
  tick(): FrameInput {
    if (this.replayFrames) {
      if (!this.replayPaused) {
        // 速度倍率按帧单位累加：1× 每个固定步长一帧（避开浮点步长误差）
        this.replayAcc += this.replaySpeed
        // 单步最多补 8 帧，与 Stage 的追帧上限配合防止卡顿螺旋
        let guard = 0
        while (this.replayAcc >= 1 && this.replayFrames && guard < 8) {
          this.replayAcc -= 1
          this.applyReplayFrame()
          guard++
        }
      }
      return this.input
    }

    const recorded: FrameInput = structuredCloneSafe(this.input)
    stepGlass(this.glass, recorded, FIXED_DT)
    this.time += FIXED_DT
    if (this.time < MAX_TRAJ) {
      this.traj.push({ dt: FIXED_DT, input: recorded })
      // 粗略内存保险（每帧约 200 字节），过大时丢弃最旧部分
      this.trajMaxBytes += 200
      if (this.trajMaxBytes > 24_000_000) this.trimTraj()
    }
    return this.input
  }

  private trimTraj(): void {
    this.traj.splice(0, Math.floor(this.traj.length / 2))
    this.trajMaxBytes = 0
  }

  /** 顺序施加一帧回放；播到末帧时停在末帧（不退出回放），便于拖动回任意位置 */
  private applyReplayFrame(): void {
    const frames = this.replayFrames
    if (!frames) return
    const f = frames[this.replayIndex]
    if (!f) return
    this.input = structuredCloneSafe(f.input)
    this.replayIndex++
    stepGlass(this.glass, this.input, f.dt)
    this.time += f.dt
    if (this.replayIndex >= frames.length) {
      this.replayPaused = true
      this.replayAcc = 0
      this.input.pressure = 0
      this.onReplayEnd?.()
    }
  }

  /**
   * 拖动定位到第 index 帧（0 = 料泡，replayLength = 末帧）。
   * 仿真确定：回退时从料泡重新施加前 index 帧，结果与顺序播放到该帧一致。
   */
  seekReplay(index: number): void {
    const frames = this.replayFrames
    if (!frames) return
    const target = Math.max(0, Math.min(frames.length, Math.round(index)))
    if (target < this.replayIndex) {
      this.glass = createGlass()
      this.time = 0
      this.replayIndex = 0
      this.input = { ...DEFAULT_INPUT, params: { ...DEFAULT_PARAMS } }
    }
    while (this.replayIndex < target) {
      const f = frames[this.replayIndex]
      this.input = structuredCloneSafe(f.input)
      this.replayIndex++
      stepGlass(this.glass, this.input, f.dt)
      this.time += f.dt
    }
    if (this.replayIndex >= frames.length) {
      this.replayPaused = true
      this.input.pressure = 0
    }
    this.replayAcc = 0
  }

  /** 单帧步进（自动暂停）：delta 为 ±1 等整数帧数，越界自动钳制 */
  stepReplay(delta: number): void {
    if (!this.replayFrames) return
    this.replayPaused = true
    this.seekReplay(this.replayIndex + delta)
  }

  pauseReplay(): void {
    this.replayPaused = true
  }

  /** 继续播放；已停在末帧时从头再播一遍 */
  resumeReplay(): void {
    if (!this.replayFrames) return
    if (this.replayIndex >= this.replayFrames.length) this.seekReplay(0)
    this.replayPaused = false
  }

  setReplaySpeed(v: number): void {
    if (!Number.isFinite(v)) return
    this.replaySpeed = Math.max(0.1, Math.min(8, v))
  }

  startReplay(frames?: TrajFrame[]): void {
    this.replayFrames = frames ?? this.traj
    this.replayIndex = 0
    this.replayPaused = false
    this.replayAcc = 0
  }

  /**
   * 载入外部轨迹（如导入的 JSON 文件）：回到料泡从头回放，
   * 同时把帧序列保留为当前轨迹，回放结束后可再次回放 / 导出。
   */
  loadTrajectory(frames: TrajFrame[]): void {
    this.reset()
    this.traj = frames.slice()
    this.startReplay(frames)
  }

  cancelReplay(): void {
    this.replayFrames = null
    this.replayPaused = false
    this.replayAcc = 0
    this.input.pressure = 0
  }

  clearTraj(): void {
    this.traj = []
    this.trajMaxBytes = 0
    this.time = 0
  }

  reset(): void {
    this.glass = createGlass()
    this.time = 0
    this.traj = []
    this.trajMaxBytes = 0
    this.replayFrames = null
    this.replayIndex = 0
    this.replayPaused = false
    this.replayAcc = 0
    this.input = { ...DEFAULT_INPUT, params: { ...DEFAULT_PARAMS } }
  }

  snapshot(): GlassSnapshot {
    return JSON.parse(toGlassJSON(this.glass)) as GlassSnapshot
  }

  restore(snap: GlassSnapshot): void {
    this.glass = fromGlassJSON(JSON.stringify(snap))
  }

  cloneGlassState(): Glass {
    return cloneGlass(this.glass)
  }

  metrics(): GlassMetrics {
    return measure(this.glass)
  }
}

/** structuredClone 在所有目标环境可用，但输入里含的都是普通对象 */
function structuredCloneSafe<T>(v: T): T {
  return structuredClone(v)
}
