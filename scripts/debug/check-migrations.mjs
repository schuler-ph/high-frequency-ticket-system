import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const drizzleDir = join(process.cwd(), "packages/db/drizzle");
const journalPath = join(drizzleDir, "meta/_journal.json");

const fail = (message) => {
  console.error(`[debug:migrations] ${message}`);
  process.exit(1);
};

const rawJournal = readFileSync(journalPath, "utf8");
const journal = JSON.parse(rawJournal);
const entries = Array.isArray(journal.entries) ? journal.entries : [];

if (entries.length === 0) {
  fail("No migration entries found in drizzle meta journal.");
}

for (let i = 0; i < entries.length; i += 1) {
  if (entries[i]?.idx !== i) {
    fail(
      `Journal idx mismatch at position ${i}. Found idx=${entries[i]?.idx}.`,
    );
  }
}

const tags = entries.map((entry) => entry.tag);
const uniqueTags = new Set(tags);
if (uniqueTags.size !== tags.length) {
  fail("Duplicate migration tags found in journal.");
}

const sqlFiles = readdirSync(drizzleDir).filter((name) =>
  name.endsWith(".sql"),
);

for (const tag of tags) {
  const expectedFile = `${tag}.sql`;
  if (!sqlFiles.includes(expectedFile)) {
    fail(`Journal entry ${tag} has no matching SQL file (${expectedFile}).`);
  }
}

const prefixes = sqlFiles
  .map((name) => {
    const match = name.match(/^(\d{4})_/);
    return match ? match[1] : null;
  })
  .filter((value) => value !== null);

const uniquePrefixes = new Set(prefixes);
if (uniquePrefixes.size !== prefixes.length) {
  fail("Duplicate migration number prefixes detected in SQL files.");
}

console.log(
  "[debug:migrations] Journal integrity and migration file consistency look good.",
);
