import { useRef, useState } from 'react'
import { FIXED_DT, TOOL_LABELS } from '../engine/constants'
import { summarizeMetrics } from '../engine/describe'
import { MAX_ANNOTATION_TEXT, annotationsAtFrame } from '../engine/annotations'
import { useStudio } from '../state/store'

const SPEEDS = [0.5, 1, 2, 4] as const

/**
 * 回放时间轴：拖动定位、前后单帧、播放速度、当前帧温度与成型指标、
 * 当前帧文字标注的添加 / 删除（标注独立保存，不改写轨迹）。
 */
export function ReplayTimeline(): JSX.Element | null {
  const replaying = useStudio((s) => s.replaying)
  const playing = useStudio((s) => s.replayPlaying)
  const frame = useStudio((s) => s.replayFrame)
  const frameCount = useStudio((s) => s.replayFrameCount)
  const speed = useStudio((s) => s.replaySpeed)
  const metrics = useStudio((s) => s.metrics)
  const annotations = useStudio((s) => s.annotations)
  const engine = useStudio((s) => s.engine)
  const toggleReplayPlay = useStudio((s) => s.toggleReplayPlay)
  const stepFrame = useStudio((s) => s.stepFrame)
  const seekFrame = useStudio((s) => s.seekFrame)
  const setReplaySpeed = useStudio((s) => s.setReplaySpeed)
  const stopReplay = useStudio((s) => s.stopReplay)
  const addAnnotation = useStudio((s) => s.addAnnotation)
  const removeAnnotation = useStudio((s) => s.removeAnnotation)
  const exportAnnotations = useStudio((s) => s.exportAnnotations)
  const importAnnotations = useStudio((s) => s.importAnnotations)

  const [text, setText] = useState('')
  /** 拖动滑块前是否在播放：拖动期间暂停，松手后恢复 */
  const wasPlaying = useRef(false)

  if (!replaying) return null

  const summary = summarizeMetrics(metrics)
  const current = annotationsAtFrame(annotations, frame)
  const seconds = (frame * FIXED_DT).toFixed(1)

  const beginScrub = (): void => {
    wasPlaying.current = useStudio.getState().replayPlaying
    if (wasPlaying.current) toggleReplayPlay()
  }
  const endScrub = (): void => {
    if (wasPlaying.current) toggleReplayPlay()
    wasPlaying.current = false
  }
  const submitAnnotation = (): void => {
    // 保存失败时保留已填内容，便于修改后重试
    if (addAnnotation(text)) setText('')
  }

  return (
    <div className="replay-dock">
      <div className="replay-controls">
        <button onClick={() => stepFrame(-1)} disabled={frame <= 0} title="上一帧">
          ◀ 上一帧
        </button>
        <button className="primary" onClick={toggleReplayPlay}>
          {playing ? '⏸ 暂停' : '▶ 播放'}
        </button>
        <button onClick={() => stepFrame(1)} disabled={frame >= frameCount} title="下一帧">
          下一帧 ▶
        </button>
        <select
          value={speed}
          title="回放速度"
          onChange={(ev) => setReplaySpeed(Number(ev.target.value))}
        >
          {SPEEDS.map((v) => (
            <option key={v} value={v}>
              {v}×
            </option>
          ))}
        </select>
        <span className="replay-pos">
          第 {frame} / {frameCount} 帧 · {seconds} s
        </span>
      </div>

      <div className="seek">
        <div className="seek-marks">
          {annotations.map((a) => (
            <i
              key={a.id}
              style={{ left: `${(a.frame / Math.max(1, frameCount)) * 100}%` }}
              title={`第 ${a.frame} 帧：${a.text}`}
            />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={frameCount}
          step={1}
          value={frame}
          aria-label="回放定位"
          onPointerDown={beginScrub}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
          onChange={(ev) => seekFrame(Number(ev.target.value))}
        />
      </div>

      <div className="replay-metrics">
        <span>
          工具 <b>{TOOL_LABELS[engine.input.tool] ?? engine.input.tool}</b>
        </span>
        <span>
          均温 <b>{metrics.avgTemp.toFixed(0)} ℃</b>
        </span>
        <span>
          壁厚 <b>{metrics.avgThickness.toFixed(3)}</b>
        </span>
        <span>
          伸长 <b>×{metrics.elongation.toFixed(2)}</b>
        </span>
        <span>
          腹/颈/口{' '}
          <b>
            {(metrics.bodyRadius * 100).toFixed(0)}/{(metrics.neckRadius * 100).toFixed(0)}/
            {(metrics.rimRadius * 100).toFixed(0)}
          </b>
        </span>
        <span className={`replay-status ${summary.tone}`}>
          {summary.status}
          {summary.warnings.length > 0 ? ` · ${summary.warnings.join(' · ')}` : ''}
        </span>
      </div>

      <div className="ann-form">
        <input
          type="text"
          value={text}
          maxLength={MAX_ANNOTATION_TEXT}
          placeholder={`为第 ${frame} 帧添加标注（如：鼓腹完成、开始收颈）`}
          onChange={(ev) => setText(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter') submitAnnotation()
          }}
        />
        <button onClick={submitAnnotation} disabled={!text.trim()}>
          添加标注
        </button>
      </div>

      {current.length > 0 && (
        <ul className="ann-list">
          {current.map((a) => (
            <li key={a.id}>
              <span>{a.text}</span>
              <button className="danger-btn" onClick={() => removeAnnotation(a.id)}>
                删除
              </button>
            </li>
          ))}
        </ul>
      )}

      {annotations.length > current.length && (
        <div className="ann-chips">
          {annotations
            .filter((a) => a.frame !== frame)
            .map((a) => (
              <button
                key={a.id}
                className="ann-chip"
                title={`跳转到第 ${a.frame} 帧`}
                onClick={() => seekFrame(a.frame)}
              >
                {a.frame}帧 · {a.text}
              </button>
            ))}
        </div>
      )}

      <div className="replay-footer">
        <button onClick={() => void exportAnnotations()} disabled={annotations.length === 0}>
          ⤓ 导出标注
        </button>
        <button onClick={() => void importAnnotations()}>⤒ 导入标注</button>
        <button onClick={stopReplay}>■ 退出回放</button>
      </div>
    </div>
  )
}
