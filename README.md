<table>
<tr>
<td width="100">
<img src="assets/logo.png" alt="Claire Logo" width="80">
</td>
<td>

# Claire

Slack-native AI code agent. Mention `@claire` in any thread to read/write code, run commands, and push to GitHub.

</td>
</tr>
</table>

> **CAUTION**: This codebase is mostly AI-generated [OpenCode](https://github.com/anomalyco/opencode). Additionally, Claire executes arbitrary AI-generated code on your system. Running an AI agent with shell access, file system permissions, and GitHub credentials carries inherent security risks. Use at your own risk and only in sandboxed/isolated environments.

## Features

- **Thread = session**: Each Slack thread is a coding session with full context
- **GitHub integration**: Clone, branch, commit, push, create PRs
- **File tools**: Read, write, edit, glob, grep, bash
- **Attachments**: Auto-extracts text from PDFs and LaTeX
- **Artifacts**: Uploads generated images and files back to Slack

## Quick Start

```bash
git clone https://github.com/lockwo/claire.git
cd claire
bun install
cp .env.example .env
# Edit .env with your tokens (see docs/SLACK_SETUP.md)
bun run dev
```

In Slack:
```
/invite @Claire
@Claire hello
```

## Documentation

- [Slack Setup](docs/SLACK_SETUP.md) - Create the Slack app
- [Configuration](docs/CONFIGURATION.md) - Environment variables
- [Deployment](docs/DEPLOYMENT.md) - Docker and production
- [Troubleshooting](docs/TROUBLESHOOTING.md) - Common issues

## Usage

```
@claire <task>
```

### Controls

Include in your message:

| Control | Description |
|---------|-------------|
| `repo=owner/repo` | Set GitHub repository |
| `branch=name` | Set/create branch |
| `model=gpt-5.2` | Use specific model |
| `mode=chat` | Read-only mode (no writes) |
| `scope=channel` | Read channel history (not just thread) |
| `reasoning=none\|low\|medium\|high\|xhigh\|auto` | Set reasoning effort |
| `verbosity=low\|medium\|high` | Control output length |
| `websearch=on\|off` | Toggle web search |
| `ultrathink` | Shortcut for maximum reasoning (xhigh) |
| `abort` | Cancel current task and clear queue |
| `save` / `load=session-id` | Persist/restore sessions |
| `help` | Show commands |

Examples:
```
@claire repo=acme/api branch=fix/auth fix the JWT expiration bug
@claire scope=channel summarize this channel
```

## Environment

Required in `.env`:
```bash
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
ANTHROPIC_API_KEY=sk-ant-...
GITHUB_TOKEN=ghp_...  # optional
```

## Development

```bash
bun run dev       # Hot reload
bun run typecheck # Type check
bun test          # Run tests
```

