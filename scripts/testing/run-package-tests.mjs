import { spawn } from "node:child_process";
import process from "node:process";

const coverageFlag = "--coverage";
const cliArgs = process.argv.slice(2);
const withCoverage = cliArgs.includes(coverageFlag);
const passthroughArgs = cliArgs.filter((arg) => arg !== coverageFlag);

const registerTsNodeImport =
  'data:text/javascript,import { register } from "node:module"; import { pathToFileURL } from "node:url"; register("ts-node/esm", pathToFileURL("./"));';

const baseNodeArgs = [
  "--disable-warning=ExperimentalWarning",
  "--no-deprecation",
  "--import",
  registerTsNodeImport,
  "test/run-tests.ts",
  ...passthroughArgs,
];

const testCommand = withCoverage
  ? { command: "pnpm", args: ["exec", "c8", "node", ...baseNodeArgs] }
  : { command: process.execPath, args: baseNodeArgs };

function envWithFallback(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }

  return value.trim().length > 0 ? value : fallback;
}

const testEnv = {
  NODE_OPTIONS: "",
  DOTENV_CONFIG_QUIET: "true",
  TS_NODE_TRANSPILE_ONLY: "true",
  NODE_ENV: envWithFallback(process.env.NODE_ENV, "test"),
  LOG_LEVEL: envWithFallback(process.env.LOG_LEVEL, "warn"),
  REDIS_URL: envWithFallback(process.env.REDIS_URL, "redis://127.0.0.1:6379"),
  DATABASE_URL: envWithFallback(
    process.env.DATABASE_URL,
    "postgresql://postgres:postgres@127.0.0.1:5432/high_frequency_tickets",
  ),
  GOOGLE_CLOUD_PROJECT: envWithFallback(
    process.env.GOOGLE_CLOUD_PROJECT,
    "high-frequency-ticket-system-test",
  ),
  PUBSUB_EMULATOR_HOST: envWithFallback(
    process.env.PUBSUB_EMULATOR_HOST,
    "127.0.0.1:8085",
  ),
  PUBSUB_TOPIC_BUY_TICKET: envWithFallback(
    process.env.PUBSUB_TOPIC_BUY_TICKET,
    "buy-ticket",
  ),
  PUBSUB_SUBSCRIPTION_BUY_TICKET: envWithFallback(
    process.env.PUBSUB_SUBSCRIPTION_BUY_TICKET,
    "buy-ticket-subscription",
  ),
};

async function runCommand(command, args, env = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: { ...process.env, ...env },
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }

      reject(
        new Error(
          `Command failed: ${command} ${args.join(" ")} (exit ${code ?? "null"})`,
        ),
      );
    });

    child.on("error", (error) => {
      reject(error);
    });
  });
}

try {
  await runCommand("pnpm", ["run", "build"]);
  await runCommand("pnpm", ["exec", "tsgo", "-p", "test/tsconfig.json"]);
  await runCommand(testCommand.command, testCommand.args, testEnv);
} catch (error) {
  if (error instanceof Error) {
    console.error(`[test runner] ${error.message}`);
  } else {
    console.error("[test runner] unknown error");
  }

  process.exit(1);
}
