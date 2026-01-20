---
layout: default
title: Deployment
nav_order: 4
---

# Deployment

Claire uses Slack Socket Mode - it connects outbound to Slack, so no public URL or webhook endpoint is needed.

## Local

```bash
git clone https://github.com/lockwo/claire.git
cd claire
bun install
cp .env.example .env
# Edit .env with your tokens
bun run dev
```

## Docker

```bash
docker build -t claire .
docker run -d --name claire --env-file .env -v $(pwd)/data:/app/data claire
```

Or with Compose:

```yaml
# docker-compose.yml
services:
  claire:
    build: .
    restart: unless-stopped
    env_file: .env
    volumes:
      - ./data:/app/data
```

```bash
docker-compose up -d
```

## Ubuntu/VPS with PM2

For running on a VPS or bare metal Ubuntu server:

### Prerequisites

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Install Node.js (required for PM2)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 globally
bun add -g pm2
```

### Setup

```bash
git clone https://github.com/lockwo/claire.git
cd claire
bun install
cp .env.example .env
# Edit .env with your tokens
```

### Running with PM2

```bash
# Start Claire
pm2 start "bun run start" --name claire

# View logs
pm2 logs claire

# Check status
pm2 status

# Restart
pm2 restart claire

# Stop
pm2 stop claire
```

### Persist across reboots

```bash
pm2 startup    # Follow the command it outputs
pm2 save       # Save current process list
```

### Alternative: systemd

If you prefer not to install Node.js, use systemd directly:

```bash
sudo tee /etc/systemd/system/claire.service << 'EOF'
[Unit]
Description=Claire Slack Bot
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/claire
ExecStart=/home/ubuntu/.bun/bin/bun run start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable claire
sudo systemctl start claire

# View logs
sudo journalctl -u claire -f
```

## Single Instance

Claire runs as one instance. Socket Mode uses a single WebSocket to Slack - multiple instances don't help. The bottleneck is LLM latency, not Claire's throughput.

If you need more power, scale up (bigger machine) not out.

## Production Notes

**Storage**: Local JSON files work fine. For durability, mount `/app/data` to persistent storage.

**Secrets**: Don't commit `.env`. Use your platform's secrets management.

**Logs**: Claire writes structured logs to stdout and `./logs/`. Set `LOG_LEVEL=info` for production.

**Long tasks**: Agent tasks can run 30+ minutes. Don't deploy on platforms with short timeouts.

## Health Checks

Claire doesn't serve HTTP by default. If your platform requires health checks, either:
- Disable them
- Add a simple endpoint (see `src/index.ts` for where to add one)

The real health indicator is the Slack connection status at api.slack.com/apps.
