# ADR-001: Monorepo mit Turborepo

- **Datum:** 2026-02-24
- **Kontext:** Einzelnes Showcase-Projekt mit Frontend, API, Worker und shared Packages. Recruiter und Reviewer sollen alles in einem Repository sehen können.
- **Entscheidung:** Turborepo mit pnpm Workspaces.
- **Begründung:** Einfacher als Nx für diesen Scope. Exzellentes Build-Caching. Nativer Support für pnpm. Klare Workspace-Struktur (`apps/*`, `packages/*`).
- **Alternativen:** Nx (zu komplex für Scope), separate Repositories (fragmentiert Portfolio).
