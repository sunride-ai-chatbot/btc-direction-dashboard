# Backend service image for Railway.
# node:sqlite needs Node >= 23.4 unflagged; 26 matches local development.
FROM node:26-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/backend/package.json packages/backend/
COPY packages/frontend/package.json packages/frontend/
RUN npm ci --ignore-scripts
COPY packages/backend packages/backend
RUN npm run build -w backend

FROM node:26-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/backend/package.json packages/backend/
RUN npm ci --ignore-scripts --omit=dev -w backend && npm cache clean --force
COPY --from=build /app/packages/backend/dist packages/backend/dist
COPY packages/backend/data/macro-events.json packages/backend/data/macro-events.json
WORKDIR /app/packages/backend
# DATABASE_PATH (e.g. /data/bitcoin-dashboard.sqlite) must point into the mounted volume.
CMD ["node", "dist/server.js"]
