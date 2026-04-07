# TerminalX — Self-hosted terminal IDE for the browser
# Single-stage build: node-pty native addon requires build-essential at both
# compile and runtime (glibc must match). Single stage avoids version mismatches.

FROM node:20-bookworm-slim

# Install system dependencies: tmux (terminal multiplexer), build tools (node-pty)
RUN apt-get update && apt-get install -y --no-install-recommends \
    tmux \
    build-essential \
    python3 \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies (cached layer)
COPY package.json package-lock.json ./
RUN npm ci --production=false

# Copy source
COPY . .

# Build Next.js
RUN npm run build

# Create data directory for user storage and secrets
RUN mkdir -p /app/data && chmod 700 /app/data

# Runtime configuration
ENV NODE_ENV=production
ENV PORT=3000
ENV TERMINUS_HOST=0.0.0.0
ENV TERMINUS_ROOT=/root
ENV TERMINALX_AUTH_MODE=none

EXPOSE 3000

# tsx is needed at runtime to execute TypeScript server directly
CMD ["npx", "tsx", "server/index.ts"]
