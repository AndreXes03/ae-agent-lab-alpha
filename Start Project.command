#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
CANCELLED="__AE_AGENT_PROJECT_PICKER_CANCELLED__"

if ! selected="$(/usr/bin/osascript -e '
try
  set selectedFile to choose file with prompt "Seleziona un progetto After Effects (.aep)"
  return POSIX path of selectedFile
on error number -128
  return "__AE_AGENT_PROJECT_PICKER_CANCELLED__"
end try
')"; then
  printf 'Impossibile aprire il selettore del progetto.\n' >&2
  exit 1
fi

if [ "$selected" = "$CANCELLED" ]; then
  exit 0
fi

if [ ! -f "$selected" ]; then
  printf 'Il percorso selezionato non è un file regolare.\n' >&2
  exit 1
fi

case "$selected" in
  *.[aA][eE][pP]) ;;
  *)
    printf 'Seleziona un file .aep.\n' >&2
    exit 1
    ;;
esac

exec /bin/bash "$ROOT/Start Demo.command" --project "$selected"
