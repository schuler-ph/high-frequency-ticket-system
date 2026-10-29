#!/usr/bin/env node
// Doku-Check der progressiven Dokumentationsarchitektur (siehe docs/DOCS.md, ADR-001).
// Ohne Abhaengigkeiten, Node >= 20. Aufruf aus dem Repository-Root:
//   node scripts/check-docs.mjs
//
// 1. Todo-Eintraege und Prosa-Absaetze in docs/TODO.md bleiben unter dem Zeichenbudget.
// 2. Backtick-Repo-Pfade und relative Markdown-Links zeigen auf existierende Ziele.
// 3. Anker in Markdown-Links treffen eine echte Ueberschrift der Zieldatei.
// 4. Haeufig geladene Dokumente und einzelne ADRs bleiben unter ihrem Groessen-Backstop.
// 5. Jede ADR-Datei steht im Index docs/DECISIONS.md und umgekehrt.
// 6. Agent-Dateien sind Symlinks auf die kanonische AGENTS.md.
// 7. Warnung fuer Notizen, die von keinem Dokument verlinkt werden.
// Dazu: keine unersetzten Vorlagen-Platzhalter wie {{PROJEKTNAME}}.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

// --- Konfiguration: die einzigen Stellen, die ein Projekt anpasst -----------

const KIB = 1024;
const CONFIG = {
  todoEntryMaxChars: 300,
  todoParagraphMaxChars: 300,
  adrMaxBytes: 16 * KIB,
  fileBudgets: {
    "AGENTS.md": 8 * KIB,
    "docs/DOCS.md": 12 * KIB,
    "docs/DECISIONS.md": 8 * KIB,
    "docs/TODO.md": 40 * KIB,
    "docs/REQUIREMENTS.md": 24 * KIB,
    "docs/ARCHITECTURE.md": 32 * KIB,
  },
  // Pfad relativ zum Repo-Root -> erwartetes Symlink-Ziel.
  agentSymlinks: {
    "CLAUDE.md": "AGENTS.md",
  },
  // Top-Level-Verzeichnisse, deren Backtick-Pfade (`src/app.ts:12`) geprueft werden.
  backtickPathPrefixes: ["docs", "scripts", "src"],
  // ADRs und Reports duerfen historische, inzwischen entfernte Pfade nennen.
  historicalDirs: ["docs/decisions/", "docs/reports/"],
  // Verzeichnisse, die bei der README-Suche ohne Git uebersprungen werden.
  ignoredDirs: [
    ".git",
    "node_modules",
    "dist",
    "build",
    "coverage",
    "vendor",
    "target",
    ".venv",
  ],
};

// ---------------------------------------------------------------------------

const repoRoot = process.cwd();
const docsDir = join(repoRoot, "docs");
const todoPath = join(docsDir, "TODO.md");
const decisionsIndexPath = join(docsDir, "DECISIONS.md");
const decisionsDir = join(docsDir, "decisions");
const notesDir = join(docsDir, "notes");

const problems = [];
const warnings = [];
const report = (file, line, message) =>
  problems.push(`${file}:${line} ${message}`);
const warn = (file, line, message) =>
  warnings.push(`${file}:${line} ${message}`);
const rel = (absPath) => relative(repoRoot, absPath).split(sep).join("/");

const isFile = (absPath) => {
  try {
    return statSync(absPath).isFile();
  } catch {
    return false;
  }
};

const walk = (dir, accept) => {
  if (!existsSync(dir)) return [];
  const result = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!CONFIG.ignoredDirs.includes(entry.name))
        result.push(...walk(absPath, accept));
    } else if (entry.isFile() && accept(entry.name)) {
      result.push(absPath);
    }
  }
  return result.sort();
};

const listMarkdown = (dir) => walk(dir, (name) => name.endsWith(".md"));

const gitAvailable = (() => {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
})();

// Lokale READMEs: ueber Git (respektiert .gitignore), sonst per Verzeichnis-Walk.
const listReadmes = () => {
  if (!gitAvailable) return walk(repoRoot, (name) => name === "README.md");
  return execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "README.md",
      ":(glob)**/README.md",
    ],
    { encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean)
    .map((file) => join(repoRoot, file))
    .filter(isFile);
};

// Ein Link auf ein gitignoriertes Ziel ist kein veralteter Link, sondern bewusst lokaler Inhalt.
const isGitIgnored = (absPath) => {
  if (!gitAvailable) return false;
  for (const candidate of [absPath, `${absPath}/`]) {
    try {
      execFileSync("git", ["check-ignore", "-q", candidate], {
        stdio: "ignore",
      });
      return true;
    } catch {
      // naechste Form probieren
    }
  }
  return false;
};

// GitHub-kompatibler Ueberschriften-Anker.
const slugify = (heading) =>
  heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");

const slugCache = new Map();
const headingSlugs = (absPath) => {
  if (slugCache.has(absPath)) return slugCache.get(absPath);
  const slugs = new Set();
  const counts = new Map();
  let inFence = false;
  for (const line of readFileSync(absPath, "utf8").split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const match = !inFence && line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
    if (!match) continue;
    const base = slugify(match[1]);
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    slugs.add(seen === 0 ? base : `${base}-${seen}`);
  }
  slugCache.set(absPath, slugs);
  return slugs;
};

