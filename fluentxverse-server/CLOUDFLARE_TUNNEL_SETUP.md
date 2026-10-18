# ===========================================
# Cloudflare Tunnel Setup Guide for FluentXverse
# ===========================================

## Prerequisites
1. A domain on Cloudflare (free plan works)
2. cloudflared installed on your server

## Step 1: Install cloudflared

### On Ubuntu/Debian:
```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb
```

### On macOS:
```bash
brew install cloudflared
```

## Step 2: Authenticate with Cloudflare
```bash
cloudflared tunnel login
```
This opens a browser to authorize. Select your domain.

## Step 3: Create a Tunnel
```bash
cloudflared tunnel create fluentxverse
```
This creates a tunnel and outputs a Tunnel ID (save this!)

## Step 4: Create the config file

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: YOUR_TUNNEL_ID_HERE
credentials-file: /home/YOUR_USER/.cloudflared/YOUR_TUNNEL_ID.json

ingress:
  # API Server (Elysia HTTP)
  - hostname: api.yourdomain.com
    service: http://localhost:8765
  
  # WebSocket Server (Socket.IO)
  - hostname: ws.yourdomain.com
    service: http://localhost:8767
    originRequest:
      noTLSVerify: true
  
  # SeaweedFS Filer (File uploads/downloads)
  - hostname: files.yourdomain.com
    service: http://localhost:8888
  
  # Student Frontend (if hosting yourself)
  - hostname: student.yourdomain.com
    service: http://localhost:5174
  
  # Tutor Frontend (if hosting yourself)
  - hostname: tutor.yourdomain.com
    service: http://localhost:5173
  
  # Dashboard Frontend (if hosting yourself)
  - hostname: dashboard.yourdomain.com
    service: http://localhost:5175
  
  # Catch-all (required)
  - service: http_status:404
```

## Step 5: Create DNS routes
```bash
cloudflared tunnel route dns fluentxverse api.yourdomain.com
cloudflared tunnel route dns fluentxverse ws.yourdomain.com
cloudflared tunnel route dns fluentxverse files.yourdomain.com
cloudflared tunnel route dns fluentxverse student.yourdomain.com
cloudflared tunnel route dns fluentxverse tutor.yourdomain.com
cloudflared tunnel route dns fluentxverse dashboard.yourdomain.com
```

## Step 6: Run the tunnel
```bash
# Test run (foreground)
cloudflared tunnel run fluentxverse

# Or install as a service (recommended for production)
sudo cloudflared service install
sudo systemctl start cloudflared
sudo systemctl enable cloudflared
```

## Step 7: Update your Frontend configs

Update the API URLs in your frontend apps:

### fluentxverse-student/src/config/api.ts
```typescript
export const API_BASE_URL = 'https://api.yourdomain.com';
export const SOCKET_URL = 'https://ws.yourdomain.com';
export const FILES_URL = 'https://files.yourdomain.com';
```

### fluentxverse-tutor/src/config/api.ts
```typescript
export const API_BASE_URL = 'https://api.yourdomain.com';
export const SOCKET_URL = 'https://ws.yourdomain.com';
export const FILES_URL = 'https://files.yourdomain.com';
```

## Step 8: Update Server CORS

In your `.env`:
```
FRONTEND_URLS=https://student.yourdomain.com,https://tutor.yourdomain.com,https://dashboard.yourdomain.com
```

---

## Troubleshooting

### WebSocket not connecting?
- Make sure Socket.IO is configured with `transports: ['websocket', 'polling']`
- Check that `ws.yourdomain.com` points to port 8767

### CORS errors?
- Verify `FRONTEND_URLS` in `.env` includes all your frontend domains
- Restart the server after changing `.env`

### Files not uploading?
- Check SeaweedFS is running: `docker logs fluentxverse-seaweed-filer`
- Verify `files.yourdomain.com` resolves to port 8888

---

## Quick Start Commands

```bash
# 1. Start all Docker services
cd fluentxverse-server
docker compose up -d

# 2. Start the Node.js server
bun run dev  # or: bun run src/index.ts

# 3. Start Cloudflare Tunnel
cloudflared tunnel run fluentxverse

# 4. Check everything is running
docker ps
curl http://localhost:8765/health
curl http://localhost:8888/  # SeaweedFS
```

## Ports Summary
| Service | Port | Tunnel Hostname |
|---------|------|-----------------|
| API (Elysia) | 8765 | api.yourdomain.com |
| WebSocket | 8767 | ws.yourdomain.com |
| SeaweedFS Filer | 8888 | files.yourdomain.com |
| PostgreSQL | 5432 | (internal only) |
| Redis | 6379 | (internal only) |
| Memgraph | 7687 | (internal only) |
