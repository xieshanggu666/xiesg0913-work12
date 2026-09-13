import { useEffect, useState } from 'react'
import { useStudio, type SnapshotMeta } from '../state/store'
import { drawThumbnail } from '../engine/render'

/** 确认删除的等待时长，超时未确认自动还原为普通按钮 */
const CONFIRM_MS = 5000

function SnapshotItem(props: { meta: SnapshotMeta; replaying: boolean }): JSX.Element {
  const { meta, replaying } = props
  const loadSnapshot = useStudio((s) => s.loadSnapshot)
  const removeSnapshot = useStudio((s) => s.removeSnapshot)
  const [confirming, setConfirming] = useState(false)

  // 进入确认态后超时自动取消，避免误触遗留
  useEffect(() => {
    if (!confirming) return
    const timer = setTimeout(() => setConfirming(false), CONFIRM_MS)
    return () => clearTimeout(timer)
  }, [confirming])

  // 回放开始时取消未确认的删除（回放期间禁止删除）
  useEffect(() => {
    if (replaying) setConfirming(false)
  }, [replaying])

  const confirmDelete = (): void => {
    if (meta.record.id != null) void removeSnapshot(meta.record.id)
  }

  return (
    <li>
      <img src={meta.record.thumb} alt={meta.record.title} />
      <div className="snap-info">
        <b>{meta.record.title}</b>
        {meta.record.note && <span className="snap-note">{meta.record.note}</span>}
        <span className="snap-statusline">
          <i className={`snap-badge ${meta.summary.tone}`}>{meta.summary.status}</i>
          {meta.summary.temp}℃ · 伸长×{meta.summary.elongation.toFixed(2)}
        </span>
        {meta.summary.warnings.length > 0 && (
          <span className="snap-warn">{meta.summary.warnings.join(' · ')}</span>
        )}
        <span>{new Date(meta.record.created_at).toLocaleTimeString()}</span>
        {confirming ? (
          <div className="snap-actions">
            <button className="danger-btn confirm" disabled={replaying} onClick={confirmDelete}>
              确认删除
            </button>
            <button onClick={() => setConfirming(false)}>取消</button>
          </div>
        ) : (
          <div className="snap-actions">
            <button disabled={replaying} onClick={() => loadSnapshot(meta)}>
              读取
            </button>
            <button className="danger-btn" disabled={replaying} onClick={() => setConfirming(true)}>
              删除
            </button>
          </div>
        )}
      </div>
    </li>
  )
}

export function Snapshots(): JSX.Element {
  const snapshots = useStudio((s) => s.snapshots)
  const addSnapshot = useStudio((s) => s.addSnapshot)
  const replaying = useStudio((s) => s.replaying)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')

  const capture = async (): Promise<void> => {
    const s = useStudio.getState()
    const thumb = drawThumbnail(s.engine.glass, s.engine.input, s.metrics)
    const n = snapshots.length + 1
    // 保存失败时保留已填内容，便于重试
    const ok = await addSnapshot(title.trim() || `工序 ${n}`, note.trim(), thumb)
    if (ok) {
      setTitle('')
      setNote('')
    }
  }

  return (
    <div className="panel snapshots">
      <h3>过程快照</h3>
      <div className="snap-form">
        <input
          value={title}
          maxLength={30}
          placeholder="节点名称（可选）"
          onChange={(ev) => setTitle(ev.target.value)}
          disabled={replaying}
        />
        <button className="primary" onClick={capture} disabled={replaying}>
          拍快照
        </button>
      </div>
      <input
        className="snap-note-input"
        value={note}
        maxLength={60}
        placeholder="工序备注（可选，如：鼓腹完成、开始收颈）"
        onChange={(ev) => setNote(ev.target.value)}
        disabled={replaying}
      />
      {snapshots.length === 0 && <p className="muted small">还没有快照，在关键工序节点拍一张。</p>}
      <ul className="snap-list">
        {snapshots.map((meta) => (
          <SnapshotItem key={meta.record.id} meta={meta} replaying={replaying} />
        ))}
      </ul>
      <p className="muted small">删除需再点一次「确认删除」（5 秒内可取消），防止误删。</p>
    </div>
  )
}

export function Timeline(): JSX.Element {
  const replaying = useStudio((s) => s.replaying)
  const progress = useStudio((s) => s.replayProgress)
  const playReplay = useStudio((s) => s.playReplay)
  const stopReplay = useStudio((s) => s.stopReplay)
  const resetGlass = useStudio((s) => s.resetGlass)
  const exportTrajectory = useStudio((s) => s.exportTrajectory)
  const importTrajectory = useStudio((s) => s.importTrajectory)
  const engine = useStudio((s) => s.engine)
  const frames = engine.traj.length

  return (
    <div className="panel timeline">
      <h3>成形轨迹</h3>
      <div className="timeline-btns">
        {!replaying ? (
          <button className="primary" onClick={playReplay} disabled={frames < 2}>
            ▶ 回放轨迹
          </button>
        ) : (
          <button onClick={stopReplay}>■ 停止回放</button>
        )}
        <button onClick={resetGlass} disabled={replaying}>
          ↺ 取新料重来
        </button>
      </div>
      <div className="timeline-btns">
        <button onClick={() => void exportTrajectory()} disabled={replaying || frames < 2}>
          ⤓ 导出轨迹
        </button>
        <button onClick={() => void importTrajectory()} disabled={replaying}>
          ⤒ 导入轨迹
        </button>
      </div>
      <div className="bar">
        <i style={{ width: `${(replaying ? progress : frames > 0 ? 1 : 0) * 100}%` }} />
      </div>
      <p className="muted small">
        {replaying
          ? `回放中 ${(progress * 100).toFixed(0)}%（从料泡开始逐帧复现）`
          : `已记录 ${frames} 帧（约 ${(frames / 30).toFixed(1)} 秒操作）· 可导出为 JSON，导入后从料泡重新回放`}
      </p>
    </div>
  )
}
