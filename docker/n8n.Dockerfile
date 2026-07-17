FROM n8nio/n8n:2.30.5

USER root
COPY n8n/docker-entrypoint.sh /opt/cleancod3/docker-entrypoint.sh
COPY n8n/workflows/creator-research.json /opt/cleancod3/creator-research.json
RUN chmod +x /opt/cleancod3/docker-entrypoint.sh && chown -R node:node /opt/cleancod3
USER node

ENTRYPOINT ["/opt/cleancod3/docker-entrypoint.sh"]
