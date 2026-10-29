# Anforderungen

Diese Datei definiert, **was** das System leisten und nachweisbar einhalten
soll. Sie enthält keine Technologiebegründungen und keinen Umsetzungsstatus.
Das aktuelle Design steht in [`docs/ARCHITECTURE.md`](ARCHITECTURE.md),
Begründungen im ADR-Index [`docs/DECISIONS.md`](DECISIONS.md) und offene
Umsetzung in [`docs/TODO.md`](TODO.md).

Jede Anforderung hat eine stabile ID (`REQ-F01`, `REQ-Q01`, …), damit Todos,
ADRs und Tests gezielt darauf verweisen können. IDs werden nie neu vergeben;
eine entfallene Anforderung bleibt mit dem Vermerk „entfallen" stehen.

## Produkt und Scope

<!-- Beispiel: Wer nutzt das System, welches Problem löst es, was ist ausdrücklich nicht im Scope? -->

{{PROJEKTZWECK}}

Nicht im Scope:

- {{NICHT_IM_SCOPE}}

## Funktionale Anforderungen

### REQ-F01 — {{TITEL}}

<!-- Beispiel: beobachtbares Verhalten plus Akzeptanzkriterium, keine Umsetzung. -->

- {{VERHALTEN}}
- Akzeptanz: {{AKZEPTANZKRITERIUM}}

## Qualitätsanforderungen

### REQ-Q01 — {{TITEL}}

<!-- Beispiel: Performance, Sicherheit, Verfügbarkeit, Wartbarkeit — messbar formuliert. -->

- {{ANFORDERUNG}}
