#!/bin/bash
# ===========================================
# Auto-deploy script for FluentXverse Server
# Triggered by GitHub webhook
# Uses Docker
# ===========================================

set -euo pipefail

# Resolve repo root from this script location so it works on any machine/user
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$SERVER_DIR/.." && pwd)"

LOG_FILE="${HOME}/fluentxverse-deploy.log"
BRANCH="${BRANCH:-main}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "🚀 Starting deployment..."

cd "$REPO_DIR"

# Pull latest changes
log "📥 Pulling from GitHub..."
git fetch origin
git reset --hard origin/$BRANCH

# ==========================================
# DOCKER SERVICES (Server + Frontends)
# ==========================================
log "🐳 Rebuilding Docker containers..."
cd "$SERVER_DIR"

# Pull latest base images
docker compose pull

# Only rebuild and restart the app containers, NOT the databases
# This preserves all database data (Postgres, Memgraph, Redis, SeaweedFS)
APP_CONTAINERS="fluentxverse-server fluentxverse-student fluentxverse-tutor fluentxverse-dashboard"

log "🔄 Rebuilding app containers only (preserving database data)..."
docker compose build $APP_CONTAINERS

log "🔄 Restarting app containers..."
docker compose up -d --no-deps $APP_CONTAINERS

# Wait for containers to be healthy
log "⏳ Waiting for containers to be ready..."
sleep 20

# Check container status
docker compose ps

# Check if the server is healthy
log "🏥 Checking server health..."
if command -v curl >/dev/null 2>&1 && curl -fsS http://localhost:8765/health > /dev/null; then
    log "✅ Server is healthy!"
else
    log "⚠️ Server health check failed, checking logs..."
    docker compose logs --tail=20 fluentxverse-server
fi

# ==========================================
# CLEANUP
# ==========================================
log "🧹 Cleaning up old Docker images..."
docker image prune -f

# ==========================================
# WEBHOOK SERVER (managed by systemd, just restart it)
# ==========================================
log "🎣 Reloading webhook server via systemd if it is already running..."
sudo systemctl try-restart fluentxverse-webhook || log "⚠️ Webhook systemd service not running or not found, skipping"

log "✅ Deployment complete!"
log "📊 Container status:"
docker compose ps
