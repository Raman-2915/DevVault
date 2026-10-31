# Build context: repository root (the backend re-uses src/analyzer/secretSanitizer.js)
FROM node:22-alpine AS dashboard
WORKDIR /app/dashboard
COPY dashboard/package*.json ./
RUN npm ci
COPY dashboard/ ./
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY backend/package*.json backend/
RUN npm --prefix backend ci --omit=dev
COPY backend/ backend/
COPY src/analyzer/secretSanitizer.js src/analyzer/secretSanitizer.js
COPY --from=dashboard /app/dashboard/dist dashboard/dist
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:5000/api/health || exit 1
CMD ["node", "backend/src/server.js"]
