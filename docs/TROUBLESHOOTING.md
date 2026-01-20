---
layout: default
title: Troubleshooting
nav_order: 5
---

# Troubleshooting

## Quick Checks

```bash
# Is Claire running?
ps aux | grep claire

# Check logs
tail -f logs/claire.log

# Debug mode
LOG_LEVEL=debug bun run dev
```

## Slack Issues

### Claire doesn't respond to @mentions

1. **Is Claire invited to the channel?** `/invite @Claire`
2. **Is Socket Mode enabled?** Check api.slack.com/apps → Socket Mode
3. **Is `app_mention` event subscribed?** Check Event Subscriptions
4. **Check logs** for incoming events

### "missing_scope" error

Add the missing scope at api.slack.com/apps → OAuth & Permissions, then **reinstall the app**.

### "invalid_auth" error

- Bot token must start with `xoxb-`
- App token must start with `xapp-`
- Check for extra whitespace in `.env`
- Try regenerating tokens

### "channel_not_found" error

Claire needs to be invited to the channel: `/invite @Claire`

## LLM Issues

### "invalid_api_key" error

- Anthropic keys start with `sk-ant-`
- Check the key at console.anthropic.com
- Verify billing is set up

### Rate limit errors

Built-in retry handles this. If persistent:
- Check usage at console.anthropic.com
- Reduce concurrent jobs
- Upgrade your plan

### "context_length_exceeded" error

- Start a fresh thread (long threads accumulate context)
- Avoid reading huge files in one go
- Use a model with larger context

## GitHub Issues

### "Repository not found"

- Check the format: `owner/repo` (e.g., `acme/frontend`)
- Verify token has `repo` scope for private repos
- Confirm repo exists and you have access

### "Bad credentials"

- Classic tokens start with `ghp_`
- Fine-grained tokens start with `github_pat_`
- Token may have expired - generate a new one

### Push rejected

- Check branch protection rules
- May need to create a PR instead
- Token may lack push permissions

## Runtime Issues

### "Max iterations reached"

The task is too complex or the agent got stuck. Solutions:
- Break the task into smaller pieces
- Increase `MAX_AGENT_ITERATIONS` if needed
- Check logs for repeated failing operations

### Task timeout

Agent tasks can run long. Solutions:
- Increase `WORKER_MAX_RUNTIME_MS`
- Break complex tasks into steps
- Check for slow git operations (large repos)

### Out of memory

```bash
# Increase Bun memory limit
BUN_MEMORY_LIMIT=4096 bun run start
```

Or increase container memory allocation.

## FAQ

**Can I run multiple instances?**
No. Socket Mode uses one WebSocket connection. Scale up, not out.

**How do I reset a stuck session?**
Send `abort` in the thread, then start a new thread.

**Can Claire work in DMs?**
Add `im:history`, `im:read`, `im:write` scopes and subscribe to `message.im` event.

**How do I update Claire?**
```bash
git pull
docker-compose build && docker-compose up -d
```

## Getting Help

1. Check [existing issues](https://github.com/lockwo/claire/issues)
2. Gather logs with `LOG_LEVEL=debug` (redact tokens!)
3. Open an issue with steps to reproduce
