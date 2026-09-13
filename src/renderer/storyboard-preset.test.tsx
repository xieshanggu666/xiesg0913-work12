// @vitest-environment jsdom
/**
 * DOM 级验证：分镜导出配置预设。
 * 存为预设 / 选择预设恢复作品名、节点勾选状态与队列顺序 / 删除预设；
 * 预设单独持久化，不改写快照内容或右侧快照列表；
 * 当前没有快照时阻止保存无效预设。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// Stage 依赖 canvas 2D，jsdom 不支持；本测试不涉及画布
vi.mock('./components/Stage', () => ({ Stage: () => null }))

// jsdom 无 canvas 2D：缩略图与分镜合成替换为可控实现
vi.mock('./engine/render', async (importActual) => {
  const actual = await importActual<typeof import('./engine/render')>()
  return { ...actual, drawThumbnail: () => 'data:image/png;base64,thumb' }
})

vi.mock('./state/storage', async (importActual) => {
  const actual = await importActual<typeof import('./state/storage')>()
  return {
    ...actual,
    exportStoryboard: async (): Promise<string> => 'data:image/png;base64,board',
    saveStoryboardFile: async (): Promise<string | null> => '/tmp/board.png'
  }
})

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

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(text)
  )
  if (!btn) throw new Error(`找不到按钮「${text}」`)
  return btn
}

/** 让 store 里的 async 动作链（await 存储 / 刷新）走完 */
async function flushAsync(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

/** 通过原生 setter 写值再发事件，触发 React 受控组件的 onChange */
function typeInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function chooseSelect(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
  setter.call(select, value)
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

function boardTitles(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.board-list .board-title')).map(
    (el) => el.textContent ?? ''
  )
}

function boardSeqs(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.board-list .board-seq')).map(
    (el) => el.textContent ?? ''
  )
}

function boardCheckbox(container: HTMLElement, index: number): HTMLInputElement {
  const boxes = container.querySelectorAll<HTMLInputElement>('.board-list input[type="checkbox"]')
  const box = boxes[index]
  if (!box) throw new Error(`找不到第 ${index} 个勾选框`)
  return box
}

function boardMoveButton(container: HTMLElement, row: number, dir: 'up' | 'down'): HTMLButtonElement {
  const rows = container.querySelectorAll('.board-list li .board-moves')
  const group = rows[row]
  if (!group) throw new Error(`找不到第 ${row} 行的移动按钮`)
  return group.querySelectorAll('button')[dir === 'up' ? 0 : 1]
}

function titleInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('.storyboard .snap-form input')
  if (!input) throw new Error('找不到作品名输入框')
  return input
}

function presetSelect(container: HTMLElement): HTMLSelectElement {
  const select = container.querySelector<HTMLSelectElement>('.preset-bar select')
  if (!select) throw new Error('找不到预设下拉框')
  return select
}

function presetNameInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('.preset-bar input')
  if (!input) throw new Error('找不到预设名称输入框')
  return input
}

function presetOptions(container: HTMLElement): string[] {
  return Array.from(presetSelect(container).querySelectorAll('option')).map(
    (o) => o.textContent ?? ''
  )
}

/** 右侧快照列表的标题顺序（新 → 旧） */
function snapTitles(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.snap-list .snap-info b')).map(
    (el) => el.textContent ?? ''
  )
}

/** localStorage 中的快照存储顺序（追加序） */
function storedSnapTitles(): string[] {
  const all = JSON.parse(lsData.get('glass-forge:snapshots') ?? '[]') as { title: string }[]
  return all.map((r) => r.title)
}

/** localStorage 中的预设存储（与快照分开持久化） */
function storedPresets(): { name: string; title: string; queue: { id: number; on: boolean }[] }[] {
  return JSON.parse(lsData.get('glass-forge:storyboard-presets') ?? '[]') as {
    name: string
    title: string
    queue: { id: number; on: boolean }[]
  }[]
}

/** 保存一个预设：填名称并点「存为预设」 */
async function savePreset(container: HTMLElement, name: string): Promise<void> {
  act(() => typeInput(presetNameInput(container), name))
  act(() => click(findButton(container, '存为预设')))
  await flushAsync()
}

