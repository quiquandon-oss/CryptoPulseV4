# CryptoPulse V4 Deployment Guide

This document outlines deployment strategies for CryptoPulse V4.

---

## 🏗 Architecture & Isolation Summary

- **Isolated Runtime**: Next.js App Router (Node.js 20+)
- **Database**: `better-sqlite3` storing data at `data/v4.db`
- **Legacy Safety**: 100% isolated from CryptoPulse V1/V2/V3 production systems.

---

## 📦 Option 1: Docker / Self-Hosted VPS Deployment (Recommended)

Because V4 uses native SQLite (`better-sqlite3`), running in a Docker container or Node.js VPS provides fast execution and persistence.

### Dockerfile

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/data ./data

EXPOSE 3000
CMD ["npm", "start"]
```

### Docker Commands

```bash
docker build -t cryptopulse-v4 .
docker run -d -p 3000:3000 --name cryptopulse-v4 -v $(pwd)/data:/app/data cryptopulse-v4
```

---

## ☁️ Option 2: Platform-as-a-Service (Render / Railway / Fly.io)

1. Connect your repository branch to your PaaS dashboard.
2. Set build command: `npm run build`
3. Set start command: `npm start`
4. Mount a persistent disk/volume at `/app/data` to persist `v4.db`.

---

## 🔍 Initializing Market Data in Production

Once deployed, trigger the 90-day market data backfill endpoint once:

```bash
curl -X POST https://your-domain.com/api/backfill
```
