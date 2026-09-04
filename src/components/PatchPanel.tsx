import { useMemo, useState } from "react";
import type { Patch } from "../data/patches";
import { countCRLF, lintSource, toCRLF } from "../lib/lint";
import CodeView from "./CodeView";
import { cn } from "../utils/cn";

type Props = { patch: Patch };

const MODE_LABEL: Record<Patch["mode"], string> = {
  "block-rewrite": "COMPLETE BLOCK REWRITE",
  "new-module": "NEW MODULE — FULL BODY",
  delta: "ENTRY-POINT DELTA",
  config: "REPO CONFIG",
};

const SEVERITY: Record<Patch["severity"], string> = {
  fatal: "border-red-500/60 bg-red-500/10 text-red-300",
  high: "border-amber-500/60 bg-amber-500/10 text-amber-300",
  medium: "border-sky-500/60 bg-sky-500/10 text-sky-300",
};

function download(name: string, content: string) {
  const blob = new Blob([content], { type: "text/javascript;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function PatchPanel({ patch }: Props) {
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"source" | "brief">("source");

  const report = useMemo(() => lintSource(patch.source), [patch.source]);
  const crlfSource = useMemo(() => toCRLF(patch.source), [patch.source]);
  const endings = useMemo(() => countCRLF(crlfSource), [crlfSource]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(crlfSource);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-800 pb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-[11px] tracking-widest text-zinc-300">
              {patch.requirement}
            </span>
            <span className={cn("rounded border px-2 py-0.5 font-mono text-[11px] tracking-widest", SEVERITY[patch.severity])}>
              {patch.severity.toUpperCase()}
            </span>
            <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] tracking-widest text-emerald-300">
              {MODE_LABEL[patch.mode]}
            </span>
          </div>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-100">{patch.title}</h2>
          <p className="mt-1 font-mono text-[13px] text-amber-300">→ {patch.target}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={copy}
            className={cn(
              "rounded-md border px-3 py-1.5 font-mono text-[12px] tracking-wide transition",
              copied
                ? "border-emerald-500 bg-emerald-500/20 text-emerald-200"
                : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800",
            )}
          >
            {copied ? "COPIED · CRLF" : "COPY (CRLF)"}
          </button>
          <button
            onClick={() => download(patch.downloadName, crlfSource)}
            className="rounded-md border border-amber-600/60 bg-amber-500/10 px-3 py-1.5 font-mono text-[12px] tracking-wide text-amber-200 transition hover:bg-amber-500/20"
          >
            DOWNLOAD
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="LINES" value={String(report.lines)} />
        <Stat label="BYTES" value={report.bytes.toLocaleString()} />
        <Stat
          label="TRAILING ;"
          value={report.issues.filter((i) => i.kind === "semicolon").length === 0 ? "0 · CLEAN" : String(report.issues.length)}
          tone={report.clean ? "ok" : "bad"}
        />
        <Stat label="LINE ENDINGS" value={`CRLF ×${endings.crlf}${endings.lf ? ` · LF ×${endings.lf}` : ""}`} tone={endings.lf === 0 ? "ok" : "bad"} />
      </div>

      <div className="flex gap-1 border-b border-zinc-800">
        {(["source", "brief"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 font-mono text-[12px] tracking-widest transition",
              tab === t ? "border-amber-400 text-amber-200" : "border-transparent text-zinc-500 hover:text-zinc-300",
            )}
          >
            {t === "source" ? "SOURCE" : "ENGINEERING BRIEF"}
          </button>
        ))}
      </div>

      {tab === "source" ? (
        <CodeView source={patch.source} issues={report.issues} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Block title="Summary">
            <p className="text-sm leading-relaxed text-zinc-300">{patch.summary}</p>
            {patch.rootCause && (
              <div className="mt-4 rounded-md border border-red-900/60 bg-red-950/30 p-3">
                <div className="font-mono text-[11px] tracking-widest text-red-400">ROOT CAUSE</div>
                <p className="mt-1 text-sm leading-relaxed text-red-100/90">{patch.rootCause}</p>
              </div>
            )}
            {patch.events && (
              <div className="mt-4">
                <div className="font-mono text-[11px] tracking-widest text-zinc-500">EVENTS TOUCHED</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {patch.events.map((e) => (
                    <span key={e} className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-[11px] text-zinc-300">
                      {e}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Block>
          <Block title="Guarantees">
            <ul className="space-y-2">
              {patch.guarantees.map((g) => (
                <li key={g} className="flex gap-2 text-sm leading-relaxed text-zinc-300">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                  <span>{g}</span>
                </li>
              ))}
            </ul>
          </Block>
          <Block title="Injection steps" className="lg:col-span-2">
            <ol className="space-y-2">
              {patch.injection.map((s, i) => (
                <li key={s} className="flex gap-3 text-sm leading-relaxed text-zinc-300">
                  <span className="shrink-0 font-mono text-[12px] text-amber-400">{String(i + 1).padStart(2, "0")}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          </Block>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "bad" }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2">
      <div className="font-mono text-[10px] tracking-widest text-zinc-500">{label}</div>
      <div
        className={cn(
          "mt-0.5 font-mono text-[13px]",
          tone === "ok" ? "text-emerald-300" : tone === "bad" ? "text-red-300" : "text-zinc-200",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function Block({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-zinc-800 bg-zinc-900/40 p-4", className)}>
      <div className="mb-3 font-mono text-[11px] tracking-widest text-zinc-500">{title.toUpperCase()}</div>
      {children}
    </div>
  );
}
