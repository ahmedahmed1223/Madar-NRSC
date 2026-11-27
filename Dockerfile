# syntax=docker/dockerfile:1

# ---- Build: compile the SPA and bundle the server --------------------------
FROM node:26.13.1-trixie-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- Runtime: only production dependencies and built assets ----------------
FROM node:26.13.1-trixie-slim AS runtime
ENV NODE_ENV=production \
    DATABASE_ENGINE=postgresql \
    PORT=3000 \
    DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
# «جسر مدار», downloaded from the storage settings and run on a computer inside the station's network.
COPY --from=build /app/bridge ./bridge
# tzdata: TZ=Asia/Riyadh (or any zone) works for logs and scheduled jobs.
RUN apt-get update && apt-get install -y --no-install-recommends tzdata && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data /backups && chown -R node:node /data /backups
USER node
LABEL org.opencontainers.image.title="Madar NRCS" \
      org.opencontainers.image.source="https://github.com/ahmedahmed1223/Madar-NRSC"
VOLUME ["/data", "/backups"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist-server/server.cjs"]
