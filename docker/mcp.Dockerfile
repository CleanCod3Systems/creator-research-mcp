FROM node:22-bookworm-slim

RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates python3 && rm -rf /var/lib/apt/lists/* \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

ENV MCP_HTTP_PORT=3333
ENV DATABASE_PATH=/app/data/creator-research.db
EXPOSE 3333
CMD ["pnpm", "mcp:http"]
