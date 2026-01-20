---
layout: default
title: Slack Setup
nav_order: 2
---

# Slack App Setup

This guide walks you through creating and configuring a Slack app for Claire. Follow each step carefully to ensure all permissions and event subscriptions are correctly configured.

## Table of Contents

- [Overview](#overview)
- [Step 1: Create Your Slack App](#step-1-create-your-slack-app)
- [Step 2: Enable Socket Mode](#step-2-enable-socket-mode)
- [Step 3: Configure Bot Permissions](#step-3-configure-bot-permissions)
- [Step 4: Enable Event Subscriptions](#step-4-enable-event-subscriptions)
- [Step 5: Install the App](#step-5-install-the-app)
- [Step 6: Collect Your Tokens](#step-6-collect-your-tokens)
- [Step 7: Invite Claire to Channels](#step-7-invite-claire-to-channels)
- [App Manifest (Quick Setup)](#app-manifest-quick-setup)
- [Verifying Your Setup](#verifying-your-setup)
- [Common Issues](#common-issues)

---

## Overview

Claire uses **Slack Socket Mode** which means:
- No public URL or webhook endpoint required
- The app connects outbound to Slack's servers
- Works behind firewalls and in local development
- Requires an **App-Level Token** in addition to the Bot Token

You'll need to create a Slack app with specific permissions to:
- Receive @mentions and respond to messages
- Read channel history and thread context
- Upload files (for images, artifacts, etc.)
- React to messages (for status indicators)

---

## Step 1: Create Your Slack App

### 1.1 Go to Slack API

Navigate to [api.slack.com/apps](https://api.slack.com/apps) and sign in.

### 1.2 Create New App

1. Click **"Create New App"**
2. Choose **"From scratch"** (or use the [manifest](#app-manifest-quick-setup) below for faster setup)
3. Enter app details:
   - **App Name**: `Claire` (or your preferred name)
   - **Workspace**: Select your workspace
4. Click **"Create App"**

You'll be taken to your app's Basic Information page.

---

## Step 2: Enable Socket Mode

Socket Mode allows Claire to receive events without exposing a public endpoint.

### 2.1 Navigate to Socket Mode

1. In your app settings, find **"Socket Mode"** in the left sidebar
2. Toggle **"Enable Socket Mode"** to ON

### 2.2 Generate App-Level Token

When you enable Socket Mode, you'll be prompted to create an App-Level Token:

1. Click **"Generate Token"**
2. Token Name: `claire-socket` (or any descriptive name)
3. Scopes: Select **`connections:write`**
4. Click **"Generate"**

**Save this token!** It starts with `xapp-` and you'll need it as `SLACK_APP_TOKEN`.

> **Important**: App-Level Tokens are different from Bot Tokens. You need both.

---

## Step 3: Configure Bot Permissions

### 3.1 Navigate to OAuth & Permissions

1. In the left sidebar, click **"OAuth & Permissions"**
2. Scroll to **"Scopes"** section

### 3.2 Add Bot Token Scopes

Under **"Bot Token Scopes"**, click **"Add an OAuth Scope"** and add each of the following:

| Scope | Purpose |
|-------|---------|
| `app_mentions:read` | Receive @claire mentions |
| `channels:history` | Read messages in channels Claire is in |
| `channels:read` | Get channel info |
| `chat:write` | Post messages and replies |
| `files:read` | Read files shared in channels |
| `files:write` | Upload generated files/images |
| `reactions:read` | Read emoji reactions |
| `reactions:write` | Add reactions (status indicators) |
| `users:read` | Get user info for context |

Your scopes list should look like this:

```
Bot Token Scopes:
├── app_mentions:read
├── channels:history
├── channels:read
├── chat:write
├── files:read
├── files:write
├── reactions:read
├── reactions:write
└── users:read
```

### 3.3 (Optional) Private Channels & Groups

If you want Claire to work in private channels, also add:

| Scope | Purpose |
|-------|---------|
| `groups:history` | Read messages in private channels |
| `groups:read` | Get private channel info |

### 3.4 (Optional) Direct Messages

If you want Claire to work in DMs:

| Scope | Purpose |
|-------|---------|
| `im:history` | Read direct message history |
| `im:read` | Get DM info |
| `im:write` | Send direct messages |

> **Note**: The current version of Claire is optimized for channel threads. DM support may have limitations.

---

## Step 4: Enable Event Subscriptions

### 4.1 Navigate to Event Subscriptions

1. In the left sidebar, click **"Event Subscriptions"**
2. Toggle **"Enable Events"** to ON

### 4.2 Subscribe to Bot Events

Scroll to **"Subscribe to bot events"** and click **"Add Bot User Event"**:

| Event | Description |
|-------|-------------|
| `app_mention` | When someone @mentions Claire |
| `message.channels` | Messages in public channels |

Your events should look like:

```
Subscribe to bot events:
├── app_mention
└── message.channels
```

### 4.3 (Optional) Additional Events

For private channels and DMs, also add:

| Event | Description |
|-------|-------------|
| `message.groups` | Messages in private channels |
| `message.im` | Direct messages |

### 4.4 Save Changes

Click **"Save Changes"** at the bottom of the page.

---

## Step 5: Install the App

### 5.1 Install to Workspace

1. Go back to **"OAuth & Permissions"**
2. At the top, click **"Install to Workspace"** (or "Reinstall to Workspace" if you've made changes)
3. Review the permissions and click **"Allow"**

### 5.2 Copy Bot Token

After installation, you'll see your **Bot User OAuth Token** at the top of the OAuth & Permissions page.

**Save this token!** It starts with `xoxb-` and you'll need it as `SLACK_BOT_TOKEN`.

---

## Step 6: Collect Your Tokens

You should now have the following tokens. Add them to your `.env` file:

```bash
# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
SLACK_APP_TOKEN=xapp-your-app-token-here
```

### Where to find each token:

| Token | Location | Prefix |
|-------|----------|--------|
| Bot Token | OAuth & Permissions → Bot User OAuth Token | `xoxb-` |
| App Token | Basic Information → App-Level Tokens | `xapp-` |

### Optional: Signing Secret

While not required for Socket Mode, you may want the signing secret for verification:

```bash
SLACK_SIGNING_SECRET=your-signing-secret
```

Find it at: **Basic Information → App Credentials → Signing Secret**

---

## Step 7: Invite Claire to Channels

Claire can only see messages in channels where it has been added.

### Invite via Slack

In any channel where you want to use Claire:

1. Type `/invite @Claire` (or whatever you named your bot)
2. Or click the channel name → "Integrations" → "Add apps" → select Claire

### Verify Access

After inviting, you should see a message like:
> "Claire was added to #channel-name by @you"

---

## App Manifest (Quick Setup)

For faster setup, you can use an App Manifest. This configures everything automatically.

### Using the Manifest

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **"Create New App"**
3. Choose **"From an app manifest"**
4. Select your workspace
5. Paste the YAML below and click **"Create"**

### Manifest (YAML)

```yaml
display_information:
  name: Claire
  description: Slack-native AI code assistant
  background_color: "#2c2d30"

features:
  app_home:
    home_tab_enabled: false
    messages_tab_enabled: true
    messages_tab_read_only_enabled: false
  bot_user:
    display_name: Claire
    always_online: true

oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - channels:history
      - channels:read
      - chat:write
      - files:read
      - files:write
      - reactions:read
      - reactions:write
      - users:read

settings:
  event_subscriptions:
    bot_events:
      - app_mention
      - message.channels
  interactivity:
    is_enabled: false
  org_deploy_enabled: false
  socket_mode_enabled: true
  token_rotation_enabled: false
```

### After Using Manifest

You still need to:
1. Generate an App-Level Token (Step 2.2)
2. Install to workspace (Step 5)
3. Copy your tokens (Step 6)

---

## Verifying Your Setup

### Test Connection

1. Start Claire:
   ```bash
   bun run dev
   ```

2. Look for successful connection logs:
   ```
   [INFO] Slack Bolt app started in socket mode
   [INFO] Connected to Slack
   ```

3. In Slack, go to a channel where Claire is invited
4. Type: `@Claire hello`
5. You should see:
   - An 👀 (eyes) emoji reaction immediately
   - A response from Claire shortly after

### Check App Status

You can also verify your app's connection status at:
**api.slack.com/apps → Your App → Socket Mode**

It should show "Connected" when Claire is running.

---

## Common Issues

### "missing_scope" Error

**Problem**: You see an error about missing permissions.

**Solution**:
1. Go to OAuth & Permissions
2. Add the missing scope
3. Reinstall the app to your workspace

### "invalid_auth" Error

**Problem**: Authentication fails.

**Solution**:
- Verify `SLACK_BOT_TOKEN` starts with `xoxb-`
- Verify `SLACK_APP_TOKEN` starts with `xapp-`
- Check for extra spaces or newlines in your `.env` file
- Try regenerating the tokens

### Claire Doesn't Respond

**Problem**: You @mention Claire but nothing happens.

**Solutions**:
1. **Check Claire is invited** to the channel
2. **Verify Socket Mode** is enabled
3. **Check `app_mention` event** is subscribed
4. **Check logs** for any errors
5. **Verify app is running** - check `bun run dev` output

### "channel_not_found" Error

**Problem**: Claire can't post to a channel.

**Solution**: Invite Claire to that channel with `/invite @Claire`

### Events Not Received

**Problem**: Socket Mode connected but no events.

**Solutions**:
1. Verify **Event Subscriptions** are enabled
2. Check all required events are subscribed
3. Reinstall the app after adding new event subscriptions
4. Make sure Claire is invited to channels you're testing in

### Rate Limits

**Problem**: Getting rate limit errors.

**Solution**:
- Slack has rate limits on API calls
- Claire implements backoff automatically
- For high-volume workspaces, consider the Slack Enterprise plan

---

## Security Best Practices

1. **Never share tokens publicly** - Don't commit `.env` files to git
2. **Use environment variables** or secrets management in production
3. **Rotate tokens periodically** - Regenerate if compromised
4. **Limit channel access** - Only invite Claire to necessary channels
5. **Review OAuth scopes** - Only grant required permissions

---

## Next Steps

Once your Slack app is configured:

1. [Configure other environment variables](./CONFIGURATION.md)
2. [Deploy to the cloud](./DEPLOYMENT.md)
3. [Read usage documentation](../README.md#usage)

---

## Getting Help

If you're still having issues:

1. Check [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
2. Review Slack's [Socket Mode documentation](https://api.slack.com/apis/connections/socket)
3. Open an issue on GitHub with your error logs (redact tokens!)
