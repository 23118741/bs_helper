# Build from the repository root:  docker build -f server/Dockerfile -t brightspace-helper-api:latest .
FROM node:22-bookworm-slim AS build
WORKDIR /app
# build tools only as a fallback in case no prebuilt better-sqlite3 binary matches
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci
COPY shared shared
COPY server/tsconfig.json server/tsconfig.build.json server/
COPY server/src server/src
RUN cd server && npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/server/node_modules server/node_modules
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/package.json server/package.json
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "server/dist/server/src/index.js"]
