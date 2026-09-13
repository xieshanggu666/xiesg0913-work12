import type { FrameInput } from '@shared/types'
import {
  R_MAX,
  R_MIN,
  T_ANNEAL,
  T_BRITTLE,
  T_MAX,
  T_MIN,
  T_ROOM,
  T_SOFT_HI,
  STRESS_CRACK
} from './constants'
import {
  diffuse1d,
  influenceWeights,
  smoothHotRadius,
  softness,
  type Glass
} from './geometry'

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v

/** 火焰：高斯局部加热到目标温度；极高温会催生气泡核 */
export function applyFlame(g: Glass, input: FrameInput, dt: number): void {
  const { temperature } = input.params
  const w = influenceWeights(g, input.y, 0.16)
  const s = g.stations
  for (let i = 0; i < s.length; i++) {
    const k = w[i] * input.pressure * dt * 0.55
    s[i].temp += k * (temperature - s[i].temp)
    if (temperature > 1000 && s[i].temp > 850) {
      s[i].bubbles = Math.min(1, s[i].bubbles + w[i] * input.pressure * dt * 0.012)
    }
  }
}

/** 吹管：热区像气球一样膨胀、拉薄壁并放大气泡；靠近口沿时把瓶口吹开外翻 */
export function applyBlow(g: Glass, input: FrameInput, dt: number): void {
  const w = influenceWeights(g, input.y, 0.12)
  const n = g.stations.length
  const spinFactor = 1 + (input.params.spin / 120) * 0.3
  // 满压持续约 10 秒，焦点半径约增大 3 倍
  const base = input.pressure * input.params.blowPressure * 0.2 * spinFactor * dt
  // 口沿吹开：只在吹口对准顶端（y > 0.86）时发生，严格局限于最顶几站
  const rimGate = Math.max(0, Math.min(1, (input.y - 0.86) / 0.1)) ** 2 * input.pressure

  for (let i = 0; i < n; i++) {
    const st = g.stations[i]
    const soft = softness(st.temp)
    const e = w[i] * soft * base
    if (e > 0) {
      st.r *= 1 + e * 0.9
      st.thickness *= 1 - e * 0.85
      st.bubbles = Math.min(1, st.bubbles + e * 0.12)
    }

    const k = n - 1 - i
    const rimOpen = rimGate * soft * Math.exp(-k / 1.35) * base * 1.5
    if (rimOpen > 0) {
      st.r *= 1 + rimOpen
      st.thickness *= 1 - rimOpen * 0.45
    }
  }
}

/** 拉制：在热区收窄颈肩，同时整件沿轴向伸长；冷区硬拉会留应力 */
export function applyPull(g: Glass, input: FrameInput, dt: number): void {
  const w = influenceWeights(g, input.y, 0.09)
  const amount = input.pressure * input.params.pullForce * 0.34 * dt
  const s = g.stations
  const n = s.length
  let weightedSoft = 0
  for (let i = 0; i < n; i++) {
    const soft = softness(s[i].temp)
    weightedSoft += w[i] * soft
    const inward = w[i] * soft * amount
    s[i].r *= 1 - inward
    s[i].thickness *= 1 - inward * 0.6
    // 对冷玻璃强行施力：形变很小，但把应力“锁”进玻璃
    s[i].stress += w[i] * (1 - soft) * amount * 140
  }
  // 权重取平均：gaussian 权重和随站点数变化，不能直接求和
  g.elongation = Math.min(2.2, g.elongation + (weightedSoft / n) * amount * 0.5)
}

