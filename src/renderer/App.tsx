import { useEffect } from 'react'
import { Stage } from './components/Stage'
import { Toolbar } from './components/Toolbar'
import { Controls } from './components/Controls'
import { MetricsPanel } from './components/MetricsPanel'
import { Snapshots, Timeline } from './components/Snapshots'
import { ReplayTimeline } from './components/ReplayTimeline'
import { StoryboardBar } from './components/StoryboardBar'
import { ExperimentBar } from './components/ExperimentBar'
import { useStudio } from './state/store'

export default function App(): JSX.Element {
  const refreshSnapshots = useStudio((s) => s.refreshSnapshots)
  const toast = useStudio((s) => s.toast)
  const replaying = useStudio((s) => s.replaying)

  useEffect(() => {
    void refreshSnapshots()
  }, [refreshSnapshots])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◉</span> 琉璃工房
          <small>Glass Forge — 离线虚拟吹制</small>
        </div>
        {replaying && <span className="replay-badge">回放中</span>}
      </header>
      <div className="layout">
        <aside className="left">
          <Toolbar />
          <Controls />
          <MetricsPanel />
        </aside>
        <main className="center">
          <Stage />
          <ReplayTimeline />
        </main>
        <aside className="right">
          <Timeline />
          <ExperimentBar />
          <Snapshots />
          <StoryboardBar />
        </aside>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
