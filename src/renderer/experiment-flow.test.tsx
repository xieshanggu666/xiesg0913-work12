// @vitest-environment jsdom
/**
 * DOM 级验证：工艺实验入口与“条件 → 双臂运行 → 结果 → 保存结论”完整流程。
 * canvas 2D 在 jsdom 中不可用，缩略图生成被 mock 为固定 dataURL。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('./engine/render', () => ({
  drawThumbnail: () => 'data:image/png;base64,stub'
}))
// Stage 依赖 canvas 渲染循环，本测试不涉及
vi.mock('./components/Stage', () => ({ Stage: () => null }))

import App from './App'
import { useStudio } from './state/store'

const lsData = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => lsData.get(k) ?? null,
  setItem: (k: string, v: string) => {
    lsData.set(k, String(v))
  },
  removeItem: (k: string) => {
    lsData.delete(k)
  },
  clear: () => lsData.clear()
})

;(globalThis as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true

async function flushAsync(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(text)
  )
  if (!btn) throw new Error(`找不到按钮「${text}」`)
  return btn
}

function setInput(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/** 往 store 的引擎里录一段火焰轨迹 */
function recordTrajectory(frames = 90): void {
  const e = useStudio.getState().engine
  e.reset()
  for (let i = 0; i < frames; i++) {
    e.setTool('flame')
    e.setPointer(0, 0.5)
    e.setPressure(0.8)
    e.setParams({ temperature: 900, spin: 60, pullForce: 0.5, blowPressure: 0.5 })
    e.tick()
  }
}

