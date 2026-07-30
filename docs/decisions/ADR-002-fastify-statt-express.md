# ADR-002: Fastify statt Express

- **Datum:** 2026-02-24
- **Kontext:** High-Concurrency API benötigt maximale Performance bei I/O-bound Workloads. Das System muss unter extremer Last (50.000+ gleichzeitige Nutzer) stabil bleiben.
- **Entscheidung:** Fastify als HTTP-Framework für API Gateway und Worker.
- **Begründung:** ~2x schneller als Express in Benchmarks. Schema-basierte Serialisierung reduziert Overhead. Native TypeScript-Unterstützung. Plugin-Architektur passt zu Microservice-Pattern.
- **Alternativen:** Express (langsamer, legacy patterns), Hono (weniger Ecosystem-Support für Node.js).
