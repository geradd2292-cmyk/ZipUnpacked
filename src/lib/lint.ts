export type LintIssue = {
  line: number;
  text: string;
  kind: "semicolon" | "stub";
};

export type LintReport = {
  lines: number;
  bytes: number;
  issues: LintIssue[];
  clean: boolean;
};

const STUB_PATTERNS = [
  /rest of the code/i,
  /\.\.\.\s*existing code/i,
  /TODO:?\s*implement/i,
  /\/\/\s*omitted/i,
  /throw new Error\(['"]not implemented/i,
];

/**
 * Strip string literals and comments from a single source line so a `;`
 * inside a regex, a string or a comment is not reported as a style violation.
 */
function stripNoise(line: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (quote) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "/" && next === "/") break;
    if (ch === "/" && next === "*") {
      const end = line.indexOf("*/", i + 2);
      if (end < 0) break;
      i = end + 1;
      continue;
    }
    out += ch;
  }
  return out;
}

export function lintSource(src: string): LintReport {
  const lines = src.split(/\r?\n/);
  const issues: LintIssue[] = [];
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (inBlock) {
      if (trimmed.includes("*/")) inBlock = false;
      continue;
    }
    if (trimmed.startsWith("/*") && !trimmed.includes("*/")) {
      inBlock = true;
      continue;
    }
    if (trimmed.startsWith("*") || trimmed.startsWith("//")) continue;
    for (const p of STUB_PATTERNS) {
      if (p.test(trimmed)) issues.push({ line: i + 1, text: trimmed, kind: "stub" });
    }
    const code = stripNoise(raw).trimEnd();
    if (code.endsWith(";")) {
      // `for (;;)` headers legitimately contain semicolons but never END with one.
      issues.push({ line: i + 1, text: trimmed, kind: "semicolon" });
    }
  }
  return {
    lines: lines.length,
    bytes: new TextEncoder().encode(src).length,
    issues,
    clean: issues.length === 0,
  };
}

/** Normalise any line ending mix to CRLF — the project's mandated format. */
export function toCRLF(src: string): string {
  return src.replace(/\r\n|\r|\n/g, "\r\n");
}

export function countCRLF(src: string): { crlf: number; lf: number } {
  const crlf = (src.match(/\r\n/g) || []).length;
  const total = (src.match(/\n/g) || []).length;
  return { crlf, lf: total - crlf };
}
