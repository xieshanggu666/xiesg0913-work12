// @vitest-environment jsdom
/**
 * DOM 级验证：分镜导出前的工序选择与顺序预览。
 * 默认按创建时间从早到晚排列；取消勾选不占编号；
 * 上下移动只影响本次分镜队列，不改变右侧快照列表与存储数据；
 * 合成期间预览锁定，导出内容与点击时的预览一致。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// Stage 依赖 canvas 2D，jsdom 不支持；本测试不涉及画布
vi.mock('./components/Stage', () => ({ Stage: () => null }))

// jsdom 无 canvas 2D：缩略图与分镜合成替换为可控实现；
// exportStoryboard 记录本次收到的面板顺序，用于校验「导出内容 = 点击时的预览」；
// saveStoryboardFile 的返回值由 savePath 控制，置 null 模拟用户在保存对话框中取消
const hoisted = vi.hoisted(() => ({
  exported: [] as string[],
  savePath: '/tmp/board.png' as string | null
}))

vi.mock('./engine/render', async (importActual) => {
  const actual = await importActual<typeof import('./engine/render')>()
  return { ...actual, drawThumbnail: () => 'data:image/png;base64,thumb' }
})

vi.mock('./state/storage', async (importActual) => {
  const actual = await importActual<typeof import('./state/storage')>()
  return {
    ...actual,
    exportStoryboard: async (panels: { title: string }[]): Promise<string> => {
      hoisted.exported = panels.map((p) => p.title)
      return 'data:image/png;base64,board'
    },
    saveStoryboardFile: async (): Promise<string | null> => hoisted.savePath
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

/** 让 store 里的 async 动作链（await 存储 / 刷新 / 导出）走完 */
async function flushAsync(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
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

function boardActionButton(container: HTMLElement, text: string): HTMLButtonElement {
  const group = container.querySelector('.board-actions')
  const btn = group && Array.from(group.querySelectorAll('button')).find((b) => b.textContent === text)
  if (!btn) throw new Error(`找不到分镜操作按钮「${text}」`)
  return btn
}

/** 右侧快照列表的标题顺序（新 → 旧） */
function snapTitles(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.snap-list .snap-info b')).map(
    (el) => el.textContent ?? ''
  )
}

/** localStorage 中的存储顺序（追加序） */
function storedTitles(): string[] {
  const all = JSON.parse(lsData.get('glass-forge:snapshots') ?? '[]') as { title: string }[]
  return all.map((r) => r.title)
}

