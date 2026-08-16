/**
 * Grafana panel export — turn every provisioned dashboard into PNG files.
 *
 * Motivation: reading a run used to mean taking screenshots by hand. Grafana
 * can render a panel server-side (`/render/d-solo/...`, backed by the
 * `grafana-image-renderer` container), so the same evidence can be collected
 * deterministically for an exact time window — see ADR-030.
 *
 * Two layers, deliberately separated so the URL/parse logic is unit-testable
 * without a running Grafana:
 *   - pure: `slugify`, `collectPanels`, `parseTimeInput`, `buildRenderUrl`,
 *     `renderIndexMarkdown`
 *   - side-effecting: `resolvePrometheusUid`, `listDashboards`,
 *     `fetchDashboard`, `exportDashboards`
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { requireEnv } from "../../lib/require-env.mjs";

/** Panel types that carry no time-series graph and are not worth a PNG. */
const NON_GRAPH_PANEL_TYPES = new Set(["row", "text", "dashlist", "news"]);

/**
 * @param {string} value
 * @returns {string} lowercase, dash-separated, filesystem-safe
 */
export const slugify = (value) =>
  // Umlaute zuerst ausschreiben, dann Restdiakritika strippen: NFKD trennt das
  // Trema von "Ü" ab und machte aus "ueberzeichnung" sonst "uberzeichnung".
  String(value)
    .replace(/ä/gi, "ae")
    .replace(/ö/gi, "oe")
    .replace(/ü/gi, "ue")
    .replace(/ß/gi, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "panel";

/**
 * Flatten a dashboard's panels, including panels nested in collapsed rows, and
 * drop everything that is not a graph (text/row panels render as empty boxes).
 *
 * @param {{ panels?: Array<object> }} dashboard
 * @returns {Array<{ id: number, title: string, type: string }>}
 */
export const collectPanels = (dashboard) => {
  const out = [];
  const walk = (panels) => {
    for (const panel of panels ?? []) {
      if (Array.isArray(panel.panels)) walk(panel.panels);
      if (NON_GRAPH_PANEL_TYPES.has(panel.type)) continue;
      if (typeof panel.id !== "number") continue;
      out.push({
        id: panel.id,
        title: panel.title ?? `Panel ${panel.id}`,
        type: panel.type ?? "unknown",
      });
    }
  };
  walk(dashboard.panels);
  return out;
};

/**
 * Offset (ms) of `timeZone` at the given UTC instant. Uses `Intl` rather than a
 * hard-coded +01:00/+02:00 so a run that straddles a DST switch stays correct.
 *
 * @param {number} utcMs
 * @param {string} timeZone
 * @returns {number}
 */
const timeZoneOffsetMs = (utcMs, timeZone) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  const hour = get("hour") === 24 ? 0 : get("hour");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second"),
  );
  return asUtc - utcMs;
};

/**
 * Normalize one side of a time range into what a Grafana URL accepts.
 *
 * Accepted inputs:
 *   - `now`, `now-15m`, … → passed through (Grafana resolves it)
 *   - epoch milliseconds (number or numeric string) → passed through
 *   - ISO 8601 with zone (`2026-07-27T16:19:00Z`, `…+02:00`) → epoch ms
 *   - wall clock without zone (`2026-07-27 16:19:00`, Grafana's own picker
 *     format) → interpreted in `timeZone`, then epoch ms
 *
 * The wall-clock case is the important one: it is what the Grafana time picker
 * puts in the URL/JSON, and reading it as UTC would silently shift every image
 * by the local offset.
 *
 * @param {string | number} input
 * @param {string} timeZone
 * @returns {string}
 */
export const parseTimeInput = (input, timeZone) => {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new Error(`Invalid time: ${input}`);
    return String(Math.round(input));
  }
  const value = String(input).trim();
  if (value === "") throw new Error("Empty time value");
  if (/^now(-|\+|$)/.test(value)) return value;
  if (/^-?\d+$/.test(value)) return value;

  const hasZone = /(z|[+-]\d{2}:?\d{2})$/i.test(value);
  const iso = value.replace(" ", "T");
  if (hasZone) {
    const epoch = Date.parse(iso);
    if (Number.isNaN(epoch)) throw new Error(`Invalid time: ${value}`);
    return String(epoch);
  }

  const naive = Date.parse(`${iso}${/T\d{2}:\d{2}/.test(iso) ? "" : "T00:00"}Z`);
  if (Number.isNaN(naive)) throw new Error(`Invalid time: ${value}`);
  // Two passes: the first offset lookup uses the naive instant, the second the
  // corrected one — that is what makes times near a DST switch resolve.
  const firstGuess = naive - timeZoneOffsetMs(naive, timeZone);
  return String(naive - timeZoneOffsetMs(firstGuess, timeZone));
};

