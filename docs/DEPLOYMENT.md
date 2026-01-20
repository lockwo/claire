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
