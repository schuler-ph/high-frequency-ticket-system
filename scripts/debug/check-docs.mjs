import { execFileSync } from "node:child_process";
import {
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

// Haelt docs/TODO.md als Index lesbar (siehe ADR-029) und prueft Doku-Querverweise.
//
// 1. Todo-Zeilen und Prosa-Absaetze in TODO.md bleiben unter dem Zeichenbudget.
// 2. Backtick-Repo-Pfade und relative Markdown-Links in Root-Doku, docs/ und
//    lokalen READMEs zeigen auf existierende Dateien.
// 3. Anker in Markdown-Links treffen eine echte Ueberschrift der Zieldatei.
// 4. TODO.md bleibt unter dem Groessen-Backstop.

const repoRoot = process.cwd();
const docsDir = join(repoRoot, "docs");
const todoPath = join(docsDir, "TODO.md");
const decisionsIndexPath = join(docsDir, "DECISIONS.md");
const decisionsDir = join(docsDir, "decisions");
const rootDocumentationFiles = ["AGENTS.md", "README.md"].map((file) =>
  join(repoRoot, file),
);

const TODO_ENTRY_MAX_CHARS = 300;
const TODO_PARAGRAPH_MAX_CHARS = 300;
const TODO_MAX_BYTES = 40 * 1024;
const ADR_MAX_BYTES = 16 * 1024;

const FILE_SIZE_BUDGETS = new Map([
  ["AGENTS.md", 8 * 1024],
  ["docs/DOCS.md", 12 * 1024],
  ["docs/REQUIREMENTS.md", 16 * 1024],
  ["docs/ARCHITECTURE.md", 24 * 1024],
  ["docs/DECISIONS.md", 8 * 1024],
  ["docs/TODO.md", TODO_MAX_BYTES],
]);

const REQUIRED_AGENT_SYMLINKS = new Map([
  ["CLAUDE.md", "AGENTS.md"],
  [".github/copilot-instructions.md", "../AGENTS.md"],
]);

// Backtick-Pfade wie `docs/TODO.md` oder `apps/worker/src/app.ts:83`.
const BACKTICK_PATH = new RegExp(
  "`((?:apps|docs|load-tests|packages|scripts|terraform)/[A-Za-z0-9._/-]+" +
    "\\.(?:md|mjs|js|ts|tsx|json|sql|yml|yaml))(?::\\d+(?:-\\d+)?)?`",
  "g",
);
// Markdown-Links: [text](ziel) — inline-Code und Bilder eingeschlossen.
const MARKDOWN_LINK = /\]\(([^)\s]+)\)/g;

// ADRs beschreiben bewusst auch Dateien, die es nicht mehr gibt ("der bisherige X").
// Solche historischen Erwaehnungen sind kein toter Verweis und werden hier freigestellt.
const HISTORICAL_PATHS = new Set([
  "load-tests/spike.js", // ADR-025: aufgeteilt in spike-phase-a.js / spike-phase-b.js
  "docs/DEBUGGING.md", // ADR-007/020: 2026-07-30 in docs/RUNBOOK.md konsolidiert
  "docs/TODO-ARCHIVE.md", // ADR-029: 2026-07-30 in thematische Notizen geteilt
]);

const problems = [];
const warnings = [];
const report = (file, line, message) => {
  problems.push(`${file}:${line} ${message}`);
};
const warn = (file, line, message) => {
  warnings.push(`${file}:${line} ${message}`);
};