/**
 * Accept the JSON blob the Grafana time picker produces
 * (`{"from":"2026-07-27 16:19:00","to":"…"}`) as a single argument.
 *
 * @param {string} raw
 * @returns {{ from: string, to: string }}
 */
export const parseRangeJson = (raw) => {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || !parsed.from || !parsed.to) {
    throw new Error(`--range needs {"from":…,"to":…}, got: ${raw}`);
  }
  return { from: String(parsed.from), to: String(parsed.to) };
};

/**
 * @param {{
 *   baseUrl: string, uid: string, slug: string, panelId: number,
 *   from: string, to: string, width: number, height: number, scale: number,
 *   timeZone: string, theme: string, datasourceUid?: string | null,
 * }} opts
 * @returns {string}
 */
export const buildRenderUrl = ({
  baseUrl,
  uid,
  slug,
  panelId,
  from,
  to,
  width,
  height,
  scale,
  timeZone,
  theme,
  datasourceUid = null,
}) => {
  const params = new URLSearchParams({
    panelId: String(panelId),
    from,
    to,
    width: String(width),
    height: String(height),
    scale: String(scale),
    tz: timeZone,
    theme,
  });
  // The dashboards select their datasource through a `datasource` template
  // variable whose uid is generated at provisioning time; without this the
  // render falls back to "no data".
  if (datasourceUid) params.set("var-datasource", datasourceUid);
  return `${baseUrl.replace(/\/$/, "")}/render/d-solo/${uid}/${slug}?${params}`;
};

/** Basic-auth header for the local Grafana (admin/admin by default). */
const authHeader = (user, password) => ({
  Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`,
});

const jsonGet = async (url, headers, timeoutMs) => {
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
};

/**
 * @returns {Promise<string | null>} uid of the default Prometheus datasource
 */
export const resolvePrometheusUid = async ({
  baseUrl,
  user,
  password,
  timeoutMs = 10_000,
}) => {
  const list = await jsonGet(
    `${baseUrl}/api/datasources`,
    authHeader(user, password),
    timeoutMs,
  );
  const prometheus = list.filter((ds) => ds.type === "prometheus");
  const chosen = prometheus.find((ds) => ds.isDefault) ?? prometheus[0];
  return chosen?.uid ?? null;
};

/**
 * @returns {Promise<Array<{ uid: string, title: string }>>}
 */
export const listDashboards = async ({
  baseUrl,
  user,
  password,
  timeoutMs = 10_000,
}) => {
  const list = await jsonGet(
    `${baseUrl}/api/search?type=dash-db&limit=200`,
    authHeader(user, password),
    timeoutMs,
  );
  return list
    .map((d) => ({ uid: d.uid, title: d.title }))
    .sort((a, b) => a.title.localeCompare(b.title, "en"));
};

/**
 * @returns {Promise<object>} the dashboard model (`dashboard` field of the API)
 */
export const fetchDashboard = async ({
  baseUrl,
  uid,
  user,
  password,
  timeoutMs = 10_000,
}) => {
  const body = await jsonGet(
    `${baseUrl}/api/dashboards/uid/${uid}`,
    authHeader(user, password),
    timeoutMs,
  );
  return body.dashboard;
};

/**
 * Render one panel to PNG bytes.
 *
 * @returns {Promise<Buffer>}
 */
const renderPanelPng = async ({ url, user, password, timeoutMs }) => {
  const res = await fetch(url, {
    headers: authHeader(user, password),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`render -> ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  const type = res.headers.get("content-type") ?? "";
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!type.includes("image/png")) {
    throw new Error(
      `render returned ${type || "no content-type"} instead of image/png: ${bytes
        .toString("utf8")
        .slice(0, 200)}`,
    );
  }
  return bytes;
};

/**
 * Deterministic gallery for the exported PNGs (pure): stable ordering, no
 * wall-clock stamps beyond the exported window itself.
 *
 * @param {{ from: string, to: string, timeZone: string, dashboards: Array<{ title: string, uid: string, panels: Array<{ title: string, file: string, error?: string | null }> }> }} data
 * @returns {string}
 */