// --- 1. Zeichenbudget in TODO.md -------------------------------------------

// Ein Listenpunkt samt eingerueckter Folgezeilen zaehlt als eine Einheit, ein
// Prosa-Absatz ebenso; so greift das Budget auch bei umbrochenen Eintraegen.
const collectTodoUnits = (lines) => {
  const units = [];
  let current = null;
  let inFence = false;
  const flush = () => {
    if (current) units.push(current);
    current = null;
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trimEnd();
    if (/^\s*```/.test(line)) {
      flush();
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    if (
      line.trim() === "" ||
      /^\s*#{1,6}\s/.test(line) ||
      /^\s*\|/.test(line) ||
      /^\s*<!--/.test(line)
    ) {
      flush();
      return;
    }

    const isEntry = /^\s*-\s*\[[ xX]\]/.test(line);
    const isListItem = /^\s*(?:[-*+]|\d+\.)\s/.test(line);
    const isContinuation = /^\s+\S/.test(line) && current !== null;

    if (isEntry || (isListItem && !isContinuation)) {
      flush();
      current = {
        kind: isEntry ? "entry" : "list",
        lineNumber: index + 1,
        text: line.trim(),
      };
    } else if (isContinuation || current?.kind === "prose") {
      current.text += ` ${line.trim()}`;
    } else {
      flush();
      current = { kind: "prose", lineNumber: index + 1, text: line.trim() };
    }
  });
  flush();
  return units;
};

if (isFile(todoPath)) {
  for (const { kind, lineNumber, text } of collectTodoUnits(
    readFileSync(todoPath, "utf8").split("\n"),
  )) {
    if (kind === "entry" && text.length > CONFIG.todoEntryMaxChars) {
      report(
        "docs/TODO.md",
        lineNumber,
        `Todo hat ${text.length} Zeichen (max ${CONFIG.todoEntryMaxChars}). Details nach docs/notes/, ADR oder Report auslagern.`,
      );
    }
    if (kind === "prose" && text.length > CONFIG.todoParagraphMaxChars) {
      report(
        "docs/TODO.md",
        lineNumber,
        `Absatz hat ${text.length} Zeichen (max ${CONFIG.todoParagraphMaxChars}). Laengeren Kontext nach docs/notes/ verschieben.`,
      );
    }
  }
} else {
  report("docs/TODO.md", 1, "Datei fehlt.");
}

// --- 2./3. Pfade, Links und Anker ------------------------------------------

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const backtickPath = new RegExp(
  "`((?:" +
    CONFIG.backtickPathPrefixes.map(escapeRegex).join("|") +
    ")/[A-Za-z0-9._/-]+\\.[A-Za-z0-9]+)(?::\\d+(?:-\\d+)?)?`",
  "g",
);
const markdownLink = /\]\(([^)\s]+)\)/g;
const linkedTargets = new Set();

const scannedFiles = [
  ...new Set([
    ...["AGENTS.md", "README.md"]
      .map((file) => join(repoRoot, file))
      .filter(isFile),
    ...listMarkdown(docsDir),
    ...listReadmes(),
  ]),
];

for (const absFile of scannedFiles) {
  const relFile = rel(absFile);
  const isHistorical = CONFIG.historicalDirs.some((dir) =>
    relFile.startsWith(dir),
  );
  let inFence = false;

  readFileSync(absFile, "utf8")
    .split("\n")
    .forEach((line, index) => {
      const lineNumber = index + 1;
      if (/^\s*```/.test(line)) inFence = !inFence;
      if (/\{\{[A-Z_]+\}\}/.test(line)) {
        report(relFile, lineNumber, "Unersetzter Vorlagen-Platzhalter {{…}}.");
      }
      if (inFence) return;

      for (const [, target] of line.matchAll(backtickPath)) {
        if (isHistorical || /NNN|<|\*/.test(target)) continue;
        if (!isFile(join(repoRoot, target))) {
          report(
            relFile,
            lineNumber,
            `Backtick-Pfad zeigt ins Leere: \`${target}\``,
          );
        }
      }

      // Links in Inline-Code sind Beispiele, keine Verweise.
      const prose = line.replace(/`[^`]*`/g, "");

      for (const [, raw] of prose.matchAll(markdownLink)) {
        if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(raw) || /[*<]/.test(raw))
          continue;
        const [pathPart, anchor] = raw.split("#");
        const targetPath = resolve(
          dirname(absFile),
          decodeURIComponent(pathPart),
        );
        linkedTargets.add(targetPath);

        if (!existsSync(targetPath)) {
          if (isGitIgnored(targetPath)) {
            warn(
              relFile,
              lineNumber,
              `Link zeigt auf gitignoriertes Ziel: ${raw}`,
            );
          } else {
            report(relFile, lineNumber, `Link zeigt ins Leere: ${raw}`);
          }
          continue;
        }
        if (
          anchor &&
          targetPath.endsWith(".md") &&
          !headingSlugs(targetPath).has(anchor)
        ) {
          report(
            relFile,
            lineNumber,
            `Anker existiert nicht in ${rel(targetPath)}: #${anchor}`,
          );
        }
      }

      // Same-file-Anker: [text](#abschnitt)
      for (const [, anchor] of prose.matchAll(/\]\(#([^)\s]+)\)/g)) {
        if (!headingSlugs(absFile).has(anchor)) {
          report(
            relFile,
            lineNumber,
            `Anker existiert nicht in dieser Datei: #${anchor}`,
          );
        }
      }
    });
}

