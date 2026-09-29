#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# Add a bundled Codex CLI only when an executable is present.
for candidate in \
  "$HOME/.codex/bin/codex" \
  "/Applications/Codex.app/Contents/Resources/codex" \
  "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex"; do
  if [ -x "$candidate" ]; then
    PATH="$(dirname "$candidate"):$PATH"
    export PATH
    break
  fi
done

finish() {
  status=$?
  if [ "$status" -ne 0 ]; then
    printf '\nAvvio demo non riuscito (codice %s). Controlla il messaggio sopra.\n' "$status"
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
if ! command -v npm >/dev/null 2>&1; then
  printf 'npm non trovato. Reinstalla Node.js 24 o successivo e riprova.\n' >&2
  exit 1
fi
if ! command -v codex >/dev/null 2>&1; then
  printf 'Codex CLI non trovato. Apri Codex e installa/abilita il comando CLI, poi riprova.\n' >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  printf 'Dipendenze locali assenti: npm scaricherà le dipendenze del progetto con gli script disabilitati.\n'
  npm ci --ignore-scripts
fi
printf 'Compilo il server locale…\n'
npm run build

node scripts/connect-codex.mjs
node scripts/demo-session.mjs start
printf '\nDemo pronta. Segui il prompt mostrato sopra in Codex.\n'
