import { useState } from 'react'
import VaultPanel from './panels/VaultPanel'
import GpsPanel from './panels/GpsPanel'
import FactionPanel from './panels/FactionPanel'

type Tab = 'vault' | 'gps' | 'faction'

const TABS: Array<{ id: Tab; label: string; sub: string }> = [
  { id: 'vault', label: '01 · AI vault physics', sub: 'src/ai/agent.js — roof warp fix' },
  { id: 'gps', label: '02 · GPS tactical map', sub: 'src/ui/gpsMap.js — markers + tracking' },
  { id: 'faction', label: '03 · Faction compiler', sub: 'src/ai/parts.js + textures.js' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('vault')

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <header className="efl-panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.3em] text-emerald-400/70">Escape From Larpov · systems console</div>
          <h1 className="text-lg font-semibold tracking-wide text-emerald-50">EFL — Physics · Navigation · Identity</h1>
        </div>
        <nav className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button key={t.id} className="efl-btn text-left" data-active={tab === t.id} onClick={() => setTab(t.id)}>
              <div>{t.label}</div>
              <div className="normal-case tracking-normal text-emerald-100/40">{t.sub}</div>
            </button>
          ))}
        </nav>
      </header>

      <main className="min-h-0 flex-1">
        {tab === 'vault' && <VaultPanel />}
        {tab === 'gps' && <GpsPanel />}
        {tab === 'faction' && <FactionPanel />}
      </main>

      <footer className="flex flex-wrap gap-x-6 gap-y-1 px-1 text-[10px] text-emerald-100/35">
        <span>gate 1 · _tryVault probes ≤ 0.45 m + 1.2 m clearance before the step is committed</span>
        <span>gate 2 · measured rise must sit inside STEP_CEILING</span>
        <span>gate 3 · ground re-probe capped at y + STEP_CEILING — a roof can never be the answer</span>
        <span>_sanitize · non-finite transforms roll back, never reach the skinning shader</span>
      </footer>
    </div>
  )
}
