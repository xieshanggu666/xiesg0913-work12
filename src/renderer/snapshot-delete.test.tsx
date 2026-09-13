// @vitest-environment jsdom
/**
 * DOM 级验证：快照删除的二次确认交互。
 * 点「删除」只进入确认态，点「确认删除」才真正移除；
 * 取消或 5 秒未确认都不会删除。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// Stage 依赖 canvas 2D，jsdom 不支持；本测试不涉及画布
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

function hasButton(container: HTMLElement, text: string): boolean {
  return Array.from(container.querySelectorAll('button')).some((b) =>
    b.textContent?.includes(text)
  )
}

function itemCount(container: HTMLElement): number {
  return container.querySelectorAll('.snap-list li').length
}

function storedCount(): number {
  return (JSON.parse(lsData.get('glass-forge:snapshots') ?? '[]') as unknown[]).length
}

/** 让 store 里的 async 动作链（await 存储 / 刷新）走完 */
async function flushAsync(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

describe('快照删除二次确认（DOM 级）', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    vi.useFakeTimers()
    lsData.clear()
    // store 是跨用例的单例，重置回放状态
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
    await act(async () => {
      await useStudio.getState().addSnapshot('节点A', '', 'thumb')
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  it('点「删除」只进入确认态，不会删除', async () => {
    act(() => click(findButton(container, '删除')))
    await flushAsync()

    expect(hasButton(container, '确认删除')).toBe(true)
    expect(itemCount(container)).toBe(1)
    expect(storedCount()).toBe(1)
  })

  it('确认态点「取消」后保留快照', async () => {
    act(() => click(findButton(container, '删除')))
    act(() => click(findButton(container, '取消')))
    await flushAsync()

    expect(hasButton(container, '确认删除')).toBe(false)
    expect(itemCount(container)).toBe(1)
    expect(storedCount()).toBe(1)
  })

  it('5 秒未确认自动还原，不会删除', async () => {
    act(() => click(findButton(container, '删除')))
    expect(hasButton(container, '确认删除')).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })

    expect(hasButton(container, '确认删除')).toBe(false)
    expect(itemCount(container)).toBe(1)
    expect(storedCount()).toBe(1)
  })

  it('点「确认删除」才真正从列表与存储移除', async () => {
    act(() => click(findButton(container, '删除')))
    act(() => click(findButton(container, '确认删除')))
    await flushAsync()

    expect(itemCount(container)).toBe(0)
    expect(storedCount()).toBe(0)
  })

  it('回放过程中「删除」按钮禁用', async () => {
    await act(async () => {
      useStudio.setState({ replaying: true })
    })

    expect(findButton(container, '删除').disabled).toBe(true)
    expect(itemCount(container)).toBe(1)
    expect(storedCount()).toBe(1)
  })

  it('确认态下回放开始：自动取消确认且不可确认删除', async () => {
    act(() => click(findButton(container, '删除')))
    expect(hasButton(container, '确认删除')).toBe(true)

    // 回放开始 → 确认态被取消
    await act(async () => {
      useStudio.setState({ replaying: true })
    })
    expect(hasButton(container, '确认删除')).toBe(false)
    expect(itemCount(container)).toBe(1)
    expect(storedCount()).toBe(1)
  })
})
