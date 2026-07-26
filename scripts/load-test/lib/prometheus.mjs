/**
 * Thin Prometheus HTTP API client (instant queries + target health).
 *
 * Every raw response should be persisted by the caller before values are
 * derived (automation doc, step 6). This module only performs the fetch and
 * extracts the first scalar/vector value; it does no interpretation.
 */

/**
 * @param {string} baseUrl e.g. http://localhost:10007
 * @param {string} promql
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ raw: object, value: number | null }>}
 */
export const instantQuery = async (baseUrl, promql, fetchImpl = fetch) => {
  const url = `${baseUrl}/api/v1/query?query=${encodeURIComponent(promql)}`;
  const res = await fetchImpl(url);
  if (!res.ok) {
    return { raw: { status: "error", httpStatus: res.status }, value: null };
  }
  const raw = await res.json();
  const result = raw?.data?.result ?? [];
  if (result.length === 0) return { raw, value: null };
  // Instant vector: [ { metric, value: [ts, "v"] } ]; scalar: { value:[ts,"v"] }.
  const first = result[0];
  const valueTuple = Array.isArray(first) ? first : first.value;
  const value = valueTuple ? Number(valueTuple[1]) : null;
  return { raw, value: Number.isFinite(value) ? value : null };
};

/**
 * Whether a scrape target reports `up == 1`. Returns null when the query
 * yields no series (target unknown), distinct from `false` (target down).
 *
 * @param {string} baseUrl
 * @param {string} job
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<boolean | null>}
 */
export const targetUp = async (baseUrl, job, fetchImpl = fetch) => {
  const { value } = await instantQuery(baseUrl, `up{job="${job}"}`, fetchImpl);
  if (value === null) return null;
  return value === 1;
};