describe('分镜导出配置预设（DOM 级）', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    vi.useFakeTimers()
    lsData.clear()
    // store 是跨用例的单例，重置回放与预设状态并清空快照
    useStudio.setState({ replaying: false, presets: [] })
    await act(async () => {
      await useStudio.getState().refreshSnapshots()
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root.render(<App />)
    })
    // 间隔 1 秒拍三张快照，保证创建时间可区分
    for (const [i, title] of ['节点A', '节点B', '节点C'].entries()) {
      vi.setSystemTime(1_000_000 + i * 1000)
      await act(async () => {
        await useStudio.getState().addSnapshot(title, '', 'thumb')
      })
    }
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  it('选择预设恢复作品名、节点勾选状态与队列顺序', async () => {
    // 调整导出配置：改作品名、取消 节点B、节点C 上移 → [A, C, B(未选)]
    act(() => typeInput(titleInput(container), '琉璃花瓶'))
    act(() => boardCheckbox(container, 1).click())
    act(() => click(boardMoveButton(container, 2, 'up')))
    expect(boardTitles(container)).toEqual(['节点A', '节点C', '节点B'])
    expect(boardSeqs(container)).toEqual(['1', '2', '–'])

    await savePreset(container, '方案一')
    expect(container.querySelector('.toast')?.textContent).toContain('已保存预设「方案一」')
    expect(presetOptions(container)).toEqual(['选择预设…', '方案一'])

    // 打乱当前配置：恢复时间顺序、全选、改作品名
    act(() => click(findButton(container, '恢复时间顺序')))
    act(() => click(findButton(container, '全选')))
    act(() => typeInput(titleInput(container), '被改掉的名字'))
    expect(boardTitles(container)).toEqual(['节点A', '节点B', '节点C'])
    expect(boardSeqs(container)).toEqual(['1', '2', '3'])

    // 选择预设：作品名、勾选状态与队列顺序全部恢复
    const presetId = useStudio.getState().presets[0].id
    act(() => chooseSelect(presetSelect(container), String(presetId)))

    expect(titleInput(container).value).toBe('琉璃花瓶')
    expect(boardTitles(container)).toEqual(['节点A', '节点C', '节点B'])
    expect(boardSeqs(container)).toEqual(['1', '2', '–'])
    expect(container.querySelector('.toast')?.textContent).toContain('已应用预设「方案一」')
    // 右侧快照列表与快照存储均不受预设影响
    expect(snapTitles(container)).toEqual(['节点C', '节点B', '节点A'])
    expect(storedSnapTitles()).toEqual(['节点A', '节点B', '节点C'])
  })

  it('预设单独持久化：保存、应用、删除都不改写快照存储', async () => {
    const snapsBefore = lsData.get('glass-forge:snapshots')

    act(() => boardCheckbox(container, 0).click())
    await savePreset(container, '方案一')
    // 预设写入独立的存储键，快照存储原样保留
    expect(storedPresets()).toHaveLength(1)
    expect(storedPresets()[0].name).toBe('方案一')
    expect(lsData.get('glass-forge:snapshots')).toBe(snapsBefore)

    const presetId = useStudio.getState().presets[0].id
    act(() => chooseSelect(presetSelect(container), String(presetId)))
    expect(lsData.get('glass-forge:snapshots')).toBe(snapsBefore)

    act(() => click(findButton(container, '删除预设')))
    await flushAsync()
    expect(storedPresets()).toHaveLength(0)
    expect(lsData.get('glass-forge:snapshots')).toBe(snapsBefore)
    expect(snapTitles(container)).toEqual(['节点C', '节点B', '节点A'])
  })

  it('删除预设后从下拉框移除，不影响快照列表', async () => {
    await savePreset(container, '方案一')
    await savePreset(container, '方案二')
    expect(presetOptions(container)).toEqual(['选择预设…', '方案一', '方案二'])

    // 选中「方案一」后删除
    const first = useStudio.getState().presets.find((p) => p.name === '方案一')
    act(() => chooseSelect(presetSelect(container), String(first!.id)))
    act(() => click(findButton(container, '删除预设')))
    await flushAsync()

    expect(container.querySelector('.toast')?.textContent).toContain('已删除预设「方案一」')
    expect(presetOptions(container)).toEqual(['选择预设…', '方案二'])
    expect(storedPresets().map((p) => p.name)).toEqual(['方案二'])
    // 删除预设后下拉框回到未选中态，删除按钮不可用
    expect(presetSelect(container).value).toBe('')
    expect(findButton(container, '删除预设').disabled).toBe(true)
    // 快照数据与右侧列表不受影响
    expect(snapTitles(container)).toEqual(['节点C', '节点B', '节点A'])
    expect(storedSnapTitles()).toEqual(['节点A', '节点B', '节点C'])
  })

  it('应用预设时剔除已删除的快照，新快照追加到队尾', async () => {
    // 预设内容：[A(选), C(选), B(未选)]
    act(() => boardCheckbox(container, 1).click())
    act(() => click(boardMoveButton(container, 2, 'up')))
    await savePreset(container, '方案一')

    // 删除 节点C，再拍 节点D
    const idC = useStudio.getState().snapshots.find((m) => m.record.title === '节点C')!.record.id!
    await act(async () => {
      await useStudio.getState().removeSnapshot(idC)
    })
    vi.setSystemTime(2_000_000)
    await act(async () => {
      await useStudio.getState().addSnapshot('节点D', '', 'thumb')
    })

    const presetId = useStudio.getState().presets[0].id
    act(() => chooseSelect(presetSelect(container), String(presetId)))

    // C 已从预设队列剔除，D 作为新快照追加到队尾并默认勾选
    expect(boardTitles(container)).toEqual(['节点A', '节点B', '节点D'])
    expect(boardSeqs(container)).toEqual(['1', '–', '2'])
  })

  it('预设名称为空时提示，不保存', async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    act(() => click(findButton(container, '存为预设')))

    expect(container.querySelector('.toast')?.textContent).toContain('请输入预设名称')
    expect(storedPresets()).toHaveLength(0)
  })
})

describe('没有快照时的预设保存', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    vi.useFakeTimers()
    lsData.clear()
    useStudio.setState({ replaying: false, presets: [] })
    await act(async () => {
      await useStudio.getState().refreshSnapshots()
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

  it('当前没有快照时阻止保存无效预设并提示', async () => {
    expect(presetOptions(container)).toEqual(['暂无导出预设'])
    expect(presetSelect(container).disabled).toBe(true)

    await savePreset(container, '空方案')

    expect(container.querySelector('.toast')?.textContent).toContain(
      '当前没有快照，无法保存预设'
    )
    // 无效预设不写入存储，下拉框保持空态
    expect(storedPresets()).toHaveLength(0)
    expect(useStudio.getState().presets).toHaveLength(0)
    expect(presetOptions(container)).toEqual(['暂无导出预设'])
  })
})
