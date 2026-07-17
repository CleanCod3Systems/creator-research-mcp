#!/bin/sh
set -eu

marker="/home/node/.n8n/.cleancod3-workflow-imported"
if [ ! -f "$marker" ]; then
  i=0
  while [ "$i" -lt 10 ]; do
    if n8n import:workflow --input=/opt/cleancod3/creator-research.json; then
      touch "$marker"
      break
    fi
    i=$((i + 1))
    sleep 3
  done
  if [ ! -f "$marker" ]; then
    echo "No se pudo importar el workflow de CleanCod3" >&2
    exit 1
  fi
fi

exec n8n start