/** 炭铲：在工作台上挤压整形，压灭气泡；金属接触带走热量，淬冷会留下热冲击应力 */
export function applyMarver(g: Glass, input: FrameInput, dt: number): void {
  const w = influenceWeights(g, input.y, 0.12)
  const s = g.stations
  for (let i = 0; i < s.length; i++) {
    const soft = softness(s[i].temp)
    const press = w[i] * input.pressure * soft * dt * 0.35
    const dr = s[i].r * press
    s[i].r -= dr
    // 压下的材料堆进壁厚
    s[i].thickness = Math.min(T_MAX, s[i].thickness + dr * 0.5)
    s[i].bubbles = Math.max(0, s[i].bubbles - w[i] * input.pressure * soft * dt * 0.4)
    s[i].temp -= w[i] * input.pressure * 95 * dt
  }
}

/** 风冷：定点快速降温。把炽热玻璃直接吹过敏感温区是裂纹的主要来源 */
export function applyCool(g: Glass, input: FrameInput, dt: number): void {
  const w = influenceWeights(g, input.y, 0.14)
  const s = g.stations
  for (let i = 0; i < s.length; i++) {
    s[i].temp -= w[i] * input.pressure * 260 * dt
  }
}

/**
 * 环境步：轴向导热、空气对流、热冲击应力、退火松弛、
 * 裂纹扩展、气泡逸出、离心微鼓、形状平滑。
 * @param tempsBeforeTool 工具作用前的温度，用于统计局部骤冷量
 */
export function applyAmbient(
  g: Glass,
  dt: number,
  spin: number,
  tempsBeforeTool: number[]
): void {
  const s = g.stations
  const n = s.length

  // 1. 沿母线的轴向导热（玻璃导热慢，作用应保持局部）
  const temps = s.map((st) => st.temp)
  diffuse1d(temps, 0.008)
  for (let i = 0; i < n; i++) s[i].temp = temps[i]

  const spinNorm = spin / 120

  for (let i = 0; i < n; i++) {
    const st = s[i]

    // 2. 向空气散热
    st.temp += (T_ROOM - st.temp) * 0.028 * dt

    // 3. 热冲击：局部骤冷且玻璃正处在脆裂温区时累积应力
    const cooled = Math.max(0, tempsBeforeTool[i] - st.temp)
    if (cooled > 0.5) {
      const band = Math.exp(-((st.temp - T_BRITTLE) ** 2) / (2 * 130 ** 2))
      const quench = clamp(cooled / 100, 0, 1.6)
      st.stress += cooled * band * quench * 1.4
    }

    // 4. 退火：高于退火点时残余应力快速松弛
    if (st.temp > T_ANNEAL) {
      const rel = clamp((st.temp - T_ANNEAL) / (T_SOFT_HI - T_ANNEAL), 0, 1)
      st.stress *= 1 - 2.4 * rel * dt
    }

    // 5. 应力超限 → 裂纹扩展，同时裂纹释放部分应力
    if (st.stress > STRESS_CRACK && st.cracks < 1) {
      const grow = ((st.stress - STRESS_CRACK) / STRESS_CRACK) * dt * 0.25
      st.cracks = Math.min(1, st.cracks + grow)
      st.stress -= grow * 50
    }

    // 6. 高温 + 旋转：小气泡向表面逸出
    const soft = softness(st.temp)
    if (soft > 0) st.bubbles *= 1 - spinNorm * 0.55 * soft * dt

    // 7. 高速旋转的离心作用让热熔玻璃微微外鼓
    if (soft > 0) st.r *= 1 + spinNorm * spinNorm * soft * dt * 0.035
  }

  // 8. 表面张力式平滑（仅热玻璃）+ 限位
  smoothHotRadius(g, 0.05)
  for (const st of s) {
    st.r = clamp(st.r, R_MIN, R_MAX)
    st.thickness = clamp(st.thickness, T_MIN, T_MAX)
    st.temp = clamp(st.temp, T_ROOM, 1250)
    st.stress = Math.max(0, st.stress)
    st.bubbles = clamp(st.bubbles, 0, 1)
    st.cracks = clamp(st.cracks, 0, 1)
    // 壁厚不能超过外径（内壁不能穿过中轴）
    st.thickness = Math.min(st.thickness, st.r * 0.95)
  }
}
