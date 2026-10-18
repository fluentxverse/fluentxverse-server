# ===========================================
# Auto-Deploy Setup Guide for FluentXverse
# ===========================================

## Option 1: GitHub Webhooks (Recommended)

### Step 1: Set up the webhook server

```bash
# Make deploy script executable
chmod +x scripts/deploy.sh

# Edit deploy.sh - update REPO_DIR to your actual path
nano scripts/deploy.sh

# Install PM2 globally (process manager)
bun install -g pm2

# Start the webhook server
cd fluentxverse-server
pm2 start scripts/webhook-server.ts --name webhook --interpreter bun

# Start your main server too
pm2 start src/index.ts --name fluentxverse-server --interpreter bun

# Save PM2 config (auto-start on reboot)
pm2 save
pm2 startup
```

### Step 2: Expose webhook via Cloudflare Tunnel

Add to your `~/.cloudflared/config.yml`:
```yaml
ingress:
  # ... your other services ...
  
  - hostname: webhook.yourdomain.com
    service: http://localhost:9000
  
  - service: http_status:404
```

Then add DNS route:
```bash
cloudflared tunnel route dns fluentxverse webhook.yourdomain.com
```

### Step 3: Configure GitHub Webhook

1. Go to your repo: `github.com/fluentxverse/fluentxverse-monorepo/settings/hooks`
2. Click "Add webhook"
3. Fill in:
   - **Payload URL:** `https://webhook.yourdomain.com/webhook`
   - **Content type:** `application/json`
   - **Secret:** Generate one: `openssl rand -hex 32`
   - **Events:** Just the push event
4. Save

### Step 4: Set webhook secret in environment

```bash
# Add to your .env or export
export WEBHOOK_SECRET=your-generated-secret

# Or edit webhook-server.ts directly (less secure)
```

### Step 5: Test it!

```bash
# Push a commit to main branch
git commit --allow-empty -m "Test deploy"
git push origin main

# Check logs
pm2 logs webhook
pm2 logs fluentxverse-server
```

---

## Option 2: Simple Cron Pull (Easiest)

If you don't want webhooks, just poll every few minutes:

```bash
# Edit crontab
crontab -e

# Add this line (checks every 5 minutes)
*/5 * * * * cd /home/YOUR_USER/fluentxverse && git fetch origin && git diff --quiet HEAD origin/main || /home/YOUR_USER/fluentxverse/fluentxverse-server/scripts/deploy.sh
```

This checks for changes every 5 minutes and deploys if there are any.

---

## Option 3: GitHub Actions + SSH (Advanced)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Server

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1.0.0
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /home/user/fluentxverse
            git pull origin main
            cd fluentxverse-server
            bun install
            pm2 restart fluentxverse-server
```

Then add secrets in GitHub repo settings:
- `SERVER_HOST`: Your server IP or Cloudflare Tunnel hostname
- `SERVER_USER`: SSH username
- `SSH_PRIVATE_KEY`: Your private SSH key

---

## Quick Reference

| Method | Pros | Cons |
|--------|------|------|
| **Webhook** | Instant deploys, secure | Need to run webhook server |
| **Cron** | Super simple, no extra services | Up to 5 min delay |
| **GitHub Actions + SSH** | No server-side setup | Need SSH exposed or Tailscale |

---

## PM2 Commands Cheatsheet

```bash
pm2 list                    # Show all processes
pm2 logs                    # View all logs
pm2 logs fluentxverse-server # View specific logs
pm2 restart all             # Restart everything
pm2 stop all                # Stop everything
pm2 delete all              # Remove all processes
pm2 monit                   # Real-time monitoring
```
