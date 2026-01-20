# Build stage
FROM oven/bun:1.1 as builder

WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Type check (optional, can be removed for faster builds)
RUN bun run typecheck || true

# Production stage
FROM oven/bun:1.1-slim

WORKDIR /app

# Install git and other runtime dependencies
RUN apt-get update && apt-get install -y \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./

# Create data directory
RUN mkdir -p /app/data

# Set environment defaults
ENV NODE_ENV=production
ENV USE_LOCAL_STORAGE=true
ENV LOCAL_DATA_DIR=/app/data

# Run the application
CMD ["bun", "run", "src/index.ts"]
