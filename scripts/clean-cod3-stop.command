#!/bin/zsh
echo "Apagando servicios CleanCod3..."
pkill -f "node scripts/n8n-bridge.mjs" 2>/dev/null || true
pkill -f "creator-research-mcp http" 2>/dev/null || true
pkill -f "n8n start" 2>/dev/null || true
echo "Servicios detenidos."
read -k 1 "?Presiona cualquier tecla para cerrar..."
