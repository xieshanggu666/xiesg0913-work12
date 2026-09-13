import type { ToolId } from '@shared/types'
import { useStudio } from '../state/store'

const TOOLS: Array<{ id: ToolId; label: string; icon: string; hint: string }> = [
  { id: 'flame', label: '火焰', icon: '🔥', hint: '局部加热，使玻璃可塑' },
  { id: 'blow', label: '吹管', icon: '🫧', hint: '热区鼓腹、拉薄壁、开口' },
  { id: 'pull', label: '拉制', icon: '↕️', hint: '收窄颈肩并拉长器身' },
  { id: 'marver', label: '炭铲', icon: '▬', hint: '挤压整形、压灭气泡' },
  { id: 'cool', label: '风冷', icon: '❄️', hint: '定点快速冷却（易裂）' }
]

export function Toolbar(): JSX.Element {
  const tool = useStudio((s) => s.tool)
  const setTool = useStudio((s) => s.setTool)
  const replaying = useStudio((s) => s.replaying)

  return (
    <div className="toolbar">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`tool-btn ${tool === t.id ? 'active' : ''}`}
          disabled={replaying}
          title={t.hint}
          onClick={() => setTool(t.id)}
        >
          <span className="tool-icon">{t.icon}</span>
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  )
}
