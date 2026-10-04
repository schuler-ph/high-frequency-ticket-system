/**
 * Cluster preflight for a run against Kubernetes (ADR-047).
 *
 * The services under test are Deployments now, not host processes. "Running"
 * therefore means two things that can disagree: Kubernetes reports every
 * desired pod as ready, AND Prometheus scrapes every one of them. A pod that
 * is ready but not scraped would serve load whose counters never reach the
 * report — exactly the silent undercount the Prometheus snapshots exist to
 * prevent.
 *
 * The pods must also run the run's profile. `HFTS_ENV` decides service knobs
 * the generator never sees — the checkout deadline, the reaper cadence, the
 * pool size — so a pod on `dev` under a `browse-and-buy-human-pace` load would
 * measure a different system than the report claims.
 */

import { execFileSync } from "node:child_process";

/** The Deployments whose pods the report counts, named like their scrape job. */
export const MEASURED_DEPLOYMENTS = ["api", "worker"];

const kubectlJson = (context, args, exec) =>
  JSON.parse(
    exec("kubectl", ["--context", context, ...args, "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );

/**
 * `HFTS_ENV` as the pod template sets it: an explicit `env` entry (what
 * `pnpm k8s:profile` writes) wins over the ConfigMap behind `envFrom`, exactly
 * as Kubernetes resolves it inside the container.
 */
const profileOf = (deployment, context, exec) => {
  const container = deployment.spec?.template?.spec?.containers?.[0] ?? {};
  const explicit = (container.env ?? []).find((e) => e.name === "HFTS_ENV");
  if (explicit) return explicit.value ?? null;
  for (const source of container.envFrom ?? []) {
    const configMap = source.configMapRef?.name;
    if (!configMap) continue;
    const data = kubectlJson(context, ["get", "configmap", configMap], exec).data ?? {};
    if (data.HFTS_ENV) return data.HFTS_ENV;
  }
  return null;
};

/**
 * @param {string} context kubectl context, e.g. `kind-hfts`
 * @param {string[]} names
 * @param {typeof execFileSync} [exec]
 * @returns {Array<{ name: string, desired: number, ready: number, updated: number, profile: string | null }>}
 */
export const readDeployments = (context, names, exec = execFileSync) => {
  const parsed = kubectlJson(context, ["get", "deployment", ...names], exec);
  const items = parsed.kind === "List" ? parsed.items : [parsed];
  return items.map((deployment) => ({
    name: deployment.metadata.name,
    desired: deployment.spec?.replicas ?? 0,
    ready: deployment.status?.readyReplicas ?? 0,
    updated: deployment.status?.updatedReplicas ?? 0,
    profile: profileOf(deployment, context, exec),
  }));
};

/**
 * Pure verdict over what Kubernetes and Prometheus report.
 *
 * @param {{ deployments: Array<{ name: string, desired: number, ready: number, updated: number, profile: string | null }>, targetsUp: Record<string, number>, expectedProfile: string }} facts
 * @returns {string[]} problems; empty when the cluster is fit to be measured
 */
export const assessCluster = ({ deployments, targetsUp, expectedProfile }) => {
  const problems = [];
  for (const { name, desired, ready, updated, profile } of deployments) {
    if (desired === 0) {
      problems.push(`${name}: scaled to 0 replicas — nothing to measure.`);
      continue;
    }
    if (profile !== expectedProfile) {
      problems.push(
        `${name}: pods run profile "${profile}", the run uses "${expectedProfile}" — \`HFTS_ENV=${expectedProfile} pnpm k8s:profile\`.`,
      );
    }
    if (ready !== desired || updated !== desired) {
      problems.push(
        `${name}: ${ready}/${desired} pods ready, ${updated}/${desired} on the current template — \`kubectl get pods -l app=${name}\`.`,
      );
    }
    const scraped = targetsUp[name] ?? 0;
    if (scraped !== desired) {
      problems.push(
        `${name}: Prometheus scrapes ${scraped} of ${desired} pods — check localhost:10007/targets.`,
      );
    }
  }
  return problems;
};
