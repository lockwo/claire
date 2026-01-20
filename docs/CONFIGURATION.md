---
layout: default
title: Configuration
nav_order: 3
---

# Configuration

All configuration is via environment variables. Copy `.env.example` to `.env` and fill in the values.

## Required

```bash
# Slack (get these from api.slack.com/apps)
SLACK_BOT_TOKEN=xoxb-...     # Bot User OAuth Token
SLACK_APP_TOKEN=xapp-...     # App-Level Token for Socket Mode

# LLM (at least one)
ANTHROPIC_API_KEY=sk-ant-... # For Claude models
```

See [SLACK_SETUP.md](./SLACK_SETUP.md) for how to get the Slack tokens.

## Optional

```bash
# GitHub (for repo operations)
GITHUB_TOKEN=ghp_...         # Personal Access Token with 'repo' scope

# Alternative LLM providers
OPENAI_API_KEY=sk-...        # For GPT models
OPENROUTER_API_KEY=sk-or-... # For other models via OpenRouter

# Model settings
DEFAULT_MODEL=gpt-5.2        # Default model to use

# Logging
LOG_LEVEL=info               # debug, info, warn, error
LOG_DIR=./logs               # Where to write log files
LOG_FORMAT=text              # text or json

# Storage
USE_LOCAL_STORAGE=true       # Uses ./data directory
LOCAL_DATA_DIR=./data        # Where to store sessions/jobs/repos

# Agent limits
MAX_AGENT_ITERATIONS=50      # Max tool calls per task
WORKER_MAX_RUNTIME_MS=1800000 # 30 min timeout
MAX_CONCURRENT_JOBS=5        # Parallel jobs
```

## Access Control

```bash
# Restrict usage (comma-separated Slack user IDs)
ALLOWED_USERS=U12345678,U87654321

# Restrict to specific channels
ALLOWED_CHANNELS=C12345678,C87654321

# Restrict which repos can be accessed
ALLOWED_REPOS=myorg/frontend,myorg/backend
BLOCKED_REPOS=myorg/secrets
```

## Models

Claire supports multiple providers:

**Anthropic** (via `ANTHROPIC_API_KEY`):
- `claude-sonnet-4-5-20250929` - Default, balanced (Claude 4.5)
- `claude-opus-4-5-20250929` - Most capable (Claude 4.5)
- `claude-haiku-4-5-20250929` - Fastest (Claude 4.5)

**OpenAI** (via `OPENAI_API_KEY`):
- `gpt-5.2` - Default if set
- `gpt-4.1`

**OpenRouter** (via `OPENROUTER_API_KEY`):
- Any model available on OpenRouter

Users can switch models per-message with `model=claude-opus-4-5-20250929` in their Slack message.

## Example .env

```bash
# Required
SLACK_BOT_TOKEN=xoxb-1234567890-1234567890123-abcdefghijklmnop
SLACK_APP_TOKEN=xapp-1-A1234567890-1234567890123-abcdef
ANTHROPIC_API_KEY=sk-ant-api03-xxxx

# GitHub (optional but recommended)
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx

# Production settings
LOG_LEVEL=info
NODE_ENV=production
```
