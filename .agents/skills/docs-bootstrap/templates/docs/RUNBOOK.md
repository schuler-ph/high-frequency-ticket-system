# Runbook

Ausführbare Abläufe: welcher Befehl, in welcher Reihenfolge. Begründungen
stehen in den ADRs, nicht hier. Jeder Abschnitt ist für sich lesbar, damit ein
Agent nur den gerade nötigen Ablauf laden muss.

## 1. Lokales Setup

```bash
{{QUICKSTART}}
```

## 2. Entwickeln

<!-- Beispiel: Dev-Server, Watch-Modus, benötigte Hintergrunddienste. -->

{{ENTWICKELN}}

## 3. Verifikation vor dem Commit

```bash
{{VALIDIERUNG}}
node scripts/check-docs.mjs
```

## 4. Debugging

<!-- Beispiel: häufige Fehlerbilder mit Symptom → Ursache → Befehl. -->

{{DEBUGGING}}
