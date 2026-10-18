FROM rust:1.90-bookworm AS builder
RUN apt-get update && apt-get install -y --no-install-recommends cmake clang pkg-config curl && rm -rf /var/lib/apt/lists/*
RUN curl -fL https://risc0-artifacts.s3.us-west-2.amazonaws.com/rzup/prod/Linux-X64/rzup -o /tmp/rzup && chmod +x /tmp/rzup && /tmp/rzup install rust 1.88.0
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY core ./core
COPY host ./host
COPY methods ./methods
RUN RISC0_BUILD_LOCKED=1 cargo build --locked --release -p review-tally-host -j 2

FROM oven/bun:1
WORKDIR /app
COPY --from=builder /build/target/release/review-tally-host /app/review-tally-host
COPY prover-server.mjs ./
USER bun
EXPOSE 8092
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD bun -e "const r=await fetch('http://127.0.0.1:8092/health');process.exit(r.ok?0:1)"
CMD ["bun", "prover-server.mjs"]
