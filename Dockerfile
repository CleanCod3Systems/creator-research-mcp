FROM node:22-slim
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends \
    python3 curl ca-certificates && rm -rf /var/lib/apt/lists/* \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

EXPOSE 3333
CMD ["pnpm", "mcp:http"]
