import { execSync } from "node:child_process";

const requiredContainers = ["hts-postgres", "hts-redis", "hts-pubsub"];

const isCi = process.env.CI === "1" || process.env.CI === "true";
if (isCi) {
  console.log(
    "[preflight:test] CI environment detected. Skipping local container preflight.",
  );
  process.exit(0);
}

try {
  const output = execSync(
    `docker inspect -f '{{.State.Running}}' ${requiredContainers.join(" ")}`,
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  )
    .trim()
    .split("\n")
    .map((line) => line.trim().toLowerCase());

  const notRunning = requiredContainers.filter(
    (_, index) => output[index] !== "true",
  );

  if (notRunning.length > 0) {
    console.error(
      `[preflight:test] Required containers are not running: ${notRunning.join(", ")}.`,
    );
    console.error("[preflight:test] Start them with: docker compose up -d");
    process.exit(1);
  }

  console.log("[preflight:test] All required local containers are running.");
} catch (error) {
  console.error(
    "[preflight:test] Could not verify container state (docker inspect failed).",
  );
  if (error instanceof Error && error.message.length > 0) {
    console.error(`[preflight:test] Details: ${error.message}`);
  }
  console.error(
    "[preflight:test] Ensure Docker is running and execute: docker compose up -d",
  );
  process.exit(1);
}
