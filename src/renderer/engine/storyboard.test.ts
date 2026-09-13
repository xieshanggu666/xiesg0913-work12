import { describe, expect, it } from 'vitest'
import {
  layoutBoard,
  moveBoardItem,
  reconcileBoardQueue,
  restoreBoardOrder,
  setBoardAllPicked
} from './storyboard'

describe('分镜布局', () => {
  it('单格占满一行', () => {
    const l = layoutBoard(1)
    expect(l.panels).toHaveLength(1)
    expect(l.panels[0].x).toBe(48)
  })

  it('2~4 格每行两列', () => {
    for (const n of [2, 3, 4]) {
      const l = layoutBoard(n)
      expect(l.panels[1].x).toBeGreaterThan(l.panels[0].x)
      expect(l.panels[1].y).toBe(l.panels[0].y)
    }
    expect(layoutBoard(3).panels[2].y).toBeGreaterThan(layoutBoard(3).panels[0].y)
  })

  it('5 格以上每行三列', () => {
    const l = layoutBoard(6)
    expect(l.panels[2].y).toBe(l.panels[0].y)
    expect(l.panels[3].y).toBeGreaterThan(l.panels[0].y)
  })

  it('所有格子互不重叠且在画布内', () => {
    const l = layoutBoard(7)
    for (const a of l.panels) {
      expect(a.x).toBeGreaterThanOrEqual(0)
      expect(a.x + a.w).toBeLessThanOrEqual(l.width)
      expect(a.y + a.h).toBeLessThanOrEqual(l.height)
    }
    for (let i = 0; i < l.panels.length; i++) {
      for (let j = i + 1; j < l.panels.length; j++) {
        const a = l.panels[i]
        const b = l.panels[j]
        const overlap = !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y)
        expect(overlap).toBe(false)
      }
    }
  })
})

describe('分镜导出队列', () => {
  const rec = (id: number, created_at: number): { id: number; created_at: number } => ({
    id,
    created_at
  })

  it('默认按创建时间从早到晚排列，且全部选中', () => {
    // 快照列表是新到旧，队列应反转为旧到新
    const queue = reconcileBoardQueue([], [rec(3, 300), rec(1, 100), rec(2, 200)])
    expect(queue).toEqual([
      { id: 1, on: true },
      { id: 2, on: true },
      { id: 3, on: true }
    ])
  })

  it('保留手动顺序与勾选状态，新快照按时间追加到队尾', () => {
    const prev = [
      { id: 2, on: false },
      { id: 1, on: true }
    ]
    const queue = reconcileBoardQueue(prev, [rec(3, 300), rec(2, 200), rec(1, 100)])
    expect(queue).toEqual([
      { id: 2, on: false },
      { id: 1, on: true },
      { id: 3, on: true }
    ])
  })

  it('已删除的快照从队列移除', () => {
    const prev = [
      { id: 1, on: true },
      { id: 2, on: false }
    ]
    expect(reconcileBoardQueue(prev, [rec(2, 200)])).toEqual([{ id: 2, on: false }])
    expect(reconcileBoardQueue(prev, [])).toEqual([])
  })

  it('id 为 null 的记录不进入队列', () => {
    const queue = reconcileBoardQueue([], [{ id: null, created_at: 100 }, rec(1, 50)])
    expect(queue).toEqual([{ id: 1, on: true }])
  })

  it('上移/下移交换相邻节点，边界处不动', () => {
    const q = [1, 2, 3]
    expect(moveBoardItem(q, 1, -1)).toEqual([2, 1, 3])
    expect(moveBoardItem(q, 1, 1)).toEqual([1, 3, 2])
    expect(moveBoardItem(q, 0, -1)).toEqual([1, 2, 3])
    expect(moveBoardItem(q, 2, 1)).toEqual([1, 2, 3])
    // 原数组不被修改
    expect(q).toEqual([1, 2, 3])
  })

  it('全选/全不选只改勾选状态，顺序不变', () => {
    const prev = [
      { id: 2, on: false },
      { id: 1, on: true },
      { id: 3, on: false }
    ]
    expect(setBoardAllPicked(prev, true)).toEqual([
      { id: 2, on: true },
      { id: 1, on: true },
      { id: 3, on: true }
    ])
    expect(setBoardAllPicked(prev, false)).toEqual([
      { id: 2, on: false },
      { id: 1, on: false },
      { id: 3, on: false }
    ])
    // 原数组不被修改，已是目标状态时原样返回各项
    expect(prev).toEqual([
      { id: 2, on: false },
      { id: 1, on: true },
      { id: 3, on: false }
    ])
  })

  it('恢复时间顺序按创建时间从早到晚排列，并保留各节点勾选状态', () => {
    const prev = [
      { id: 3, on: false },
      { id: 2, on: false },
      { id: 1, on: true }
    ]
    expect(restoreBoardOrder(prev, [rec(3, 300), rec(2, 200), rec(1, 100)])).toEqual([
      { id: 1, on: true },
      { id: 2, on: false },
      { id: 3, on: false }
    ])
    // 原数组不被修改
    expect(prev).toEqual([
      { id: 3, on: false },
      { id: 2, on: false },
      { id: 1, on: true }
    ])
  })

  it('创建时间相同时按 id 升序稳定排列', () => {
    const prev = [
      { id: 30, on: true },
      { id: 10, on: false },
      { id: 20, on: true }
    ]
    expect(restoreBoardOrder(prev, [rec(30, 100), rec(10, 100), rec(20, 100)])).toEqual([
      { id: 10, on: false },
      { id: 20, on: true },
      { id: 30, on: true }
    ])
  })

  it('时间与 id 都相同时保持原相对顺序（稳定排序）', () => {
    const a = { id: 1, on: true }
    const b = { id: 1, on: false }
    const prev = [a, b]
    const restored = restoreBoardOrder(prev, [rec(1, 100)])
    expect(restored[0]).toBe(a)
    expect(restored[1]).toBe(b)
  })

  it('找不到时间记录的节点保持原相对顺序追加到队尾', () => {
    const prev = [
      { id: 9, on: true },
      { id: 2, on: false },
      { id: 1, on: true }
    ]
    expect(restoreBoardOrder(prev, [rec(1, 100), rec(2, 200)])).toEqual([
      { id: 1, on: true },
      { id: 2, on: false },
      { id: 9, on: true }
    ])
  })
})
