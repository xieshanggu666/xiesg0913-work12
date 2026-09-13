import { useEffect, useRef } from 'react'
import { FIXED_DT } from '../engine/constants'
import { drawScene } from '../engine/render'
import { useStudio } from '../state/store'

export function Stage(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  // 回放时隐藏操作提示，避免与时间轴面板重叠
  const replaying = useStudio((s) => s.replaying)

  useEffect(() => {
    const canvas = canvasRef.current!
    const wrap = wrapRef.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0
    let acc = 0
    let last = performance.now()
    let dpr = window.devicePixelRatio || 1

    const resize = (): void => {
      dpr = window.devicePixelRatio || 1
      const rect = wrap.getBoundingClientRect()
      canvas.width = Math.max(1, rect.width * dpr)
      canvas.height = Math.max(1, rect.height * dpr)
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
    }
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    resize()

    const loop = (now: number): void => {
      const studio = useStudio.getState()
      const e = studio.engine
      let frame = now - last
      last = now
      if (frame > 0.25) frame = 0.25
      acc += frame

      // 固定步长：一帧最多补 4 步，防止切后台后追帧爆炸
      let steps = 0
      while (acc >= FIXED_DT && steps < 4) {
        e.tick()
        acc -= FIXED_DT
        steps++
      }
      // 回放模式：同步进度 / 当前帧 / 播放状态到时间轴
      // （引擎播到末帧会停在末帧保持回放态，由 onReplayEnd 提示完成）
      if (studio.replaying) {
        studio.syncReplay()
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawScene(ctx, canvas.width / dpr, canvas.height / dpr, {
        glass: e.glass,
        input: e.input,
        metrics: studio.metrics,
        time: e.time,
        pointerActive: studio.pointerActive
      })

      studio.bump()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    // 必须与 render.ts 的投影保持一致
    const toWorld = (clientX: number, clientY: number): { x: number; y: number } => {
      const eng = useStudio.getState().engine
      const rect = canvas.getBoundingClientRect()
      const h = rect.height
      const cx = rect.width / 2
      const scale = h / 3.35
      const bottomY = h - 36
      const px = clientX - rect.left
      const pyPx = clientY - rect.top
      const worldY = (bottomY - pyPx) / scale
      return {
        x: Math.max(-1, Math.min(1, (px - cx) / (scale * 0.85))),
        y: Math.max(0, Math.min(1, worldY / Math.max(0.001, eng.glass.elongation)))
      }
    }

    const onDown = (ev: PointerEvent): void => {
      canvas.setPointerCapture(ev.pointerId)
      const p = toWorld(ev.clientX, ev.clientY)
      const s = useStudio.getState()
      s.engine.setPointer(p.x, p.y)
      s.engine.setPressure(0.8)
      s.setPointerActive(true)
    }
    const onMove = (ev: PointerEvent): void => {
      const p = toWorld(ev.clientX, ev.clientY)
      const s = useStudio.getState()
      s.engine.setPointer(p.x, p.y)
      s.setPointerActive(true)
    }
    const onUp = (ev: PointerEvent): void => {
      const s = useStudio.getState()
      s.engine.setPressure(0)
      try {
        canvas.releasePointerCapture(ev.pointerId)
      } catch {
        // ignore
      }
    }
    const onLeave = (): void => {
      const s = useStudio.getState()
      s.setPointerActive(false)
      s.engine.setPressure(0)
    }

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointerleave', onLeave)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointerleave', onLeave)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div ref={wrapRef} className="stage-wrap">
      <canvas ref={canvasRef} className="stage" />
      {!replaying && (
        <div className="stage-hint">按住鼠标 / 手指在器身上拖动：火焰加热 → 吹管鼓腹 → 拉制收颈</div>
      )}
    </div>
  )
}