export const renderIndexMarkdown = ({ from, to, timeZone, dashboards }) => {
  const human = (value) =>
    /^-?\d+$/.test(value)
      ? new Date(Number(value)).toISOString().replace("T", " ").slice(0, 19) +
        " UTC"
      : value;
  const lines = [
    "# Grafana-Panels",
    "",
    `Zeitraum: \`${from}\` → \`${to}\` (${human(from)} → ${human(to)}, Render-Zeitzone \`${timeZone}\`)`,
    "",
  ];
  for (const dashboard of dashboards) {
    lines.push(`## ${dashboard.title}`, "");
    for (const panel of dashboard.panels) {
      if (panel.error) {
        lines.push(`### ${panel.title}`, "", `> Export fehlgeschlagen: ${panel.error}`, "");
        continue;
      }
      lines.push(`### ${panel.title}`, "", `![${panel.title}](${panel.file})`, "");
    }
  }
  return lines.join("\n");
};

/** Run `tasks` with at most `limit` in flight, preserving input order. */
const mapWithConcurrency = async (items, limit, worker) => {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, () =>
    (async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await worker(items[index], index);
      }
    })(),
  );
  await Promise.all(runners);
  return results;
};

/**
 * Export every graph panel of every provisioned dashboard as PNG into
 * `outDir/<dashboard-slug>/<panelId>-<panel-slug>.png` plus an `index.md`
 * gallery.
 *
 * Failures of single panels are collected, not thrown: a missing image is
 * better evidence than an aborted export that leaves 40 panels unwritten.
 *
 * @param {{
 *   outDir: string, from: string, to: string,
 *   baseUrl?: string, user?: string, password?: string,
 *   width?: number, height?: number, scale?: number,
 *   timeZone?: string, theme?: string, concurrency?: number,
 *   timeoutMs?: number, log?: (message: string) => void,
 * }} opts
 * @returns {Promise<{ outDir: string, from: string, to: string, total: number, written: number, failed: Array<{ dashboard: string, panel: string, error: string }> }>}
 */
export const exportDashboards = async (opts) => {
  const {
    outDir,
    baseUrl = requireEnv("GRAFANA_URL"),
    user = requireEnv("GRAFANA_USER"),
    password = requireEnv("GRAFANA_PASSWORD"),
    width = 1200,
    height = 500,
    scale = 2,
    timeZone = requireEnv("GRAFANA_TZ"),
    theme = "dark",
    concurrency = 3,
    timeoutMs = 60_000,
    log = () => {},
  } = opts;

  const from = parseTimeInput(opts.from, timeZone);
  const to = parseTimeInput(opts.to, timeZone);
  const base = baseUrl.replace(/\/$/, "");

  const datasourceUid = await resolvePrometheusUid({
    baseUrl: base,
    user,
    password,
  }).catch(() => null);
  const dashboards = await listDashboards({ baseUrl: base, user, password });

  const failed = [];
  let written = 0;
  let total = 0;
  const indexData = [];

  for (const { uid, title } of dashboards) {
    const model = await fetchDashboard({ baseUrl: base, uid, user, password });
    const panels = collectPanels(model);
    const dashboardSlug = slugify(title);
    const dashboardDir = join(outDir, dashboardSlug);
    mkdirSync(dashboardDir, { recursive: true });
    total += panels.length;

    const entries = await mapWithConcurrency(panels, concurrency, async (panel) => {
      // Gauges/stats carry no legend and no time axis — at graph proportions
      // they render as a small dial in a wide empty box, so they get a squarer
      // canvas instead.
      const isDial = /gauge|stat/.test(panel.type);
      const panelWidth = isDial ? Math.round(width * 0.5) : width;
      const panelHeight = isDial ? Math.round(height * 0.7) : height;
      const url = buildRenderUrl({
        baseUrl: base,
        uid,
        slug: dashboardSlug,
        panelId: panel.id,
        from,
        to,
        width: panelWidth,
        height: panelHeight,
        scale,
        timeZone,
        theme,
        datasourceUid,
      });
      const fileName = `${String(panel.id).padStart(2, "0")}-${slugify(panel.title)}.png`;
      try {
        const png = await renderPanelPng({ url, user, password, timeoutMs });
        writeFileSync(join(dashboardDir, fileName), png);
        written += 1;
        return { title: panel.title, file: `${dashboardSlug}/${fileName}`, error: null };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.push({ dashboard: title, panel: panel.title, error: message });
        return { title: panel.title, file: `${dashboardSlug}/${fileName}`, error: message };
      }
    });

    log(`[grafana-export] ${title}: ${entries.filter((e) => !e.error).length}/${panels.length} Panels`);
    indexData.push({ title, uid, panels: entries });
  }

  writeFileSync(
    join(outDir, "index.md"),
    renderIndexMarkdown({ from, to, timeZone, dashboards: indexData }) + "\n",
  );

  return { outDir, from, to, total, written, failed };
};
