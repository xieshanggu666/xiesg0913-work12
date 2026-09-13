import { useEffect, useMemo, useState } from 'react'
import type { SimParams, TrajFrame } from '@shared/types'
import { useStudio, type ExperimentMeta } from '../state/store'
import { ExperimentDialog } from './ExperimentDialog'
import {
  DEFAULT_EXPERIMENT_FILTER,
  EXPERIMENT_PARAMS,
  EXPERIMENT_STATUS_OPTIONS,
  MAX_EXPERIMENT_CONCLUSION,
  PARAM_META,
  armStatus,
  computeMetricDeltas,
  filterExperiments,
  formatDelta,
  isDefaultExperimentFilter,
  summarizeBaselineValues,
  type ExperimentFilter
} from '../engine/experiment'

/** 删除二次确认等待时长（与快照删除一致：5 秒内可取消） */
const CONFIRM_MS = 5000

export function ExperimentBar(): JSX.Element {
  const experiments = useStudio((s) => s.experiments)
  const refreshExperiments = useStudio((s) => s.refreshExperiments)
  const showToast = useStudio((s) => s.showToast)
  const removeExperiment = useStudio((s) => s.removeExperiment)
  const saveExperimentConclusion = useStudio((s) => s.saveExperimentConclusion)

  // 发起实验的弹窗开 / 关；打开瞬间快照当前轨迹，实验全程只读该副本
  const [composing, setComposing] = useState(false)
  const [baseFrames, setBaseFrames] = useState<TrajFrame[] | null>(null)
  // 查看已保存实验
  const [viewing, setViewing] = useState<ExperimentMeta | null>(null)
  // 列表筛选 / 排序条件（纯本地视图状态，不持久化、不影响数据）
  const [filter, setFilter] = useState<ExperimentFilter>(DEFAULT_EXPERIMENT_FILTER)

  useEffect(() => {
    void refreshExperiments()
  }, [refreshExperiments])

  const startNew = (): void => {
    const frames = useStudio.getState().engine.traj
    if (frames.length < 2) {
      showToast('当前还没有可作为基准的成形轨迹，请先制作或导入一条')
      return
    }
    // 深拷贝：实验方案复制轨迹后离线运行，绝不改写当前作品 / 轨迹
    setBaseFrames(frames.map((f) => ({ dt: f.dt, input: structuredClone(f.input) })))
    setComposing(true)
  }

  // 多个条件同时生效：关键词（名称 + 结论）、旋钮类型、实验结果取交集，再按时间排序
  const visible = useMemo(() => filterExperiments(experiments, filter), [experiments, filter])
  const hasFilter = !isDefaultExperimentFilter(filter)

  return (
    <div className="panel experiments">
      <h3>工艺实验</h3>
      <div className="snap-form">
        <button className="primary" onClick={startNew}>
          ⚗ 以当前轨迹发起实验
        </button>
      </div>
      {experiments.length === 0 ? (
        <p className="muted small">
          选一条已有轨迹作为基准复制为实验方案：仅修改指定帧区间内的一项旋钮，分别运行后对照器形、
          关键指标差值与是否报废，并保存条件、结果和你的结论。
        </p>
      ) : (
        <>
          <ExperimentFilters filter={filter} onChange={setFilter} />
          <p className="exp-filter-count" aria-live="polite">
            {hasFilter ? `匹配 ${visible.length} / 共 ${experiments.length} 条实验` : `共 ${experiments.length} 条实验`}
          </p>
          {visible.length === 0 ? (
            // 与“尚无实验”区分：此时库里有实验，只是没有命中当前条件
            <p className="muted small exp-filter-empty">
              没有符合筛选条件的实验，换个关键词或放宽旋钮 / 结果筛选。
              <button className="exp-filter-clear-link" onClick={() => setFilter(DEFAULT_EXPERIMENT_FILTER)}>
                清空筛选条件
              </button>
            </p>
          ) : (
            <ul className="exp-list">
              {visible.map((meta) => (
                <ExperimentItem
                  key={meta.record.id}
                  meta={meta}
                  onOpen={() => setViewing(meta)}
                  onDelete={() => {
                    if (meta.record.id != null) void removeExperiment(meta.record.id)
                  }}
                />
              ))}
            </ul>
          )}
        </>
      )}

      {composing && baseFrames && (
        <ExperimentDialog frames={baseFrames} onClose={() => setComposing(false)} />
      )}
      {viewing && (
        <ExperimentViewer
          meta={viewing}
          onClose={() => setViewing(null)}
          onDelete={async () => {
            if (viewing.record.id == null) return
            await removeExperiment(viewing.record.id)
            setViewing(null)
          }}
          onSaveConclusion={(text) =>
            viewing.record.id != null
              ? saveExperimentConclusion(viewing.record.id, text)
              : Promise.resolve()
          }
        />
      )}
    </div>
  )
}

