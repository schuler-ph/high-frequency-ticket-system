import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

// Haelt docs/TODO.md als Index lesbar (siehe ADR-029) und prueft Doku-Querverweise.
//
// 1. Todo-Zeilen und Prosa-Absaetze in TODO.md bleiben unter dem Zeichenbudget.
// 2. Backtick-Repo-Pfade und relative Markdown-Links in docs/ zeigen auf existierende Dateien.
// 3. Anker in Markdown-Links treffen eine echte Ueberschrift der Zieldatei.
// 4. TODO.md bleibt unter dem Groessen-Backstop.

const repoRoot = process.cwd();
const docsDir = join(repoRoot, "docs");
const todoPath = join(docsDir, "TODO.md");

const TODO_ENTRY_MAX_CHARS = 300;
const TODO_PARAGRAPH_MAX_CHARS = 300;
const TODO_MAX_BYTES = 40 * 1024;

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
      execFileSync("git", ["check-ignore", "-q", candidate], { stdio: "ignore" });
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

    if (line.trim() === "" || /^\s*#{1,6}\s/.test(line) || /^\s*\|/.test(line)) {
      flush();
      return;
    }

    const isEntry = /^\s*-\s*\[[ xX]\]/.test(line);
    const isOtherListItem = /^\s*(?:[-*+]|\d+\.)\s/.test(line);
    const isContinuation = /^\s+\S/.test(line) && current !== null;

    if (isEntry || (isOtherListItem && !isContinuation)) {
      flush();
      current = { kind: isEntry ? "entry" : "list", lineNumber, text: line.trim() };
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
        `Details nach DECISIONS.md / reports/ / notes/ auslagern oder wortgleich nach TODO-ARCHIVE.md.`,
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

// --- 2./3. Pfade und Anker in docs/ ----------------------------------------

for (const absFile of listMarkdownFiles(docsDir)) {
  const relFile = relative(repoRoot, absFile);
  const lines = readFileSync(absFile, "utf8").split("\n");

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    for (const match of line.matchAll(BACKTICK_PATH)) {
      const target = match[1];
      if (HISTORICAL_PATHS.has(target)) continue;
      if (!existsAsFile(join(repoRoot, target))) {
        report(relFile, lineNumber, `Backtick-Pfad zeigt ins Leere: \`${target}\``);
      }
    }

    for (const match of line.matchAll(MARKDOWN_LINK)) {
      const raw = match[1];
      if (/^(?:https?:|mailto:|#)/.test(raw) || raw.includes("*") || raw.includes("<")) {
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
          warn(relFile, lineNumber, `${message} (Ziel ist gitignoriert, nur lokal vorhanden)`);
        } else {
          report(relFile, lineNumber, message);
        }
        continue;
      }

      if (anchor && targetPath.endsWith(".md") && !headingSlugs(targetPath).has(anchor)) {
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

// --- 4. Groessen-Backstop ---------------------------------------------------

const todoBytes = statSync(todoPath).size;
if (todoBytes > TODO_MAX_BYTES) {
  report(
    "docs/TODO.md",
    1,
    `Datei ist ${(todoBytes / 1024).toFixed(1)} KB (max ${TODO_MAX_BYTES / 1024} KB). ` +
      `TODO.md ist ein Index, kein Protokoll.`,
  );
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
  `[debug:docs] TODO.md (${(todoBytes / 1024).toFixed(1)} KB) im Budget, Doku-Verweise aufloesbar.`,
);
