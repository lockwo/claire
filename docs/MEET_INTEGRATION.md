# Google Meet Integration

Claire can listen to Google Meet calls and automatically execute coding tasks mentioned during meetings. Say something like "let's add a new API endpoint for user profiles" and Claire will detect it, extract the task, and execute it.

## Two Methods

### Method 1: Bot Account (Recommended)

A Puppeteer bot joins the meeting as a participant and captures captions.

**Best for:** Org meetings where you need a dedicated bot account.

**Setup:**

1. Get IT to create a Google Workspace account (e.g., `claire-bot@yourcompany.com`)
2. Run the auth script to save the login session:
   ```bash
   bun run meet-auth
   ```
3. Log into the bot account in the browser that opens
4. Navigate to meet.google.com and press Enter
5. Session saved to `meet-auth.json`

**Usage:**

In Slack:
```
/claire bind-meet https://meet.google.com/abc-defg-hij
```

The bot joins the meeting and starts listening. Results post to a thread in the channel where you ran the command.

Other commands:
```
/claire unbind-meet https://meet.google.com/abc-defg-hij  # Disconnect bot
/claire meet-status                                        # Show active bots
```

### Method 2: Firefox Extension

A browser extension captures captions from meetings you're personally in.

**Best for:** When you don't have a bot account, or want invisible capture.

**Setup:**

1. Open Firefox → `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on..."
3. Select `firefox-extension/manifest.json`

**Configuration:**

Click the extension icon to configure:

| Field | Description | Example |
|-------|-------------|---------|
| **API URL** | Where Claire is running | `http://localhost:3000` (local) or `http://your-server:3000` (remote) |
| **Slack Channel ID** | Channel for results. In Slack app: right-click channel → open details → scroll to bottom. Or copy link and extract the `C...` part | `C0123456789` |
| **Thread Timestamp** | Optional. Post to specific thread instead of channel | `1234567890.123456` |

**Usage:**

1. Join a Google Meet call
2. Enable captions (`Shift+C`)
3. Click extension icon → toggle "Enable Capture"

## How Trigger Detection Works

Claire uses two-stage detection:

1. **Keyword matching** (fast) - Looks for phrases like "let's add", "we should create", "can we fix"
2. **LLM distillation** (accurate) - Extracts the actual task from natural speech

This means you don't need to say "Claire" - just speak naturally about what you want to build.

**Examples that trigger:**
- "Let's try adding a dark mode toggle"
- "We should create an endpoint for user settings"
- "Can we fix that authentication bug?"
- "I'll write a function to validate emails"

**Examples that don't trigger:**
- "Yeah that sounds good"
- "I think we discussed this yesterday"
- "Let me share my screen"

## Configuration

Environment variables in `.env`:

```bash
# Bot display name in meetings
MEET_BOT_DISPLAY_NAME=Claire Bot

# Run browser in headless mode (set false for debugging)
MEET_BOT_HEADLESS=true

# Minimum confidence to execute (0.0 - 1.0)
MEET_MIN_TRIGGER_CONFIDENCE=0.6

# Cooldown between similar triggers (ms)
MEET_COOLDOWN_MS=30000

# HTTP API port for extension
HTTP_PORT=3000
```

## Troubleshooting

**Bot can't join org meetings:**
- Your org likely blocks external guests
- Solution: Use a Google Workspace account from your org (Method 1 with auth)

**Extension not sending captions:**
- Make sure captions are enabled in Meet (`Shift+C`)
- Check the API URL is correct and Claire is running
- Open browser console for error messages

**Tasks not being detected:**
- Speak more explicitly about the task ("let's add X" rather than "maybe we could look at X")
- Check `MEET_MIN_TRIGGER_CONFIDENCE` - lower it if tasks aren't being picked up