describe('分镜导出前的工序选择与顺序预览（DOM 级）', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    vi.useFakeTimers()
    lsData.clear()
    hoisted.exported = []
    hoisted.savePath = '/tmp/board.png'
    // store 是跨用例的单例，重置回放状态并清空快照
    useStudio.setState({ replaying: false })
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

  it('默认按创建时间从早到晚排列并顺序编号，与右侧列表（新→旧）相反', () => {
    expect(boardTitles(container)).toEqual(['节点A', '节点B', '节点C'])
    expect(boardSeqs(container)).toEqual(['1', '2', '3'])
    expect(snapTitles(container)).toEqual(['节点C', '节点B', '节点A'])
  })

  it('取消勾选后该节点不占编号，其余编号随最终顺序更新', () => {
    act(() => boardCheckbox(container, 1).click()) // 取消 节点B

    expect(boardSeqs(container)).toEqual(['1', '–', '2'])
    expect(container.textContent).toContain('已选 2 / 3 个工序')

    act(() => boardCheckbox(container, 1).click()) // 重新勾选
    expect(boardSeqs(container)).toEqual(['1', '2', '3'])
  })

  it('上下移动只影响本次分镜队列，不改变右侧列表与存储数据', () => {
    act(() => click(boardMoveButton(container, 2, 'up'))) // 节点C 上移

    expect(boardTitles(container)).toEqual(['节点A', '节点C', '节点B'])
    expect(boardSeqs(container)).toEqual(['1', '2', '3'])
    // 右侧列表顺序与存储数据均不变
    expect(snapTitles(container)).toEqual(['节点C', '节点B', '节点A'])
    expect(storedTitles()).toEqual(['节点A', '节点B', '节点C'])

    act(() => click(boardMoveButton(container, 1, 'down'))) // 节点C 下移还原
    expect(boardTitles(container)).toEqual(['节点A', '节点B', '节点C'])
  })

  it('首节点不可上移、末节点不可下移', () => {
    expect(boardMoveButton(container, 0, 'up').disabled).toBe(true)
    expect(boardMoveButton(container, 2, 'down').disabled).toBe(true)
  })

  it('手动排序后新快照追加到队尾，顺序与勾选保留', async () => {
    act(() => click(boardMoveButton(container, 2, 'up'))) // A C B
    act(() => boardCheckbox(container, 0).click()) // 取消 A

    vi.setSystemTime(2_000_000)
    await act(async () => {
      await useStudio.getState().addSnapshot('节点D', '', 'thumb')
    })

    expect(boardTitles(container)).toEqual(['节点A', '节点C', '节点B', '节点D'])
    expect(boardSeqs(container)).toEqual(['–', '1', '2', '3'])
  })

  it('全不选与全选只改勾选、不动顺序，且不影响右侧列表与存储数据', () => {
    act(() => click(boardActionButton(container, '全不选')))
    for (const box of container.querySelectorAll<HTMLInputElement>(
      '.board-list input[type="checkbox"]'
    )) {
      expect(box.checked).toBe(false)
    }
    expect(boardSeqs(container)).toEqual(['–', '–', '–'])
    expect(container.textContent).toContain('已选 0 / 3 个工序')

    act(() => click(boardActionButton(container, '全选')))
    expect(boardTitles(container)).toEqual(['节点A', '节点B', '节点C'])
    expect(boardSeqs(container)).toEqual(['1', '2', '3'])
    // 右侧列表与存储数据不受批量勾选影响
    expect(snapTitles(container)).toEqual(['节点C', '节点B', '节点A'])
    expect(storedTitles()).toEqual(['节点A', '节点B', '节点C'])
  })

  it('恢复时间顺序按创建时间重排，同时保留各节点当前勾选状态', () => {
    act(() => click(boardMoveButton(container, 2, 'up'))) // A C B
    act(() => click(boardMoveButton(container, 0, 'down'))) // C A B
    act(() => boardCheckbox(container, 2).click()) // 取消当前队尾 节点B

    act(() => click(boardActionButton(container, '恢复时间顺序')))

    expect(boardTitles(container)).toEqual(['节点A', '节点B', '节点C'])
    // 节点B 的取消勾选被保留，其余仍选中
    expect(boardSeqs(container)).toEqual(['1', '–', '2'])
    expect(container.textContent).toContain('已选 2 / 3 个工序')
    // 右侧列表与存储数据均不受影响
    expect(snapTitles(container)).toEqual(['节点C', '节点B', '节点A'])
    expect(storedTitles()).toEqual(['节点A', '节点B', '节点C'])
  })

  it('全部取消勾选后点导出给出提示，不进入合成', () => {
    for (let i = 0; i < 3; i++) {
      act(() => boardCheckbox(container, i).click())
    }
    act(() => click(findButton(container, '导出分镜 PNG')))

    expect(container.querySelector('.toast')?.textContent).toContain('请至少勾选一个工序节点')
  })

  it('合成期间预览锁定，导出内容与点击时的预览一致', async () => {
    // 取消 节点B、节点C 上移 → 预览最终为 [节点A, 节点C, 节点B(未选)]
    act(() => boardCheckbox(container, 1).click())
    act(() => click(boardMoveButton(container, 2, 'up')))
    expect(boardTitles(container)).toEqual(['节点A', '节点C', '节点B'])
    expect(boardSeqs(container)).toEqual(['1', '2', '–'])

    act(() => click(findButton(container, '导出分镜 PNG')))
    // 合成进行中：预览控件、作品名输入与导出按钮全部锁定
    expect(boardCheckbox(container, 0).disabled).toBe(true)
    expect(boardMoveButton(container, 0, 'down').disabled).toBe(true)
    for (const text of ['全选', '全不选', '恢复时间顺序']) {
      expect(boardActionButton(container, text).disabled).toBe(true)
    }
    expect(container.querySelector('.board-list')?.className).toContain('locked')
    const titleInput = container.querySelector<HTMLInputElement>('.storyboard .snap-form input')
    expect(titleInput?.disabled).toBe(true)
    const exportBtn = container.querySelector<HTMLButtonElement>('.storyboard .snap-form button')
    expect(exportBtn?.disabled).toBe(true)
    expect(exportBtn?.textContent).toContain('合成中')

    await flushAsync()

    // 导出内容按点击时的预览合成（不含未勾选的 节点B）
    expect(hoisted.exported).toEqual(['节点A', '节点C'])
    // 完成后预览恢复可编辑
    expect(boardCheckbox(container, 0).disabled).toBe(false)
    expect(boardMoveButton(container, 0, 'down').disabled).toBe(false)
    for (const text of ['全选', '全不选', '恢复时间顺序']) {
      expect(boardActionButton(container, text).disabled).toBe(false)
    }
    expect(container.querySelector('.board-list')?.className).not.toContain('locked')
    expect(container.querySelector('.toast')?.textContent).toContain('分镜已导出')
  })

  it('用户在保存对话框中取消时不误报导出失败', async () => {
    hoisted.savePath = null // 模拟桌面保存接口返回 canceled
    // 先清掉 beforeEach 拍快照残留的 toast，避免干扰断言
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(container.querySelector('.toast')).toBeNull()

    act(() => click(findButton(container, '导出分镜 PNG')))
    await flushAsync()

    // 合成正常完成，但取消保存后既不报失败也不报成功
    expect(hoisted.exported).toEqual(['节点A', '节点B', '节点C'])
    expect(container.querySelector('.toast')).toBeNull()
    // 预览解除锁定，可继续操作
    expect(boardCheckbox(container, 0).disabled).toBe(false)
    expect(findButton(container, '导出分镜 PNG').disabled).toBe(false)
  })
})
