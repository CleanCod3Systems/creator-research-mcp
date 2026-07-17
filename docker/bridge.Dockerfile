FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl ffmpeg python3 python3-pip && rm -rf /var/lib/apt/lists/* \
    && python3 -m pip install --break-system-packages --no-cache-dir yt-dlp faster-whisper

WORKDIR /app
COPY scripts/n8n-bridge.mjs scripts/transcribe-audio.py ./scripts/

ENV N8N_BRIDGE_PORT=3334
ENV WHISPER_PYTHON=python3
ENV WHISPER_SCRIPT=/app/scripts/transcribe-audio.py
ENV WHISPER_MODEL=tiny
ENV HF_HUB_CACHE=/root/.cache/huggingface
EXPOSE 3334
CMD ["node", "scripts/n8n-bridge.mjs"]
