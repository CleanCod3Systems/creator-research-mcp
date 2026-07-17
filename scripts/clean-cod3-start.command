#!/bin/zsh
set -e
cd "$(dirname "$0")/.."
set -a
source .env
set +a

echo "Encendiendo CleanCod3..."

if ! curl -sf http://localhost:5678/healthz >/dev/null; then
  nohup n8n start >"$TMPDIR/cleancod3-n8n.log" 2>&1 &
fi

if ! curl -sf http://localhost:3333/healthz >/dev/null; then
  nohup creator-research-mcp http >"$TMPDIR/cleancod3-mcp.log" 2>&1 &
fi

if ! curl -sf http://localhost:3334/healthz >/dev/null; then
  nohup node scripts/n8n-bridge.mjs >"$TMPDIR/cleancod3-bridge.log" 2>&1 &
fi

echo "Listo: n8n, creator-research y puente local encendidos."
open http://localhost:5678
read -k 1 "?Presiona cualquier tecla para cerrar..."