// Ein Verweis auf einen gitignorierten Pfad (z. B. lokale Lauf-Artefakte) ist kein
// veralteter Link, sondern Inhalt, der bewusst ausserhalb von git lebt. Das wird
// gemeldet, blockt aber nicht — sonst haengt jeder Check an einer fremden Entscheidung.
const isGitIgnored = (absPath) => {
  // Beide Formen pruefen: ein Verzeichnis-Pattern wie `artifacts/` trifft einen
  // nicht existierenden Pfad nur mit angehaengtem Slash.
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

const listMarkdownFiles = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();

const listTrackedReadmes = () =>
  execFileSync(
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
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((file) => join(repoRoot, file))
    .filter(existsAsFile);

// GitHub-kompatibler Ueberschriften-Anker: klein, Satzzeichen weg, Leerzeichen zu Bindestrich.
const slugify = (heading) =>
  heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");

const headingSlugCache = new Map();
const headingSlugs = (absPath) => {
  const cached = headingSlugCache.get(absPath);
  if (cached) return cached;

  const slugs = new Set();
  const counts = new Map();
  for (const line of readFileSync(absPath, "utf8").split("\n")) {
    const match = line.match(/^#{1,6}\s+(.*)$/);
    if (!match) continue;
    const base = slugify(match[1]);
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    slugs.add(seen === 0 ? base : `${base}-${seen}`);
  }

  headingSlugCache.set(absPath, slugs);
  return slugs;
};

/**
 * Zerlegt TODO.md in logische Einheiten: ein Listenpunkt samt eingerueckter
 * Folgezeilen zaehlt als eine Einheit, ein Prosa-Absatz ebenso. Dadurch greift
 * das Budget auch dann, wenn ein Eintrag ueber mehrere Zeilen umbrochen wird.
 */
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
    const lineNumber = index + 1;

    if (/^\s*```/.test(line)) {
      flush();
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    if (
      line.trim() === "" ||
      /^\s*#{1,6}\s/.test(line) ||
      /^\s*\|/.test(line)
    ) {
      flush();
      return;
    }

    const isEntry = /^\s*-\s*\[[ xX]\]/.test(line);
    const isOtherListItem = /^\s*(?:[-*+]|\d+\.)\s/.test(line);
    const isContinuation = /^\s+\S/.test(line) && current !== null;

    if (isEntry || (isOtherListItem && !isContinuation)) {
      flush();
      current = {
        kind: isEntry ? "entry" : "list",
        lineNumber,
        text: line.trim(),
      };
      return;
    }

    if (isContinuation) {
      current.text += ` ${line.trim()}`;
      return;
    }

    if (current && current.kind === "prose") {
      current.text += ` ${line.trim()}`;
      return;
    }

    flush();
    current = { kind: "prose", lineNumber, text: line.trim() };
  });

  flush();
  return units;
};

// --- 1. Zeichenbudget in TODO.md -------------------------------------------

const todoLines = readFileSync(todoPath, "utf8").split("\n");

for (const unit of collectTodoUnits(todoLines)) {
  const { kind, lineNumber, text } = unit;
  if (kind === "entry" && text.length > TODO_ENTRY_MAX_CHARS) {
    report(
      "docs/TODO.md",
      lineNumber,
      `Todo hat ${text.length} Zeichen (max ${TODO_ENTRY_MAX_CHARS}). ` +
        `Details nach DECISIONS.md / reports/ / notes/ auslagern.`,
    );
  }
  if (kind === "prose" && text.length > TODO_PARAGRAPH_MAX_CHARS) {
    report(
      "docs/TODO.md",
      lineNumber,
      `Absatz hat ${text.length} Zeichen (max ${TODO_PARAGRAPH_MAX_CHARS}). ` +
        `Laengeren Kontext nach docs/notes/ verschieben.`,
    );
  }
}

// --- 2./3. Pfade und Anker in Root-Doku und docs/ --------------------------

for (const absFile of [
  ...rootDocumentationFiles,
  ...listMarkdownFiles(docsDir),
  ...listTrackedReadmes().filter(
    (file) =>
      !rootDocumentationFiles.includes(file) && !file.startsWith(`${docsDir}/`),
  ),
]) {
  const relFile = relative(repoRoot, absFile);
  const lines = readFileSync(absFile, "utf8").split("\n");

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    for (const match of line.matchAll(BACKTICK_PATH)) {
      const target = match[1];
      if (
        relFile.startsWith("docs/decisions/") &&
        HISTORICAL_PATHS.has(target)
      ) {
        continue;
      }
      if (!existsAsFile(join(repoRoot, target))) {
        report(
          relFile,
          lineNumber,
          `Backtick-Pfad zeigt ins Leere: \`${target}\``,
        );
      }
    }

    for (const match of line.matchAll(MARKDOWN_LINK)) {
      const raw = match[1];
      if (
        /^(?:https?:|mailto:|#)/.test(raw) ||
        raw.includes("*") ||
        raw.includes("<")
      ) {
        continue;
      }

      const [pathPart, anchor] = raw.split("#");
      const targetPath = pathPart
        ? resolve(dirname(absFile), decodeURIComponent(pathPart))
        : absFile;

      // Verzeichnis-Links (z. B. ./artifacts/) sind legitim, tragen aber keinen Anker.
      if (!existsAsPath(targetPath)) {
        const message = `Link zeigt ins Leere: ${raw}`;
        if (isGitIgnored(targetPath)) {
          warn(
            relFile,
            lineNumber,
            `${message} (Ziel ist gitignoriert, nur lokal vorhanden)`,
          );
        } else {
          report(relFile, lineNumber, message);
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
          `Anker existiert nicht in ${relative(repoRoot, targetPath)}: #${anchor}`,
        );
      }
    }
  });
}

