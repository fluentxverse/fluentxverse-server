# Build circom once, then copy only the binary into the runtime image.
FROM docker.io/oven/bun:1-alpine AS circom-builder

RUN apk add --no-cache build-base cargo git
RUN cargo install --git https://github.com/iden3/circom.git --tag v2.1.9 circom

# Use official Bun image
FROM docker.io/oven/bun:1-alpine

# Create non-root user early (before any files are copied)
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Local Groth16 proof generation needs circom and snarkjs.
COPY --from=circom-builder /root/.cargo/bin/circom /usr/local/bin/circom
RUN apk add --no-cache nodejs npm && npm install -g snarkjs@0.7.6

# Set working directory
WORKDIR /app

# Copy package files first (for better caching)
COPY --chown=appuser:appgroup package.json bun.lock* ./

# Install dependencies without mutating the copied workspace lockfile.
RUN bun install --production --no-save

# Copy source code
COPY --chown=appuser:appgroup src ./src
COPY --chown=appuser:appgroup scripts/migrate-classroom-learning-data-to-memgraph.ts ./scripts/
COPY --chown=appuser:appgroup scripts/check-web3.ts ./scripts/
COPY --chown=appuser:appgroup scripts/review-tally-operator.ts scripts/verify-review-tally.ts ./scripts/
COPY --chown=appuser:appgroup circuits ./circuits
COPY --chown=appuser:appgroup tsconfig.json ./

RUN mkdir -p zk-artifacts/student-lesson circuits/student-lesson/build && chown -R appuser:appgroup zk-artifacts circuits

# Switch to non-root user
USER appuser

# Expose ports (HTTP API + Socket.IO)
EXPOSE 8765 8767

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8765/health || exit 1

# Start the server
CMD ["bun", "run", "src/index.ts"]
