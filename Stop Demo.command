#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

finish() {
  status=$?
  if [ "$status" -ne 0 ]; then
    printf '\nArresto demo non riuscito (codice %s). Controlla il messaggio sopra.\n' "$status"
    if [ -t 0 ]; then
      read -r -p 'Premi Invio per chiudere questa finestra. ' _ || true
    fi
  fi
}
trap finish EXIT

cd "$ROOT"
if ! command -v node >/dev/null 2>&1; then
  printf 'Node.js 24 o successivo non trovato. Installa Node.js e riprova.\n' >&2
  exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'; then
  printf 'Serve Node.js 24 o successivo; versione trovata: %s.\n' "$(node --version)" >&2
  exit 1
fi

node scripts/demo-session.mjs stop
printf '\nDemo arrestata.\n'
