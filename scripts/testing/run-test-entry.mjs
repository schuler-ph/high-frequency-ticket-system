import { pathToFileURL } from "node:url";

const entryArg = process.argv[2];

if (typeof entryArg !== "string" || entryArg.length === 0) {
  console.error("[test entry runner] missing test entry argument");
  process.exit(1);
}

const entryUrl = pathToFileURL(`${process.cwd()}/${entryArg}`);

process.on("beforeExit", () => undefined);

await import(entryUrl.href);
