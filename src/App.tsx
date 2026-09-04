import { useMemo, useState } from "react";
import { PATCHES } from "./data/patches";
import { lintSource } from "./lib/lint";
import PatchPanel from "./components/PatchPanel";
import { cn } from "./utils/cn";

const CRASH_CHAIN = [
  { at: "gpsMap.js:197", what: "ctx.get('quests') — hard lookup on an optional service" },
  { at: "registry.js:32", what: 'throw new Error(`subsystem "quests" not registered`)' },
  { at: "Engine.step()", what: "unhandled — frame 1 aborts during raid deployment" },
  { at: "blocked", what: "HealthSystem (7-limb) activation · weapon hit registration · bot weapon sync · 'M' key binding" },
  { at: "fallback", what: "locomotion drops to un-gated legacy path → wall sliding, roof warps" },
];

const GATES = [
  { id: "G1", name: "Structural wall", probe: "swept ray · knee + chest", fail: "tangential slide once, else rollback" },
  { id: "G2", name: "Step / ceiling", probe: "floor Δ ≤ 0.42 m · headroom ≥ 1.84 m", fail: "rollback · reason ledge | ceiling | void" },
  { id: "G3", name: "Navmesh", probe: "contains / isOnMesh / nearest ≤ r", fail: "rollback · reason offmesh" },
  { id: "V", name: "Vertical settle", probe: "snap ≤ 0.55 m · post-snap headroom · NaN fence", fail: "rollback · reason roofwarp | settle" },
];

export default function App() {
  const [active, setActive] = useState(PATCHES[0].id);
  const patch = PATCHES.find((p) => p.id === active) ?? PATCHES[0];

  const totals = useMemo(() => {
    let lines = 0;
    let issues = 0;
    for (const p of PATCHES) {
      const r = lintSource(p.source);
      lines += r.lines;
      issues += r.issues.length;
    }
    return { lines, issues, files: PATCHES.length };
  }, []);

  return (
    <div className="min-h-screen bg-[#08090b] text-zinc-200 antialiased">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,rgba(245,158,11,0.08),transparent_55%)]" />

      <header className="relative border-b border-zinc-800/80">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-end justify-between gap-4 px-6 py-5">
          <div>
            <div className="font-mono text-[11px] tracking-[0.3em] text-amber-400">EFL · ESCAPE FROM LARPOV · CORE SYSTEMS</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50">Hotfix Blueprint Console</h1>
            <p className="mt-1 max-w-3xl text-sm text-zinc-400">
              Production-grade modifications resolving the frame-1 registry deadlock, the AI locomotion gate bypass, and the
              lobby / training-death raid rules. Semicolon-free, CRLF on copy and download, no stubs.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Kpi label="FILES" value={String(totals.files)} />
            <Kpi label="LINES" value={totals.lines.toLocaleString()} />
            <Kpi label="STYLE VIOLATIONS" value={String(totals.issues)} tone={totals.issues === 0 ? "ok" : "bad"} />
          </div>
        </div>
      </header>

      <main className="relative mx-auto grid max-w-[1500px] gap-6 px-6 py-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="space-y-6">
          <nav className="space-y-1">
            <div className="mb-2 font-mono text-[11px] tracking-widest text-zinc-500">PATCH SET</div>
            {PATCHES.map((p) => {
              const on = p.id === patch.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setActive(p.id)}
                  className={cn(
                    "block w-full rounded-md border px-3 py-2 text-left transition",
                    on
                      ? "border-amber-500/60 bg-amber-500/10"
                      : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 hover:bg-zinc-900",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] tracking-widest text-zinc-500">{p.requirement}</span>
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        p.severity === "fatal" ? "bg-red-400" : p.severity === "high" ? "bg-amber-400" : "bg-sky-400",
                      )}
                    />
                  </div>
                  <div className={cn("mt-0.5 text-sm", on ? "text-amber-100" : "text-zinc-200")}>{p.title}</div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">{p.target}</div>
                </button>
              );
            })}
          </nav>

          <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-4">
            <div className="font-mono text-[11px] tracking-widest text-red-400">CRASH CHAIN · FRAME 1</div>
            <ol className="mt-3 space-y-2.5">
              {CRASH_CHAIN.map((c, i) => (
                <li key={c.at} className="flex gap-2.5">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-red-700 font-mono text-[9px] text-red-300">
                    {i + 1}
                  </span>
                  <div>
                    <div className="font-mono text-[11px] text-red-300">{c.at}</div>
                    <div className="text-[12px] leading-snug text-zinc-400">{c.what}</div>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="font-mono text-[11px] tracking-widest text-zinc-500">LOCOMOTION GATE MATRIX</div>
            <div className="mt-3 space-y-2">
              {GATES.map((g) => (
                <div key={g.id} className="rounded border border-zinc-800 bg-[#0b0d10] p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-emerald-500/15 px-1.5 font-mono text-[10px] text-emerald-300">{g.id}</span>
                    <span className="text-[13px] text-zinc-200">{g.name}</span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-zinc-500">{g.probe}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-amber-400/80">✕ {g.fail}</div>
                </div>
              ))}
              <div className="rounded border border-amber-900/50 bg-amber-950/20 p-2.5 font-mono text-[11px] leading-relaxed text-amber-200/80">
                on fail → pos.copy(loco.prev) · speed = 0 · moveDir = tangent(n) · emit ai:redirect
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="font-mono text-[11px] tracking-widest text-zinc-500">RAID END SETTLEMENT</div>
            <div className="mt-3 space-y-1.5 font-mono text-[11px]">
              <Row k="extracted" v="keepLoadout · bankRaid" tone="ok" />
              <Row k="killed · isTraining" v="HARD BYPASS · kit intact · → stash" tone="ok" />
              <Row k="killed · live" v="serialize → applyDeath → wipe(keepSecure)" tone="bad" />
              <Row k="mia / timeout" v="same as live death" tone="bad" />
            </div>
          </div>
        </aside>

        <PatchPanel key={patch.id} patch={patch} />
      </main>

      <footer className="relative border-t border-zinc-800/80">
        <div className="mx-auto max-w-[1500px] px-6 py-4 font-mono text-[11px] text-zinc-600">
          Registry contract honoured: get() throws · peek() null · has() boolean. Files in <span className="text-zinc-400">patches/</span> mirror
          the EFL tree; COPY / DOWNLOAD emit CRLF; <span className="text-zinc-400">.gitattributes</span> enforces it on commit.
        </div>
      </footer>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "ok" | "bad" }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2">
      <div className="font-mono text-[10px] tracking-widest text-zinc-500">{label}</div>
      <div className={cn("font-mono text-[15px]", tone === "ok" ? "text-emerald-300" : tone === "bad" ? "text-red-300" : "text-zinc-100")}>
        {value}
      </div>
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone: "ok" | "bad" }) {
  return (
    <div className="flex items-start justify-between gap-2 rounded border border-zinc-800 bg-[#0b0d10] px-2 py-1.5">
      <span className="text-zinc-400">{k}</span>
      <span className={cn("text-right", tone === "ok" ? "text-emerald-300" : "text-red-300")}>{v}</span>
    </div>
  );
}
