# Build the web app, then run the API server, which also serves web/dist. Build and run with OrbStack (never Docker Desktop):
#   HOST_PORT=7805 docker compose up --build -d   ->  http://127.0.0.1:7805/
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci --ignore-scripts
COPY web web
RUN npm run build -w web

FROM node:26-alpine
WORKDIR /app
# MODE=mock: the image shows only the made-up sample snapshot in data/. Real is refused in the image (the bind is not loopback, and no file is mounted).
ENV NODE_ENV=production PORT=7805 MODE=mock
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci --omit=dev -w server --ignore-scripts && npm cache clean --force
COPY server/src server/src
COPY data data
COPY --from=build /app/web/dist web/dist
USER node
EXPOSE 7805
# Inside the container the server must listen on all interfaces, so ENV_MAP_BIND is set here on purpose.
# The compose file publishes the port on 127.0.0.1 only; do not publish it more widely.
ENV ENV_MAP_BIND=0.0.0.0
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:7805/api/health').then(r=>r.json()).then(j=>process.exit(j.schema==='demo-health/1'&&j.state==='ready'?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/src/index.js"]
