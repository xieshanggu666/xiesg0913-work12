import { useMemo, useState } from 'react'
import type { TrajFrame } from '@shared/types'
import { drawThumbnail } from '../engine/render'
import { DEFAULT_INPUT } from '../engine/engine'
import { FIXED_DT } from '../engine/constants'
import { useStudio } from '../state/store'
import {
  EXPERIMENT_PARAMS,
  PARAM_META,
  armStatus,
  buildExperimentCondition,
  computeMetricDeltas,
  formatDelta,
  readBaselineValues,
  runExperiment,
  summarizeBaselineValues,
  MAX_EXPERIMENT_CONCLUSION,
  MAX_EXPERIMENT_NAME,
  type ExperimentCondition,
  type ExperimentOutcome
} from '../engine/experiment'

/**
 * 工艺实验弹窗：
 * 1) 设置——基准轨迹只作只读复制，选帧区间 + 一项旋钮与实验值；
 * 2) 双臂离线运行（不改动画布上的作品）；
 * 3) 结果——两张器形缩略图、关键指标差值表、是否报废；
 * 4) 写用户结论并保存条件 / 结果 / 结论。
 */
export function ExperimentDialog(props: { frames: TrajFrame[]; onClose: () => void }): JSX.Element {
  const { frames, onClose } = props
  const saveExperimentResult = useStudio((s) => s.saveExperimentResult)
  const showToast = useStudio((s) => s.showToast)

  const n = frames.length

  const [name, setName] = useState('')
  const [fromFrame, setFromFrame] = useState(0)
  const [toFrame, setToFrame] = useState(n)
  const [paramKey, setParamKey] = useState<keyof typeof PARAM_META>('temperature')
  const meta = PARAM_META[paramKey]
  const baselineSummary = useMemo(
    () => summarizeBaselineValues(readBaselineValues(frames, paramKey, fromFrame, toFrame)),
    [frames, paramKey, fromFrame, toFrame]
  )
  const [value, setValue] = useState<number>(meta.min)

  const [phase, setPhase] = useState<'setup' | 'running' | 'result'>('setup')
  const [cond, setCond] = useState<ExperimentCondition | null>(null)
  const [outcome, setOutcome] = useState<ExperimentOutcome | null>(null)
  const [thumbs, setThumbs] = useState<{ baseline: string; variant: string } | null>(null)
  const [conclusion, setConclusion] = useState('')
  const [saving, setSaving] = useState(false)

  // 帧号只接受整数：输入框虽限制了上下界，浏览器仍允许手输小数；
  // 实时预览会按帧下标读基准参数，故在入口立即取整并钳制到合法区间
  const changeFrom = (raw: number): void => {
    const f = Math.max(0, Math.min(toFrame - 1, Math.floor(Number(raw) || 0)))
    setFromFrame(f)
  }
  const changeTo = (raw: number): void => {
    const t = Math.max(fromFrame + 1, Math.min(n, Math.floor(Number(raw) || n)))
    setToFrame(t)
  }

  const switchParam = (k: keyof typeof PARAM_META): void => {
    setParamKey(k)
    setValue(PARAM_META[k].min)
  }

  const run = (): void => {
    let condition: ExperimentCondition
    try {
      condition = buildExperimentCondition(frames, { param: paramKey, value, fromFrame, toFrame })
    } catch (err) {
      showToast((err as Error).message)
      return
    }
    setCond(condition)
    setPhase('running')
    // 让“运行中”先渲染一帧；整条轨迹两次离线推进通常仅几十到几百毫秒
    setTimeout(() => {
      try {
        const result = runExperiment(frames, condition)
        // 器形缩略图在 DOM 侧生成（引擎为纯 TS，无 canvas 依赖）；
        // 末帧体色按玻璃自身温度渲染，传入默认输入即可
        const baseline = drawThumbnail(result.baseline.glass, DEFAULT_INPUT, result.baseline.metrics)
        const variant = drawThumbnail(result.variant.glass, DEFAULT_INPUT, result.variant.metrics)
        setOutcome(result)
        setThumbs({ baseline, variant })
        setName(
          `${PARAM_META[condition.param].label} ${condition.value}${PARAM_META[condition.param].unit}（${condition.fromFrame}-${condition.toFrame}帧）`
        )
        setPhase('result')
      } catch (err) {
        showToast(`实验运行失败：${(err as Error).message}`)
        setPhase('setup')
      }
    }, 30)
  }

  const save = async (): Promise<void> => {
    if (!cond || !outcome || !thumbs) return
    setSaving(true)
    try {
      const ok = await saveExperimentResult({
        name,
        condition: cond,
        outcome,
        baselineThumb: thumbs.baseline,
        variantThumb: thumbs.variant,
        conclusion
      })
      if (ok) onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="exp-overlay" onClick={onClose}>
      <div className="exp-dialog" onClick={(ev) => ev.stopPropagation()}>
        <header className="exp-head">
          <h3>工艺实验</h3>
          <button className="exp-close" onClick={onClose} title="关闭">
            ✕
          </button>
        </header>

        {phase !== 'result' && (
          <div className="exp-setup">
            <p className="muted small exp-intro">
              以当前成形轨迹（{n} 帧，约 {(n * FIXED_DT).toFixed(1)} 秒）为基准复制一份实验方案：
              只允许在所选帧区间内改动<b>一项</b>旋钮参数，工具头、指针、按压力度与其他旋钮逐帧保持一致。
            </p>

            <div className="exp-row">
              <label className="exp-field">
                <span>起始帧（含）</span>
                <input
                  type="number"
                  min={0}
                  max={toFrame - 1}
                  step={1}
                  value={fromFrame}
                  disabled={phase === 'running'}
                  onChange={(ev) => changeFrom(Number(ev.target.value))}
                />
              </label>
              <label className="exp-field">
                <span>结束帧（不含）</span>
                <input
                  type="number"
                  min={fromFrame + 1}
                  max={n}
                  step={1}
                  value={toFrame}
                  disabled={phase === 'running'}
                  onChange={(ev) => changeTo(Number(ev.target.value))}
                />
              </label>
              <span className="exp-rangeinfo muted small">
                共 {Math.max(0, toFrame - fromFrame)} 帧
              </span>
            </div>

            <div className="exp-params">
              {EXPERIMENT_PARAMS.map((p) => (
                <button
                  key={p.key}
                  className={p.key === paramKey ? 'exp-param active' : 'exp-param'}
                  disabled={phase === 'running'}
                  onClick={() => switchParam(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <label className="slider">
              <span className="slider-label">
                {meta.label}实验值
                <b>
                  {value}
                  {meta.unit}
                </b>
              </span>
              <input
                type="range"
                min={meta.min}
                max={meta.max}
                step={meta.step}
                value={value}
                disabled={phase === 'running'}
                onChange={(ev) => setValue(Number(ev.target.value))}
              />
            </label>
            <p className="muted small">
              区间内基准取值：
              {Number.isFinite(baselineSummary.min)
                ? ` ${baselineSummary.min.toFixed(meta.step < 1 ? 2 : 0)} ~ ${baselineSummary.max.toFixed(
                    meta.step < 1 ? 2 : 0
                  )}${meta.unit}，平均 ${baselineSummary.avg.toFixed(meta.step < 1 ? 2 : 0)}${meta.unit}`
                : ' —'}
              ；区间外所有帧与基准严格一致。
            </p>

            <div className="exp-foot">
              <button onClick={onClose} disabled={phase === 'running'}>
                取消
              </button>
              <button className="primary" onClick={run} disabled={phase === 'running'}>
                {phase === 'running' ? '双臂运行中…' : '▶ 分别运行基准与实验'}
              </button>
            </div>
          </div>
        )}

        {phase === 'result' && cond && outcome && thumbs && (
          <ExperimentResult
            name={name}
            setName={setName}
            cond={cond}
            outcome={outcome}
            thumbs={thumbs}
            conclusion={conclusion}
            setConclusion={setConclusion}
            saving={saving}
            onRerun={() => setPhase('setup')}
            onSave={() => void save()}
          />
        )}
      </div>
    </div>
  )
}

function ExperimentResult(props: {
  name: string
  setName: (v: string) => void
  cond: ExperimentCondition
  outcome: ExperimentOutcome
  thumbs: { baseline: string; variant: string }
  conclusion: string
  setConclusion: (v: string) => void
  saving: boolean
  onRerun: () => void
  onSave: () => void
}): JSX.Element {
  const { name, setName, cond, outcome, thumbs, conclusion, setConclusion, saving, onRerun, onSave } = props
  const meta = PARAM_META[cond.param]
  const deltas = computeMetricDeltas(outcome.baseline.metrics, outcome.variant.metrics)
  const baseStatus = armStatus(outcome.baseline.metrics)
  const varStatus = armStatus(outcome.variant.metrics)
  const baseSummary = summarizeBaselineValues(cond.baselineValues)

  return (
    <div className="exp-result">
      <div className="exp-arms">
        <figure className="exp-arm">
          <figcaption>基准方案</figcaption>
          <img src={thumbs.baseline} alt="基准方案末帧器形" />
          <i className={`snap-badge ${baseStatus.tone}`}>{baseStatus.status}</i>
        </figure>
        <span className="exp-vs">对照</span>
        <figure className="exp-arm">
          <figcaption>实验方案</figcaption>
          <img src={thumbs.variant} alt="实验方案末帧器形" />
          <i className={`snap-badge ${varStatus.tone}`}>{varStatus.status}</i>
        </figure>
      </div>

      <p className="muted small exp-condline">
        第 {cond.fromFrame}–{cond.toFrame} 帧（共 {cond.toFrame - cond.fromFrame} 帧）将
        <b>
          {' '}
          {meta.label}
        </b>{' '}
        由基准 {baseSummary.avg.toFixed(meta.step < 1 ? 2 : 0)}
        {meta.unit}（区间均值）改为 <b>{cond.value}{meta.unit}</b>，其他输入逐帧一致。
        {outcome.ruinedChanged && (
          <b className={outcome.variant.metrics.isRuined ? 'exp-bad' : 'exp-good'}>
            {' '}
            · 报废状态发生变化：实验{outcome.variant.metrics.isRuined ? '已报废' : '未报废'}
          </b>
        )}
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
          placeholder="记录你的判断，如：区间内降温 40℃ 后颈径收窄但未开裂，可作为收颈参数。"
          onChange={(ev) => setConclusion(ev.target.value)}
        />
      </label>

      <div className="exp-nameform">
        <input
          value={name}
          maxLength={MAX_EXPERIMENT_NAME}
          placeholder="实验名称"
          onChange={(ev) => setName(ev.target.value)}
        />
      </div>

      <div className="exp-foot">
        <button onClick={onRerun} disabled={saving}>
          ← 修改条件重跑
        </button>
        <button className="primary" onClick={onSave} disabled={saving || !name.trim()}>
          {saving ? '保存中…' : '保存实验条件、结果与结论'}
        </button>
      </div>
    </div>
  )
}