function existsAsFile(absPath) {
  try {
    return statSync(absPath).isFile();
  } catch {
    return false;
  }
}

function existsAsPath(absPath) {
  try {
    statSync(absPath);
    return true;
  } catch {
    return false;
  }
}

// --- 4. Groessen-Backstops --------------------------------------------------

const todoBytes = statSync(todoPath).size;
for (const [relPath, maxBytes] of FILE_SIZE_BUDGETS) {
  const actualBytes = statSync(join(repoRoot, relPath)).size;
  if (actualBytes > maxBytes) {
    report(
      relPath,
      1,
      `Datei ist ${(actualBytes / 1024).toFixed(1)} KiB ` +
        `(max ${maxBytes / 1024} KiB laut scripts/debug/check-docs.mjs).`,
    );
  }
}

for (const absPath of listMarkdownFiles(decisionsDir)) {
  const actualBytes = statSync(absPath).size;
  if (actualBytes > ADR_MAX_BYTES) {
    report(
      relative(repoRoot, absPath),
      1,
      `ADR ist ${(actualBytes / 1024).toFixed(1)} KiB (max ${ADR_MAX_BYTES / 1024} KiB).`,
    );
  }
}

// --- 5. ADR-Index -----------------------------------------------------------

const decisionsIndex = readFileSync(decisionsIndexPath, "utf8");
const adrFiles = listMarkdownFiles(decisionsDir);
const adrIds = new Set();

for (const absPath of adrFiles) {
  const fileName = relative(decisionsDir, absPath);
  const match = fileName.match(/^ADR-(\d{3})-[a-z0-9-]+\.md$/);
  if (!match) {
    report(
      relative(repoRoot, absPath),
      1,
      "ADR-Dateiname muss ADR-NNN-kebab-case-titel.md entsprechen.",
    );
    continue;
  }

  if (adrIds.has(match[1])) {
    report(relative(repoRoot, absPath), 1, `Doppelte ADR-Nummer: ${match[1]}`);
  }
  adrIds.add(match[1]);

  const expectedLink = `decisions/${fileName}`;
  if (!decisionsIndex.includes(`](${expectedLink})`)) {
    report("docs/DECISIONS.md", 1, `ADR fehlt im Index: ${expectedLink}`);
  }
}

for (const match of decisionsIndex.matchAll(
  /\]\(decisions\/(ADR-[^)]+\.md)\)/g,
)) {
  if (!existsAsFile(join(decisionsDir, match[1]))) {
    report(
      "docs/DECISIONS.md",
      1,
      `Index verweist auf fehlende ADR: decisions/${match[1]}`,
    );
  }
}

// --- 6. Kanonische Agent-Anweisungen ---------------------------------------

for (const [relPath, expectedTarget] of REQUIRED_AGENT_SYMLINKS) {
  const absPath = join(repoRoot, relPath);
  try {
    if (!lstatSync(absPath).isSymbolicLink()) {
      report(relPath, 1, "Muss ein Symlink auf die kanonische AGENTS.md sein.");
      continue;
    }
    const actualTarget = readlinkSync(absPath);
    if (actualTarget !== expectedTarget) {
      report(
        relPath,
        1,
        `Symlink zeigt auf ${actualTarget}, erwartet ist ${expectedTarget}.`,
      );
    }
  } catch {
    report(relPath, 1, "Erforderlicher Agent-Symlink fehlt.");
  }
}

// --- Ergebnis ---------------------------------------------------------------

for (const warning of warnings) {
  console.warn(`[debug:docs] WARN ${warning}`);
}

if (problems.length > 0) {
  for (const problem of problems) {
    console.error(`[debug:docs] ${problem}`);
  }
  console.error(`[debug:docs] ${problems.length} Doku-Problem(e) gefunden.`);
  process.exit(1);
}

console.log(
  `[debug:docs] TODO.md (${(todoBytes / 1024).toFixed(1)} KiB), ` +
    `${adrFiles.length} ADRs, Budgets/Links/Symlinks gueltig.`,
);
