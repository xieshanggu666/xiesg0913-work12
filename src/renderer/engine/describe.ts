import { measure, type GlassMetrics } from './engine'
import type { Glass } from './geometry'

/** 快照列表 / 分镜注记共用的玻璃状态概述 */
export interface GlassStatusSummary {
  /** 主状态：已成型 / 成形中 / 已报废 */
  status: string
  /** 配色级别 */
  tone: 'good' | 'plain' | 'bad'
  /** 警示标签：有裂纹 / 多气泡 / 高应力 */
  warnings: string[]
  /** 平均温度 ℃（整数） */
  temp: number
  /** 伸长系数 */
  elongation: number
  /** 一行汇总文本 */
  line: string
}

export function summarizeMetrics(m: GlassMetrics): GlassStatusSummary {
  const status = m.isRuined ? '已报废' : m.isVase ? '已成型' : '成形中'
  const tone: GlassStatusSummary['tone'] = m.isRuined ? 'bad' : m.isVase ? 'good' : 'plain'
  const warnings: string[] = []
  if (m.maxCracks >= 0.4 && !m.isRuined) warnings.push('有裂纹')
  if (m.avgBubbles > 0.25) warnings.push('多气泡')
  if (m.maxStress > 60) warnings.push('高应力')
  const temp = Math.round(m.avgTemp)
  const elongation = Math.round(m.elongation * 100) / 100
  const line = [status, `${temp}℃`, `伸长×${elongation.toFixed(2)}`, ...warnings].join(' · ')
  return { status, tone, warnings, temp, elongation, line }
}

/** 分镜注记用的一句话状态描述 */
export function describeGlass(glass: Glass): string {
  return summarizeMetrics(measure(glass)).line
}