/** 实验列表的筛选 / 排序工具条：关键词 + 旋钮类型 + 结果状态 + 时间次序，可一键清空 */
function ExperimentFilters(props: {
  filter: ExperimentFilter
  onChange: (next: ExperimentFilter) => void
}): JSX.Element {
  const { filter, onChange } = props
  const hasFilter = !isDefaultExperimentFilter(filter)
  const patch = (p: Partial<ExperimentFilter>): void => onChange({ ...filter, ...p })

  return (
    <div className="exp-filters">
      <input
        className="exp-search"
        type="search"
        value={filter.keyword}
        placeholder="搜索名称 / 结论关键词"
        aria-label="搜索实验名称或结论关键词"
        onChange={(ev) => patch({ keyword: ev.target.value })}
      />
      <div className="exp-filter-row">
        <select
          className="exp-select"
          aria-label="按旋钮类型筛选"
          value={filter.param}
          onChange={(ev) => patch({ param: ev.target.value as '' | keyof SimParams })}
        >
          <option value="">全部旋钮</option>
          {EXPERIMENT_PARAMS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        <select
          className="exp-select"
          aria-label="按实验结果筛选"
          value={filter.status}
          onChange={(ev) =>
            patch({ status: ev.target.value as ExperimentFilter['status'] })
          }
        >
          <option value="">全部结果</option>
          {EXPERIMENT_STATUS_OPTIONS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          className="exp-select"
          aria-label="按保存时间排序"
          value={filter.timeOrder}
          onChange={(ev) => patch({ timeOrder: ev.target.value as ExperimentFilter['timeOrder'] })}
        >
          <option value="desc">时间倒序</option>
          <option value="asc">时间正序</option>
        </select>
      </div>
      <div className="exp-filter-foot">
        <button
          type="button"
          className="exp-filter-reset"
          disabled={!hasFilter}
          onClick={() => onChange(DEFAULT_EXPERIMENT_FILTER)}
        >
          清空筛选条件
        </button>
      </div>
    </div>
  )
}

function ExperimentItem(props: {
  meta: ExperimentMeta
  onOpen: () => void
  onDelete: () => void
}): JSX.Element {
  const { meta, onOpen, onDelete } = props
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!confirming) return
    const timer = setTimeout(() => setConfirming(false), CONFIRM_MS)
    return () => clearTimeout(timer)
  }, [confirming])

  const { condition: cond, outcome } = meta
  const pmeta = PARAM_META[cond.param]
  const status = armStatus(outcome.variant.metrics)

  return (
    <li>
      <div className="exp-thumbs">
        <img src={meta.record.baseline_thumb} alt="基准器形" />
        <img src={meta.record.variant_thumb} alt="实验器形" />
      </div>
      <div className="snap-info">
        <b>{meta.record.name}</b>
        <span className="snap-statusline">
          <i className={`snap-badge ${status.tone}`}>{status.status}</i>
          {cond.fromFrame}-{cond.toFrame}帧 · {pmeta.label}→{cond.value}
          {pmeta.unit}
        </span>
        {meta.record.conclusion && <span className="snap-note">{meta.record.conclusion}</span>}
        <span>{new Date(meta.record.created_at).toLocaleString()}</span>
        <div className="snap-actions">
          <button onClick={onOpen}>查看对照</button>
          {confirming ? (
            <>
              <button className="danger-btn confirm" onClick={onDelete}>
                确认删除
              </button>
              <button onClick={() => setConfirming(false)}>取消</button>
            </>
          ) : (
            <button className="danger-btn" onClick={() => setConfirming(true)}>
              删除
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

/** 只读查看一条已保存实验：条件、双臂器形、指标差值、报废状态；结论可补记 / 修改 */
function ExperimentViewer(props: {
  meta: ExperimentMeta
  onClose: () => void
  onDelete: () => Promise<void>
  onSaveConclusion: (text: string) => Promise<void>
}): JSX.Element {
  const { meta, onClose, onDelete, onSaveConclusion } = props
  const { condition: cond, outcome } = meta
  const pmeta = PARAM_META[cond.param]
  const deltas = computeMetricDeltas(outcome.baseline.metrics, outcome.variant.metrics)
  const baseStatus = armStatus(outcome.baseline.metrics)
  const varStatus = armStatus(outcome.variant.metrics)
  const baseSummary = summarizeBaselineValues(cond.baselineValues)

  const [conclusion, setConclusion] = useState(meta.record.conclusion)
  const [saving, setSaving] = useState(false)
  const dirty = conclusion !== meta.record.conclusion

  const saveConclusion = async (): Promise<void> => {
    setSaving(true)
    try {
      await onSaveConclusion(conclusion)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="exp-overlay" onClick={onClose}>
      <div className="exp-dialog" onClick={(ev) => ev.stopPropagation()}>
        <header className="exp-head">
          <h3>{meta.record.name}</h3>
          <button className="exp-close" onClick={onClose} title="关闭">
            ✕
          </button>
        </header>
        <div className="exp-result">
          <div className="exp-arms">
            <figure className="exp-arm">
              <figcaption>基准方案</figcaption>
              <img src={meta.record.baseline_thumb} alt="基准方案末帧器形" />
              <i className={`snap-badge ${baseStatus.tone}`}>{baseStatus.status}</i>
            </figure>
            <span className="exp-vs">对照</span>
            <figure className="exp-arm">
              <figcaption>实验方案</figcaption>
              <img src={meta.record.variant_thumb} alt="实验方案末帧器形" />
              <i className={`snap-badge ${varStatus.tone}`}>{varStatus.status}</i>
            </figure>
          </div>

          <p className="muted small exp-condline">
            基于 {cond.baselineFrames} 帧基准轨迹，第 {cond.fromFrame}–{cond.toFrame} 帧（共{' '}
            {cond.toFrame - cond.fromFrame} 帧）将 <b>{pmeta.label}</b> 由基准{' '}
            {baseSummary.avg.toFixed(pmeta.step < 1 ? 2 : 0)}
            {pmeta.unit}（区间均值）改为 <b>{cond.value}{pmeta.unit}</b>，其他输入逐帧一致。
            实验于 {new Date(meta.record.created_at).toLocaleString()} 保存。
          </p>

          <table className="exp-table">
            <thead>
              <tr>
                <th>关键指标</th>
                <th>基准</th>
                <th>实验</th>
                <th>差值</th>
              </tr>
            </thead>
            <tbody>
              {deltas.map((d) => (
                <tr key={d.key}>
                  <td>{d.label}</td>
                  <td>{d.baseline.toFixed(d.precision)}</td>
                  <td>{d.variant.toFixed(d.precision)}</td>
                  <td className={`exp-delta ${d.tone}`}>{formatDelta(d)}</td>
                </tr>
              ))}
              <tr>
                <td>是否报废</td>
                <td>{outcome.baseline.metrics.isRuined ? '是' : '否'}</td>
                <td>{outcome.variant.metrics.isRuined ? '是' : '否'}</td>
                <td className={outcome.variant.metrics.isRuined ? 'exp-delta bad' : 'exp-delta good'}>
                  {outcome.variant.metrics.isRuined ? '报废' : '完好'}
                </td>
              </tr>
            </tbody>
          </table>

          <label className="exp-conclusion">
            <span>
              用户结论
              <small className="muted">（{conclusion.length}/{MAX_EXPERIMENT_CONCLUSION} 字）</small>
            </span>
            <textarea
              value={conclusion}
              maxLength={MAX_EXPERIMENT_CONCLUSION}
              placeholder="补记实验结论…"
              onChange={(ev) => setConclusion(ev.target.value)}
            />
          </label>

          <div className="exp-foot">
            <button className="danger-btn" onClick={() => void onDelete()}>
              删除实验
            </button>
            <button className="primary" onClick={() => void saveConclusion()} disabled={saving || !dirty}>
              {saving ? '保存中…' : dirty ? '保存结论' : '结论已保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
