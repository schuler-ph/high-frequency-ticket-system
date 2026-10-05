/**
 * Haengt die Compose-Datastores zusaetzlich ins Docker-Netz `kind`, damit die
 * Pods sie direkt unter ihrem Containernamen erreichen.
 *
 * Der Umweg ueber `host.docker.internal` fuehrte jedes Paket aus der VM durch
 * den Userspace-Netzstack von Docker Desktop auf den Mac und ueber die
 * Port-Weiterleitung zurueck: Redis-Roundtrip 0,95 ms statt 0,30 ms, und unter
 * Last frass der Weiterleiter die Mac-Kerne, die dem Cluster fehlten.
 *
 * Bewusst ein Schritt nach `docker compose up` und `kind create` statt einer
 * externen Netzdeklaration in Compose: sonst liesse sich der Compose-Stack ohne
 * Cluster nicht mehr starten (`pnpm test` braucht ihn ohne kind). Idempotent;
 * nach einem Neuerzeugen der Container (`docker compose up` mit Aenderungen,
 * `docker compose down`) erneut ausfuehren.
 */

import { execFileSync } from "node:child_process";

const KIND_NETWORK = "kind";
const DATASTORES = [
  "hfts-postgres",
  "hfts-redis",
  "hfts-pubsub",
  "hfts-redis-exporter",
];

const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const attachedContainers = () =>
  new Set(
    docker(
      "network",
      "inspect",
      KIND_NETWORK,
      "--format",
      "{{range .Containers}}{{.Name}} {{end}}",
    )
      .split(" ")
      .filter(Boolean),
  );

const attached = attachedContainers();

for (const container of DATASTORES) {
  if (attached.has(container)) {
    console.log(
      `[kind:network] ${container} ist schon im Netz ${KIND_NETWORK}`,
    );
    continue;
  }
  docker("network", "connect", KIND_NETWORK, container);
  console.log(`[kind:network] ${container} -> Netz ${KIND_NETWORK}`);
}
