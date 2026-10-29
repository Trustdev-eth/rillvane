FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATABASE_PATH=/data/rillvane.sqlite
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node backend ./backend
COPY --chown=node:node dist ./dist
COPY --chown=node:node ops/registry.json ./ops/registry.json
COPY --chown=node:node ops/cloudflare-entrypoint.mjs ./ops/cloudflare-entrypoint.mjs
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=8s --start-period=40s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/livez',{signal:AbortSignal.timeout(5000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","ops/cloudflare-entrypoint.mjs"]
