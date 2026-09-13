import { N_STATIONS, R_SPHERE, T_MAX, T_SOFT_HI, T_SOFT_LO } from './constants'

/** 一个剖面站点：花瓶母线在该高度上的全部状态 */
export interface Station {
  /** 外轮廓半径（世界坐标，1 ≈ 画布高度的 1/3） */
  r: number
  /** 壁厚 */
  thickness: number
  /** 当前玻璃温度 ℃ */
  temp: number
  /** 残余应力 0..，超过阈值萌生裂纹 */
  stress: number
  /** 气泡含量 0..1（内部小泡密度） */
  bubbles: number
  /** 裂纹量 0..1（0 完好，1 贯穿报废） */
  cracks: number
}

export interface Glass {
  stations: Station[]
  /** 母线在 y 方向的累计伸长系数（拉制工具产生） */
  elongation: number
}

/** 可序列化的快照（Float64Array 不能结构化克隆，转普通数组） */
export interface GlassSnapshot {
  n: number
  r: number[]
  thickness: number[]
  temp: number[]
  stress: number[]
  bubbles: number[]
  cracks: number[]
  elongation: number
}

/** 站点的归一化高度（0 = 底，1 = 顶），等间距 */
export function ys(n = N_STATIONS): number[] {
  return Array.from({ length: n }, (_, i) => i / (n - 1))
}

/** 从一团熔融玻璃球开始 */
export function createGlass(n = N_STATIONS, temp = 900): Glass {
  const stations: Station[] = []
  for (const y of ys(n)) {
    // 球体纵剖面：r = sqrt(R² - (y-½)²)，两端收成小颈
    const dy = (y - 0.5) * 2 * R_SPHERE
    let r = Math.sqrt(Math.max(R_SPHERE * R_SPHERE - dy * dy, 0))
    // 两端压出收颈（顶是吹管口、底是料泡尖），保证半径永不退化到 0
    r = Math.max(r, 0.06)
    const thickness = Math.min(T_MAX, r * 0.82)
    stations.push({ r, thickness, temp, stress: 0, bubbles: 0.12, cracks: 0 })
  }
  return { stations, elongation: 1 }
}

export function cloneGlass(g: Glass): Glass {
  return {
    elongation: g.elongation,
    stations: g.stations.map((s) => ({ ...s }))
  }
}

export function snapshotGlass(g: Glass): GlassSnapshot {
  const n = g.stations.length
  const pick = (k: keyof Station): number[] => g.stations.map((s) => round(s[k] as number))
  return {
    n,
    r: pick('r'),
    thickness: pick('thickness'),
    temp: pick('temp'),
    stress: pick('stress'),
    bubbles: pick('bubbles'),
    cracks: pick('cracks'),
    elongation: round(g.elongation)
  }
}

export function restoreGlass(snap: GlassSnapshot): Glass {
  const stations: Station[] = []
  for (let i = 0; i < snap.n; i++) {
    stations.push({
      r: snap.r[i],
      thickness: snap.thickness[i],
      temp: snap.temp[i],
      stress: snap.stress[i],
      bubbles: snap.bubbles[i],
      cracks: snap.cracks[i]
    })
  }
  return { stations, elongation: snap.elongation }
}

export function toGlassJSON(g: Glass): string {
  return JSON.stringify(snapshotGlass(g))
}

export function fromGlassJSON(json: string): Glass {
  return restoreGlass(JSON.parse(json) as GlassSnapshot)
}

/**
 * 高斯影响权重：工具沿母线做局部作用。
 * 玻璃越软，热量/形变越容易沿轴向扩散，sigma 随温度变大。
 */
export function influenceWeights(g: Glass, focusY: number, baseSigma: number): number[] {
  const n = g.stations.length
  const out = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const y = i / (n - 1)
    const soft = softness(g.stations[i].temp)
    const sigma = baseSigma * (0.8 + soft * 0.7)
    const d = (y - focusY) / sigma
    out[i] = Math.exp(-0.5 * d * d)
  }
  return out
}

/** 0(冷硬) .. 1(熔融) 的可塑性 */
export function softness(temp: number): number {
  if (temp <= T_SOFT_LO) return 0
  if (temp >= T_SOFT_HI) return 1
  return (temp - T_SOFT_LO) / (T_SOFT_HI - T_SOFT_LO)
}

export function avg<T>(arr: T[], pick: (v: T) => number): number {
  return arr.reduce((acc, v) => acc + pick(v), 0) / arr.length
}

/** 一维最近邻扩散（轴向导热 / 平滑） */
export function diffuse1d(values: number[], k: number): void {
  if (values.length < 3) return
  const prev = values.slice()
  for (let i = 1; i < values.length - 1; i++) {
    values[i] += k * (prev[i - 1] + prev[i + 1] - 2 * prev[i])
  }
}

/** 表面张力式平滑：只有还软的玻璃会流动，冷玻璃形状锁死 */
export function smoothHotRadius(g: Glass, k: number): void {
  const s = g.stations
  const prev = s.map((st) => st.r)
  for (let i = 1; i < s.length - 1; i++) {
    const w = softness(s[i].temp) * k
    s[i].r += w * (prev[i - 1] + prev[i + 1] - 2 * prev[i])
  }
}

export function round(v: number): number {
  return Math.round(v * 1e5) / 1e5
}
