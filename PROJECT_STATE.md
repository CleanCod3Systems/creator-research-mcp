# CleanCod3 Intelligence - paquete portable

## Objetivo
Investigar creadores de frontend/IA para producir reels de CleanCod3 y construir luego un curso práctico de frontend con React, Next/Vite e IA.

## Arquitectura portable
- Dashboard: `http://localhost:8080`
- n8n: `http://localhost:5678`
- MCP/API: `http://localhost:3333/mcp` y `http://localhost:3333/api`
- Puente: interno en Docker; API local de diagnóstico `http://localhost:3334`
- SQLite: `data/creator-research.db`
- Google Sheets: fuera del flujo principal
- NotebookLM: opcional, solo como memoria documental de Google Drive

## Uso
Enviar POST a `http://localhost:5678/webhook/creator-research` con:
```json
{"profile_url":"https://www.youtube.com/@midudev","platform":"youtube","request":"analizar temas ganadores","limit":10}
```

## Limitaciones
- YouTube: permite listar canales y detectar videos ganadores.
- Instagram: el MCP actual acepta posts/reels públicos individuales, no lista perfiles completos.
- Para que funcione después de reiniciar el equipo deben estar activos n8n, creator-research y el puente local.

## Operación
Usar `./scripts/cleancod3 start`, `stop`, `backup` y `reset`. La guía completa está en
[`docs/portable.md`](docs/portable.md).
