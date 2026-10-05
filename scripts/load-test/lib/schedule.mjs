/**
 * Zeitplan von Phase A auf der k6-Uhr (Sekunde 0 = k6-Start).
 *
 * `SALE_OPENS_IN_SECONDS` zaehlt ab dem Reset, k6 startet erst nach dem
 * frischen Scrape und den Vorher-Snapshots. Ohne diese Umrechnung ist aus dem
 * Profil nicht ablesbar, in welche Stage die Verkaufsoeffnung faellt — und
 * genau dort entscheidet sich, ob der Verbindungssturm in den Warm-up oder in
 * die Rampe trifft.
 */

const formatSecond = (second) => `${Math.round(second)} s`;

/**
 * @param {number} saleOpensAtSecond Sekunde auf der k6-Uhr; null = kein Gate
 * @param {number} rampStartsAt
 * @param {number} sustainStartsAt
 * @param {number} phaseAEndsAt
 */
const stageOf = (
  saleOpensAtSecond,
  rampStartsAt,
  sustainStartsAt,
  phaseAEndsAt,
) => {
  if (saleOpensAtSecond === null) return "ohne Gate, offen ab Start";
  if (saleOpensAtSecond < 0) return "vor dem k6-Start, offen ab Start";
  if (saleOpensAtSecond < rampStartsAt) return "im Warm-up";
  if (saleOpensAtSecond < sustainStartsAt) return "in der Rampe";
  if (saleOpensAtSecond < phaseAEndsAt) return "im Sustain";
  return "nach dem Ende von Phase A";
};

/**
 * @param {{
 *   warmupSeconds: number,
 *   rampSeconds: number,
 *   sustainSeconds: number,
 *   warmupRate: number,
 *   targetRate: number,
 *   saleOpensAtSecond: number | null,
 * }} plan
 * @returns {string[]}
 */
export const describePhaseASchedule = ({
  warmupSeconds,
  rampSeconds,
  sustainSeconds,
  warmupRate,
  targetRate,
  saleOpensAtSecond,
}) => {
  const rampStartsAt = warmupSeconds;
  const sustainStartsAt = warmupSeconds + rampSeconds;
  const phaseAEndsAt = sustainStartsAt + sustainSeconds;
  const stage = stageOf(
    saleOpensAtSecond,
    rampStartsAt,
    sustainStartsAt,
    phaseAEndsAt,
  );
  const opening =
    saleOpensAtSecond === null || saleOpensAtSecond < 0
      ? `Verkauf: ${stage}`
      : `Verkauf oeffnet bei ${formatSecond(saleOpensAtSecond)} (${stage})`;

  return [
    `Warm-up  0 s - ${formatSecond(rampStartsAt)}: ${warmupRate} it/s flat`,
    `Rampe    ${formatSecond(rampStartsAt)} - ${formatSecond(sustainStartsAt)}: ${warmupRate} -> ${targetRate} it/s`,
    `Sustain  ab ${formatSecond(sustainStartsAt)}: ${targetRate} it/s bis Sold-out, spaetestens bis ${formatSecond(phaseAEndsAt)}`,
    opening,
  ];
};
