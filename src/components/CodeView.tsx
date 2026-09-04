import { useMemo } from "react";
import type { LintIssue } from "../lib/lint";

type Props = {
  source: string;
  issues: LintIssue[];
};

function classify(line: string): string {
  const t = line.trim();
  if (t.startsWith("/*") || t.startsWith("*") || t.startsWith("//")) return "text-zinc-500";
  if (/^(export\s+)?(const|let|function|class|import|return|async|if|else|for|while|try|catch|throw)\b/.test(t)) {
    return "text-zinc-200";
  }
  return "text-zinc-300";
}

export default function CodeView({ source, issues }: Props) {
  const lines = useMemo(() => source.split(/\r?\n/), [source]);
  const flagged = useMemo(() => new Set(issues.map((i) => i.line)), [issues]);

  return (
    <div className="relative overflow-auto rounded-lg border border-zinc-800 bg-[#0b0d10] font-mono text-[12px] leading-[1.55]">
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((line, i) => {
            const n = i + 1;
            const bad = flagged.has(n);
            return (
              <tr key={n} className={bad ? "bg-red-950/40" : "hover:bg-zinc-900/60"}>
                <td className="sticky left-0 w-12 select-none border-r border-zinc-800 bg-[#0b0d10] px-2 text-right text-zinc-600">
                  {n}
                </td>
                <td className={`whitespace-pre px-3 ${bad ? "text-red-300" : classify(line)}`}>{line || " "}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
