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

// Historische Dateien ohne Journal-Eintrag: nie via db:migrate gelaufen und
// durch spaetere Migrationen vollstaendig ersetzt. Neue Dateien gehoeren ins
// Journal, sonst wendet die CI sie nie an.
const supersededWithoutJournalEntry = new Set([
  "0003_persist_order_id_in_orders.sql",
]);

const journaledFiles = new Set(tags.map((tag) => `${tag}.sql`));
for (const file of sqlFiles) {
  if (!journaledFiles.has(file) && !supersededWithoutJournalEntry.has(file)) {
    fail(
      `SQL file ${file} has no journal entry — db:migrate will never apply it.`,
    );
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
