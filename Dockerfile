# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# AutomationOS — main app (development).
#
# This Dockerfile is used by docker-compose.yml for local development on
# Windows/Linux. Production runs on Replit and does not consume this image.
#
# For the IEE worker, see worker/Dockerfile.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-slim

# Build tooling for native modules (postgres-js, etc.)
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl python3 build-essential \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]
