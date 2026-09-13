import { useStudio } from '../state/store'

function Bar(props: { label: string; value: number; max: number; warn?: boolean; format?: (v: number) => string }): JSX.Element {
  const pct = Math.min(1, props.value / props.max)
  return (
    <div className="metric">
      <span>
        {props.label}
        <b className={props.warn && pct > 0.7 ? 'danger' : ''}>
          {props.format ? props.format(props.value) : props.value.toFixed(2)}
        </b>
      </span>
      <div className="bar">
        <i
          className={props.warn && pct > 0.7 ? 'danger' : ''}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  )
}

export function MetricsPanel(): JSX.Element {
  const metrics = useStudio((s) => s.metrics)
  const frameTick = useStudio((s) => s.frameTick)
  void frameTick

  return (
    <div className="panel metrics">
      <h3>玻璃状态</h3>
      <Bar label="平均温度" value={metrics.avgTemp} max={1200} format={(v) => `${v.toFixed(0)} ℃`} />
      <Bar label="平均壁厚" value={metrics.avgThickness} max={0.5} format={(v) => `${v.toFixed(3)}`} />
      <Bar label="气泡含量" value={metrics.avgBubbles} max={1} warn />
      <Bar label="最大应力" value={metrics.maxStress} max={150} warn />
      <Bar label="裂纹程度" value={metrics.maxCracks} max={1} warn />
      <div className={`status ${metrics.isRuined ? 'bad' : metrics.isVase ? 'good' : ''}`}>
        {metrics.isRuined ? '⚠ 器身贯穿开裂，已报废' : metrics.isVase ? '✓ 花瓶成型' : '○ 尚未成型：鼓腹并收出瓶口'}
      </div>
      <p className="muted small">
        腹径 {(metrics.bodyRadius * 100).toFixed(0)} · 颈径 {(metrics.neckRadius * 100).toFixed(0)} ·
        口径 {(metrics.rimRadius * 100).toFixed(0)} · 伸长 ×{metrics.elongation.toFixed(2)}
      </p>
    </div>
  )
}
