---
layout: default
title: Home
nav_order: 1
---

<img src="../assets/logo.png" alt="Claire Logo" width="80" style="float: left; margin-right: 15px;">

# Claire

Slack-native AI code agent. Mention `@claire` in a thread to read/write code, run commands, and push to GitHub.

## Quick Start

1. [Set up your Slack app](SLACK_SETUP.md)
2. [Configure environment](CONFIGURATION.md)
3. Run:
   ```bash
   bun install
   cp .env.example .env
   # Edit .env with your tokens
   bun run dev
   ```
4. In Slack: `/invite @Claire` then `@Claire hello`

## Docs

- [Slack Setup](SLACK_SETUP.md) - Create and configure the Slack app
- [Configuration](CONFIGURATION.md) - Environment variables and settings
- [Deployment](DEPLOYMENT.md) - Run in Docker or production
- [Troubleshooting](TROUBLESHOOTING.md) - Common issues and fixes

## How It Works

Each Slack thread becomes a coding session. Claire has tools to:
- Read, write, edit files
- Run shell commands
- Clone repos, commit, push, create PRs
- Process PDF/LaTeX attachments

Results and artifacts are posted back to the thread.

## Controls

Include these in your message to configure behavior:

```
repo=owner/repo         Set the GitHub repository
branch=feature-x        Set/create a branch
model=gpt-5.2           Use a specific model
mode=chat               Read-only mode (no writes)
scope=channel           Read channel history (not just thread)
scope=channel:last_50   Read last 50 channel messages
reasoning=high          Set reasoning effort (none/low/medium/high/xhigh/auto)
verbosity=low           Control output length (low/medium/high)
websearch=on            Toggle web search (on/off)
ultrathink              Shortcut for maximum reasoning (xhigh)
abort                   Cancel current task and clear queue
save                    Save session for later
load=session-id         Restore a saved session
help                    Show available commands
```

## Source

[github.com/lockwo/claire](https://github.com/lockwo/claire)
