# Claire Meet Captions - Firefox Extension

Captures live captions from Google Meet and sends them to Claire for processing.

## Installation

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on..."
3. Select the `manifest.json` file from this folder

## Configuration

Click the extension icon in the toolbar to configure:

### API URL

The URL where Claire is running. Examples:
- **Local development:** `http://localhost:3000`
- **Remote server:** `http://your-server-ip:3000` or `https://claire.yourdomain.com`

This should match where Claire's HTTP server is listening (configured via `HTTP_PORT` env var, defaults to 3000).

### Slack Channel ID

The Slack channel where Claire should post results. To find this:

**In Slack app:**
1. Right-click the channel name (or click to open channel details)
2. Scroll to the bottom of the details panel
3. Channel ID is shown there (starts with `C`)

**In browser:**
1. The URL looks like `https://app.slack.com/client/T.../C0123456789`
2. The Channel ID is the `C...` part

**Or:** Right-click channel → "Copy link" → paste and extract the `C...` part.

### Thread Timestamp (optional)

If you want results posted to a specific thread instead of creating new messages:
1. Click the three dots on a message → "Copy link"
2. The URL contains the thread timestamp like `p1234567890123456`
3. Convert to format: `1234567890.123456` (add a dot before the last 6 digits)

Leave blank to post to the channel directly.

## Usage

1. Join a Google Meet call
2. Enable captions in Meet (press `Shift+C`)
3. Click the extension icon and toggle "Enable Capture"
4. Speak in the meeting - captions will be sent to Claire for trigger detection

When Claire detects actionable requests (like "let's add a new endpoint"), it will automatically create jobs and post results to the configured Slack channel.

## How It Works

1. Content script monitors Google Meet's caption DOM elements
2. Captions are batched and sent to Claire's `/api/meet/captions` endpoint
3. Claire runs trigger detection (keyword matching + LLM distillation)
4. Actionable tasks are dispatched through the normal job system
5. Results post to your configured Slack channel/thread
