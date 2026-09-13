import type { SimParams } from '@shared/types'
import { SPIN_MAX, TEMP_FLAME_MAX, TEMP_FLAME_MIN } from '../engine/constants'
import { useStudio } from '../state/store'

function Slider<K extends keyof SimParams>(props: {
  k: K
  label: string
  min: number
  max: number
  step: number
  unit: string
}): JSX.Element {
  const params = useStudio((s) => s.params)
  const setParam = useStudio((s) => s.setParam)
  const { k, label, min, max, step, unit } = props
  return (
    <label className="slider">
      <span className="slider-label">
        {label}
        <b>
          {Math.round(params[k] as number)}
          {unit}
        </b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={params[k] as number}
        onChange={(ev) => setParam(k, Number(ev.target.value) as SimParams[K])}
      />
    </label>
  )
}

export function Controls(): JSX.Element {
  return (
    <div className="panel controls">
      <h3>工坊旋钮</h3>
      <Slider k="temperature" label="火焰温度" min={TEMP_FLAME_MIN} max={TEMP_FLAME_MAX} step={10} unit="℃" />
      <Slider k="spin" label="旋转速度" min={0} max={SPIN_MAX} step={1} unit=" rpm" />
      <Slider k="pullForce" label="拉伸力度" min={0} max={1} step={0.01} unit="" />
      <Slider k="blowPressure" label="吹气压力" min={0} max={1} step={0.01} unit="" />
      <p className="muted small">
        旋转影响加热均匀度、气泡逸出与离心微鼓；对冷玻璃施力会把应力锁进器身。
      </p>
    </div>
  )
}