describe('工艺实验入口与完整流程（DOM 级）', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    vi.useFakeTimers()
    lsData.clear()
    useStudio.getState().resetGlass()
    await act(async () => {
      await useStudio.getState().refreshExperiments()
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root.render(<App />)
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  it('没有轨迹时入口给出提示，不弹窗', async () => {
    act(() => findButton(container, '以当前轨迹发起实验').click())
    await flushAsync()
    expect(container.querySelector('.exp-dialog')).toBeNull()
    expect(useStudio.getState().toast).toContain('没有可作为基准的成形轨迹')
  })

  it('设置区间与旋钮 → 双臂运行 → 展示器形 / 差值表 / 报废判定 → 保存条件结果结论', async () => {
    recordTrajectory()
    act(() => findButton(container, '以当前轨迹发起实验').click())
    await flushAsync()

    let dialog = container.querySelector('.exp-dialog')
    expect(dialog).not.toBeNull()

    // 默认全区间；改成第 10–60 帧
    const nums = dialog!.querySelectorAll('input[type="number"]')
    expect(nums).toHaveLength(2)
    setInput(nums[0] as HTMLInputElement, '10')
    setInput(nums[1] as HTMLInputElement, '60')

    // 选择“旋转速度”旋钮并把实验值拉到 100
    act(() => findButton(container, '旋转速度').click())
    const range = dialog!.querySelector('input[type="range"]') as HTMLInputElement
    setInput(range, '100')

    // 双臂运行（setTimeout(30) 在 fake timer 下需手动推进）
    act(() => findButton(container, '分别运行').click())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    await flushAsync()

    // 结果页：两张器形缩略图 + 九项指标差值 + 报废行 + 结论输入
    const imgs = container.querySelectorAll('.exp-arm img')
    expect(imgs).toHaveLength(2)
    const rows = container.querySelectorAll('.exp-table tbody tr')
    expect(rows).toHaveLength(10)
    expect(container.textContent).toContain('是否报废')
    const textarea = container.querySelector('.exp-conclusion textarea') as HTMLTextAreaElement
    expect(textarea).toBeTruthy()
    setInput(textarea, '转速提高后器形更均匀')

    act(() => findButton(container, '保存实验').click())
    await flushAsync()

    // 弹窗关闭，实验进入右栏列表并落库
    expect(container.querySelector('.exp-dialog')).toBeNull()
    const list = useStudio.getState().experiments
    expect(list).toHaveLength(1)
    expect(list[0].record.conclusion).toBe('转速提高后器形更均匀')
    expect(list[0].condition.fromFrame).toBe(10)
    expect(list[0].condition.toFrame).toBe(60)
    expect(list[0].condition.param).toBe('spin')
    expect(list[0].condition.value).toBe(100)
    // 实验只读复制轨迹：当前作品轨迹未被改写
    expect(useStudio.getState().engine.traj).toHaveLength(90)
    const stored = JSON.parse(lsData.get('glass-forge:experiments') ?? '[]') as unknown[]
    expect(stored).toHaveLength(1)
  })

  it('小数起始帧不会让实时预览崩溃，运行时按取整帧执行', async () => {
    recordTrajectory()
    act(() => findButton(container, '以当前轨迹发起实验').click())
    await flushAsync()
    expect(container.querySelector('.exp-dialog')).not.toBeNull()

    const nums = container.querySelectorAll('.exp-field input[type="number"]')
    // 直接键入小数 / 越界值：实时基准取值预览原本会读 frames[10.5] 抛异常
    expect(() => {
      setInput(nums[0] as HTMLInputElement, '10.5')
      setInput(nums[1] as HTMLInputElement, '60.9')
      setInput(nums[0] as HTMLInputElement, '-3')
      setInput(nums[0] as HTMLInputElement, '12.7')
    }).not.toThrow()
    // 输入框状态已取整钳制
    expect((nums[0] as HTMLInputElement).value).toBe('12')
    expect((nums[1] as HTMLInputElement).value).toBe('60')
    // 基准取值提示仍在渲染（预览没有被异常打断）
    expect(container.textContent).toContain('区间内基准取值')

    act(() => findButton(container, '分别运行').click())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    await flushAsync()

    act(() => findButton(container, '保存实验').click())
    await flushAsync()

    const saved = useStudio.getState().experiments[0].condition
    expect(saved.fromFrame).toBe(12)
    expect(saved.toFrame).toBe(60)
  })

  it('已保存实验可查看对照并修改结论；删除需二次确认', async () => {
    recordTrajectory()
    const e = useStudio.getState().engine
    const { buildExperimentCondition, runExperiment } = await import('./engine/experiment')
    const cond = buildExperimentCondition(e.traj.slice(), {
      param: 'temperature',
      value: 1100,
      fromFrame: 0,
      toFrame: 90
    })
    await act(async () => {
      await useStudio.getState().saveExperimentResult({
        name: '保温实验',
        condition: cond,
        outcome: runExperiment(e.traj.slice(), cond),
        baselineThumb: 'data:,b',
        variantThumb: 'data:,v',
        conclusion: '初始结论'
      })
    })

    act(() => findButton(container, '查看对照').click())
    await flushAsync()
    expect(container.querySelector('.exp-dialog')).not.toBeNull()
    expect(container.textContent).toContain('保温实验')

    const textarea = container.querySelector('.exp-conclusion textarea') as HTMLTextAreaElement
    setInput(textarea, '修改后的结论')
    await flushAsync()

    act(() => findButton(container, '保存结论').click())
    await flushAsync()
    expect(useStudio.getState().experiments[0].record.conclusion).toBe('修改后的结论')

    act(() => findButton(container, '✕').click())
    await flushAsync()

    // 列表删除二次确认
    act(() => findButton(container, '删除').click())
    await flushAsync()
    expect(useStudio.getState().experiments).toHaveLength(1)
    act(() => findButton(container, '确认删除').click())
    await flushAsync()
    expect(useStudio.getState().experiments).toHaveLength(0)
  })

  it('弹窗中的删除入口同样需要二次确认：取消 / 超时不删，确认才删并关闭弹窗', async () => {
    recordTrajectory()
    const e = useStudio.getState().engine
    const { buildExperimentCondition, runExperiment } = await import('./engine/experiment')
    const cond = buildExperimentCondition(e.traj.slice(), {
      param: 'temperature',
      value: 1100,
      fromFrame: 0,
      toFrame: 90
    })
    await act(async () => {
      await useStudio.getState().saveExperimentResult({
        name: '保温实验',
        condition: cond,
        outcome: runExperiment(e.traj.slice(), cond),
        baselineThumb: 'data:,b',
        variantThumb: 'data:,v',
        conclusion: ''
      })
    })

    const openViewer = async (): Promise<void> => {
      act(() => findButton(container, '查看对照').click())
      await flushAsync()
      expect(container.querySelector('.exp-dialog')).not.toBeNull()
    }

    // 点「删除实验」只进入确认态，记录与弹窗都还在
    await openViewer()
    act(() => findButton(container, '删除实验').click())
    await flushAsync()
    expect(findButton(container, '确认删除')).toBeTruthy()
    expect(findButton(container, '取消')).toBeTruthy()
    expect(useStudio.getState().experiments).toHaveLength(1)

    // 点取消：不删除，回到普通按钮态
    act(() => findButton(container, '取消').click())
    await flushAsync()
    expect(useStudio.getState().experiments).toHaveLength(1)
    expect(findButton(container, '删除实验')).toBeTruthy()

    // 再次进入确认态后等待 5 秒以上：自动还原，不删除
    act(() => findButton(container, '删除实验').click())
    expect(findButton(container, '确认删除')).toBeTruthy()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    await flushAsync()
    expect(useStudio.getState().experiments).toHaveLength(1)
    expect(findButton(container, '删除实验')).toBeTruthy()

    // 确认删除：真正移除并关闭弹窗
    act(() => findButton(container, '删除实验').click())
    act(() => findButton(container, '确认删除').click())
    await flushAsync()
    expect(useStudio.getState().experiments).toHaveLength(0)
    expect(container.querySelector('.exp-dialog')).toBeNull()
  })
})

/* ---------- 实验列表的筛选 / 排序（直接构造已持久化记录） ---------- */

function seedExperimentRecord(over: {
  id: number
  name: string
  created_at: number
  param: string
  conclusion?: string
  variantMetrics: Record<string, unknown>
}): void {
  const condition = {
    baselineFrames: 90,
    fromFrame: 0,
    toFrame: 90,
    param: over.param,
    value: 900,
    baselineValues: new Array(90).fill(900)
  }
  const vaseMetrics = {
    avgTemp: 400,
    avgThickness: 0.1,
    avgBubbles: 0,
    maxStress: 0,
    maxCracks: 0,
    rimRadius: 0.2,
    neckRadius: 0.15,
    bodyRadius: 0.5,
    elongation: 1.2
  }
  const record = {
    id: over.id,
    name: over.name,
    created_at: over.created_at,
    condition_json: JSON.stringify(condition),
    outcome_json: JSON.stringify({
      baseline: { metrics: { ...vaseMetrics, isRuined: false, isVase: true } },
      variant: { metrics: { ...vaseMetrics, ...over.variantMetrics } },
      ruinedChanged: false
    }),
    baseline_thumb: 'data:,b',
    variant_thumb: 'data:,v',
    conclusion: over.conclusion ?? ''
  }
  const raw = JSON.parse(lsData.get('glass-forge:experiments') ?? '[]') as unknown[]
  raw.push(record)
  lsData.set('glass-forge:experiments', JSON.stringify(raw))
}

const VASE = { isRuined: false, isVase: true }
const FORMING = { isRuined: false, isVase: false }
const RUINED = { isRuined: true, isVase: false }

function seedFourExperiments(): void {
  seedExperimentRecord({
    id: 1,
    name: '保温成型实验',
    created_at: 1000,
    param: 'temperature',
    conclusion: '高温保温后成型良好',
    variantMetrics: VASE
  })
  seedExperimentRecord({
    id: 2,
    name: '高速旋转实验',
    created_at: 2000,
    param: 'spin',
    conclusion: '气泡更少',
    variantMetrics: VASE
  })
  seedExperimentRecord({
    id: 3,
    name: '强风报废实验',
    created_at: 3000,
    param: 'blowPressure',
    conclusion: '直接吹过脆裂温区',
    variantMetrics: RUINED
  })
  seedExperimentRecord({
    id: 4,
    name: '拉伸成形对照',
    created_at: 4000,
    param: 'pullForce',
    variantMetrics: FORMING
  })
}

function namesInList(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.exp-list .snap-info b')).map((el) => el.textContent ?? '')
}

function selectByLabel(container: HTMLElement, label: string): HTMLSelectElement {
  const sel = container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement | null
  if (!sel) throw new Error(`找不到下拉框「${label}」`)
  return sel
}

function setSelect(sel: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
  setter.call(sel, value)
  sel.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('工艺实验列表：搜索 / 筛选 / 排序（DOM 级）', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    vi.useFakeTimers()
    lsData.clear()
    seedFourExperiments()
    useStudio.getState().resetGlass()
    await act(async () => {
      await useStudio.getState().refreshExperiments()
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root.render(<App />)
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  it('区分“尚无实验”与“筛选无结果”两种提示', async () => {
    // 有 4 条：出现筛选条与匹配数量，不出现引导语
    expect(container.querySelector('.exp-filters')).not.toBeNull()
    expect(container.textContent).toContain('共 4 条实验')
    expect(container.textContent).not.toContain('选一条已有轨迹作为基准')

    // 清空存储后刷新 → 尚无实验：引导语出现，筛选条消失
    lsData.delete('glass-forge:experiments')
    await act(async () => {
      await useStudio.getState().refreshExperiments()
    })
    expect(container.querySelector('.exp-filters')).toBeNull()
    expect(container.textContent).toContain('选一条已有轨迹作为基准')
  })

  it('默认按时间倒序，切到正序后从早到晚', () => {
    expect(namesInList(container)).toEqual(['拉伸成形对照', '强风报废实验', '高速旋转实验', '保温成型实验'])
    act(() => setSelect(selectByLabel(container, '按保存时间排序'), 'asc'))
    expect(namesInList(container)).toEqual(['保温成型实验', '高速旋转实验', '强风报废实验', '拉伸成形对照'])
  })

  it('按名称与结论关键词搜索并显示匹配数量', () => {
    const search = container.querySelector('.exp-search') as HTMLInputElement
    act(() => setInput(search, '保温'))
    expect(namesInList(container)).toEqual(['保温成型实验'])
    expect(container.textContent).toContain('匹配 1 / 共 4 条实验')

    // 命中结论关键词
    act(() => setInput(search, '气泡'))
    expect(namesInList(container)).toEqual(['高速旋转实验'])

    // 多个词同时命中（名称 + 结论）
    act(() => setInput(search, '保温 成型'))
    expect(namesInList(container)).toEqual(['保温成型实验'])

    // 无结果：显示无结果提示而非引导语
    act(() => setInput(search, '不存在的关键词'))
    expect(container.querySelector('.exp-list')).toBeNull()
    expect(container.textContent).toContain('没有符合筛选条件的实验')
    expect(container.textContent).toContain('匹配 0 / 共 4 条实验')
  })

  it('按旋钮类型筛选', () => {
    act(() => setSelect(selectByLabel(container, '按旋钮类型筛选'), 'spin'))
    expect(namesInList(container)).toEqual(['高速旋转实验'])
    expect(container.textContent).toContain('匹配 1 / 共 4 条实验')

    act(() => setSelect(selectByLabel(container, '按旋钮类型筛选'), 'blowPressure'))
    expect(namesInList(container)).toEqual(['强风报废实验'])
  })

  it('按实验结果已成型 / 成形中 / 已报废筛选', () => {
    act(() => setSelect(selectByLabel(container, '按实验结果筛选'), 'vase'))
    expect(namesInList(container)).toEqual(['高速旋转实验', '保温成型实验'])

    act(() => setSelect(selectByLabel(container, '按实验结果筛选'), 'forming'))
    expect(namesInList(container)).toEqual(['拉伸成形对照'])

    act(() => setSelect(selectByLabel(container, '按实验结果筛选'), 'ruined'))
    expect(namesInList(container)).toEqual(['强风报废实验'])
  })

  it('多个条件同时生效取交集', () => {
    const search = container.querySelector('.exp-search') as HTMLInputElement
    act(() => setInput(search, '实验'))
    act(() => setSelect(selectByLabel(container, '按实验结果筛选'), 'vase'))
    act(() => setSelect(selectByLabel(container, '按保存时间排序'), 'asc'))
    // “实验”命中名称的有 3 条，与“已成型”交集为 1、2，正序
    expect(namesInList(container)).toEqual(['保温成型实验', '高速旋转实验'])
    expect(container.textContent).toContain('匹配 2 / 共 4 条实验')
  })

  it('一键清空恢复全部条件（关键词 / 旋钮 / 结果 / 排序）', () => {
    const search = container.querySelector('.exp-search') as HTMLInputElement
    act(() => setInput(search, '实验'))
    act(() => setSelect(selectByLabel(container, '按旋钮类型筛选'), 'spin'))
    act(() => setSelect(selectByLabel(container, '按实验结果筛选'), 'ruined'))
    act(() => setSelect(selectByLabel(container, '按保存时间排序'), 'asc'))
    expect(container.querySelector('.exp-list')).toBeNull()

    const resets = Array.from(container.querySelectorAll('button')).filter(
      (b) => b.textContent?.trim() === '清空筛选条件' && !b.disabled
    )
    expect(resets.length).toBeGreaterThanOrEqual(1)
    act(() => resets[0].click())

    expect(search.value).toBe('')
    expect(selectByLabel(container, '按旋钮类型筛选').value).toBe('')
    expect(selectByLabel(container, '按实验结果筛选').value).toBe('')
    expect(selectByLabel(container, '按保存时间排序').value).toBe('desc')
    expect(namesInList(container)).toHaveLength(4)
    expect(container.textContent).toContain('共 4 条实验')
  })

  it('没有任何生效条件时清空按钮禁用', () => {
    const btn = container.querySelector('.exp-filter-reset') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    const search = container.querySelector('.exp-search') as HTMLInputElement
    act(() => setInput(search, 'x'))
    expect(btn.disabled).toBe(false)
  })
})

/* ---------- 实验列表的分段加载 ---------- */

function findPagerButton(container: HTMLElement, text: string): HTMLButtonElement {
  const nav = container.querySelector('.exp-pager')
  if (!nav) throw new Error('找不到分段导航')
  const btn = Array.from(nav.querySelectorAll('button')).find((b) => b.textContent?.includes(text))
  if (!btn) throw new Error(`找不到分段按钮「${text}」`)
  return btn
}

function seedManyExperiments(count: number): void {
  for (let i = 1; i <= count; i++) {
    // 每 3 条一个“已报废”，便于验证筛选后重新分段
    const status = i % 3 === 0 ? RUINED : VASE
    seedExperimentRecord({
      id: i,
      name: `实验 ${String(i).padStart(2, '0')}`,
      created_at: i * 1000,
      param: 'temperature',
      conclusion: i === 1 ? '含关键词的首条结论' : '',
      variantMetrics: status
    })
  }
}

describe('工艺实验列表：分段加载（DOM 级）', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    vi.useFakeTimers()
    lsData.clear()
    seedManyExperiments(18)
    useStudio.getState().resetGlass()
    await act(async () => {
      await useStudio.getState().refreshExperiments()
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root.render(<App />)
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  it('超过一段时分段渲染，逐段浏览并在末段禁用“下一段”', () => {
    expect(namesInList(container)).toEqual(
      Array.from({ length: 8 }, (_, k) => `实验 ${String(18 - k).padStart(2, '0')}`)
    )
    expect(container.textContent).toContain('共 18 条实验')
    expect(container.textContent).toContain('第 1 / 3 段 · 1–8 / 共 18 条')
    expect(findPagerButton(container, '上一段').disabled).toBe(true)
    expect(findPagerButton(container, '下一段').disabled).toBe(false)

    act(() => findPagerButton(container, '下一段').click())
    expect(namesInList(container)).toEqual(
      Array.from({ length: 8 }, (_, k) => `实验 ${String(10 - k).padStart(2, '0')}`)
    )
    expect(container.textContent).toContain('第 2 / 3 段 · 9–16 / 共 18 条')

    act(() => findPagerButton(container, '下一段').click())
    expect(namesInList(container)).toEqual(['实验 02', '实验 01'])
    expect(container.textContent).toContain('第 3 / 3 段 · 17–18 / 共 18 条')
    expect(findPagerButton(container, '下一段').disabled).toBe(true)

    act(() => findPagerButton(container, '上一段').click())
    expect(namesInList(container)[0]).toBe('实验 10')
    expect(container.textContent).toContain('第 2 / 3 段')
  })

  it('切换筛选 / 排序后自动回到首段，并按命中数重新分段', () => {
    act(() => findPagerButton(container, '下一段').click())
    expect(container.textContent).toContain('第 2 / 3 段')

    // 筛到“已报废”6 条：不足一段，导航消失，从首段展示
    act(() => setSelect(selectByLabel(container, '按实验结果筛选'), 'ruined'))
    expect(container.querySelector('.exp-pager')).toBeNull()
    expect(namesInList(container)).toHaveLength(6)
    expect(namesInList(container)[0]).toBe('实验 18')
    expect(container.textContent).toContain('匹配 6 / 共 18 条实验')

    // 清空条件：仍是首段，恢复 18 条分段
    act(() => {
      const reset = container.querySelector('.exp-filter-reset') as HTMLButtonElement
      reset.click()
    })
    expect(namesInList(container)).toHaveLength(8)
    expect(container.textContent).toContain('第 1 / 3 段')

    // 在末段切换时间正序：同样回到首段，最早的记录排在最前
    act(() => findPagerButton(container, '下一段').click())
    act(() => findPagerButton(container, '下一段').click())
    act(() => setSelect(selectByLabel(container, '按保存时间排序'), 'asc'))
    expect(container.textContent).toContain('第 1 / 3 段')
    expect(namesInList(container)[0]).toBe('实验 01')
  })

  it('删除记录后维持正确的段位置与数量；删掉末段最后一条自动回到有效段', async () => {
    // 停在末段（仅 2 条：实验 02、实验 01）
    act(() => findPagerButton(container, '下一段').click())
    act(() => findPagerButton(container, '下一段').click())
    expect(namesInList(container)).toEqual(['实验 02', '实验 01'])

    // 删掉末段第一条（实验 02）：剩 17 条仍有 3 段，末段剩实验 01
    act(() => {
      const items = container.querySelectorAll('.exp-list > li')
      const delBtn = Array.from(items[0].querySelectorAll('button')).find((b) =>
        b.textContent?.includes('删除')
      ) as HTMLButtonElement
      delBtn.click()
    })
    await flushAsync()
    act(() => findButton(container, '确认删除').click())
    await flushAsync()
    expect(useStudio.getState().experiments).toHaveLength(17)
    expect(container.textContent).toContain('第 3 / 3 段 · 17–17 / 共 17 条')
    expect(namesInList(container)).toEqual(['实验 01'])

    // 再删掉仅剩的实验 01：只剩两段，自动钳回最后一个有效段（第 2 段）
    act(() => findButton(container, '删除').click())
    await flushAsync()
    act(() => findButton(container, '确认删除').click())
    await flushAsync()
    expect(useStudio.getState().experiments).toHaveLength(16)
    expect(container.textContent).toContain('第 2 / 2 段 · 9–16 / 共 16 条')
    expect(namesInList(container)).toHaveLength(8)
  })

  it('保存结论后保持当前段位置与数量（结论改写不影响时间排序）', async () => {
    act(() => findPagerButton(container, '下一段').click())
    expect(container.textContent).toContain('第 2 / 3 段')
    const before = namesInList(container)

    act(() => findButton(container, '查看对照').click())
    await flushAsync()
    const textarea = container.querySelector('.exp-conclusion textarea') as HTMLTextAreaElement
    setInput(textarea, '补记的结论')
    act(() => findButton(container, '保存结论').click())
    await flushAsync()
    act(() => findButton(container, '✕').click())
    await flushAsync()

    expect(useStudio.getState().experiments).toHaveLength(18)
    expect(container.textContent).toContain('第 2 / 3 段 · 9–16 / 共 18 条')
    expect(namesInList(container)).toEqual(before)
  })

  it('保存结论使记录新命中关键词时，首段结果与数量正确刷新', async () => {
    const search = container.querySelector('.exp-search') as HTMLInputElement
    act(() => setInput(search, '含关键词'))
    expect(namesInList(container)).toEqual(['实验 01'])
    expect(container.textContent).toContain('匹配 1 / 共 18 条实验')

    act(() => findButton(container, '查看对照').click())
    await flushAsync()
    const textarea = container.querySelector('.exp-conclusion textarea') as HTMLTextAreaElement
    setInput(textarea, '另写的内容')
    act(() => findButton(container, '保存结论').click())
    await flushAsync()
    act(() => findButton(container, '✕').click())
    await flushAsync()

    // 实验 01 不再命中 → 空态与命中数归零，且不会停在失效页
    expect(container.querySelector('.exp-list')).toBeNull()
    expect(container.textContent).toContain('匹配 0 / 共 18 条实验')
    expect(container.querySelector('.exp-pager')).toBeNull()
  })
})