// --- 4. Groessen-Backstops --------------------------------------------------

for (const [relPath, maxBytes] of Object.entries(CONFIG.fileBudgets)) {
  const absPath = join(repoRoot, relPath);
  if (!isFile(absPath)) {
    report(relPath, 1, "Datei fehlt.");
    continue;
  }
  const size = statSync(absPath).size;
  if (size > maxBytes) {
    report(
      relPath,
      1,
      `Datei ist ${(size / KIB).toFixed(1)} KiB (max ${maxBytes / KIB} KiB). Details nach docs/notes/ oder in Einzeldateien auslagern.`,
    );
  }
}

const adrFiles = listMarkdown(decisionsDir);
for (const absPath of adrFiles) {
  const size = statSync(absPath).size;
  if (size > CONFIG.adrMaxBytes) {
    report(
      rel(absPath),
      1,
      `ADR ist ${(size / KIB).toFixed(1)} KiB (max ${CONFIG.adrMaxBytes / KIB} KiB).`,
    );
  }
}

// --- 5. ADR-Index -----------------------------------------------------------

const decisionsIndex = isFile(decisionsIndexPath)
  ? readFileSync(decisionsIndexPath, "utf8")
  : "";
const adrNumbers = new Set();
for (const absPath of adrFiles) {
  const fileName = relative(decisionsDir, absPath).split(sep).join("/");
  const match = fileName.match(/^ADR-(\d{3})-[a-z0-9-]+\.md$/);
  if (!match) {
    report(
      rel(absPath),
      1,
      "ADR-Dateiname muss ADR-NNN-kebab-case-titel.md entsprechen.",
    );
    continue;
  }
  if (adrNumbers.has(match[1]))
    report(rel(absPath), 1, `Doppelte ADR-Nummer: ${match[1]}`);
  adrNumbers.add(match[1]);
  if (!decisionsIndex.includes(`](decisions/${fileName})`)) {
    report("docs/DECISIONS.md", 1, `ADR fehlt im Index: decisions/${fileName}`);
  }
}
for (const [, fileName] of decisionsIndex.matchAll(
  /\]\(decisions\/(ADR-[^)#]+\.md)/g,
)) {
  if (!isFile(join(decisionsDir, fileName))) {
    report(
      "docs/DECISIONS.md",
      1,
      `Index verweist auf fehlende ADR: decisions/${fileName}`,
    );
  }
}

// --- 6. Kanonische Agent-Anweisung ------------------------------------------

if (!isFile(join(repoRoot, "AGENTS.md")))
  report("AGENTS.md", 1, "Kanonische Agent-Anweisung fehlt.");
for (const [relPath, expectedTarget] of Object.entries(CONFIG.agentSymlinks)) {
  const absPath = join(repoRoot, relPath);
  let stats;
  try {
    stats = lstatSync(absPath);
  } catch {
    report(relPath, 1, "Erforderlicher Agent-Symlink fehlt.");
    continue;
  }
  if (!stats.isSymbolicLink()) {
    report(
      relPath,
      1,
      `Muss ein Symlink auf ${expectedTarget} sein, damit alle Agenten dieselbe Anweisung lesen.`,
    );
  } else if (readlinkSync(absPath) !== expectedTarget) {
    report(
      relPath,
      1,
      `Symlink zeigt auf ${readlinkSync(absPath)}, erwartet ist ${expectedTarget}.`,
    );
  }
}

// --- 7. Verwaiste Notizen ---------------------------------------------------

for (const absPath of listMarkdown(notesDir)) {
  if (absPath.endsWith(`${sep}README.md`)) continue;
  if (!linkedTargets.has(absPath)) {
    warn(
      rel(absPath),
      1,
      "Notiz wird von keinem Dokument verlinkt (Todo-Phase oder ADR verlinken, sonst entfernen).",
    );
  }
}

// --- Ergebnis ---------------------------------------------------------------

for (const warning of warnings) console.warn(`[check-docs] WARN ${warning}`);

if (problems.length > 0) {
  for (const problem of problems) console.error(`[check-docs] ${problem}`);
  console.error(`[check-docs] ${problems.length} Doku-Problem(e) gefunden.`);
  process.exit(1);
}

console.log(
  `[check-docs] ${scannedFiles.length} Dateien, ${adrFiles.length} ADRs: Links, Budgets, Index und Symlinks gueltig.`,
);
