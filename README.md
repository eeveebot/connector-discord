# connector-discord

> Discord connector for the eevee chatbot platform.

## Overview

**connector-discord** bridges eevee.bot to Discord, enabling the platform to receive messages from Discord channels and send messages back through the Discord API. It connects to Discord using the [discord.js](https://discord.js.org/) library and communicates with the rest of the eevee ecosystem via NATS messaging.

Each configured Discord bot instance runs as a separate `DiscordClient` within the connector. Incoming Discord messages are published to NATS subjects (e.g. `chat.message.incoming.discord.<instance>.<channel>.<user>`) for the router and other modules to consume. Outgoing messages are received on `chat.message.outgoing.discord.<instance>.>` NATS subjects and delivered to the target Discord channel.

Configuration is loaded from a YAML file and watched for changes — when the file is modified, the connector automatically reloads, disconnecting and reconnecting all Discord clients with the new settings.

## Features

- Connects to Discord using the discord.js library
- Receives messages from Discord channels and forwards them to the eevee.bot router via NATS
- Sends messages from the eevee.bot router to Discord channels
- Supports multiple Discord bot instances from a single connector
- Configurable through YAML configuration files
- Automatic reconnection on connection loss
- Hot reloading of configuration files (via `chokidar` file watcher)
- Uptime statistics reporting via NATS `stats.uptime` subject
- Rich embed and direct message support
- Graceful shutdown on `SIGINT` / `SIGTERM`

## Install

```bash
npm install @eeveebot/connector-discord
```

Or, within the eevee workspace:

```bash
npm install
```

## Configuration

The connector reads its connection definitions from a YAML file whose path is specified by the `MODULE_CONFIG_PATH` environment variable.

```yaml
connections:
  - name: "my-discord-bot"
    ident:
      quitMsg: "eevee.bot shutting down"
    discord:
      token: "YOUR_BOT_TOKEN_HERE"
      intents:
        - "GUILDS"
        - "GUILD_MESSAGES"
        - "MESSAGE_CONTENT"
    postConnect: []
```

### Discord Intents

Intent strings in the config are mapped to `GatewayIntentBits` values:

| Config string       | GatewayIntentBits            |
| ------------------- | ---------------------------- |
| `GUILDS`            | `GatewayIntentBits.Guilds`   |
| `GUILD_MESSAGES`    | `GatewayIntentBits.GuildMessages`   |
| `GUILD_MESSAGE_REACTIONS` | `GatewayIntentBits.GuildMessageReactions` |
| `DIRECT_MESSAGES`   | `GatewayIntentBits.DirectMessages` |
| `MESSAGE_CONTENT`   | `GatewayIntentBits.MessageContent`  |

If no intents are specified, the defaults are `GUILDS`, `GUILD_MESSAGES`, and `MESSAGE_CONTENT`.

### Environment Variables

| Variable              | Required | Description                                |
| --------------------- | -------- | ------------------------------------------ |
| `NATS_HOST`           | Yes      | Hostname or address of the NATS server     |
| `NATS_TOKEN`          | Yes      | Authentication token for the NATS server   |
| `DISCORD_BOT_TOKEN`   | Yes      | Discord bot token (applies to all instances) |
| `MODULE_CONFIG_PATH`  | Yes      | Absolute path to the YAML configuration file |

## Usage / Commands

Set the required environment variables and run the connector:

```bash
export NATS_HOST="your-nats-host"
export NATS_TOKEN="your-nats-token"
export DISCORD_BOT_TOKEN="your-discord-bot-token"
export MODULE_CONFIG_PATH="/path/to/your/config.yaml"

npm run dev
```

The connector will read the config file, connect to both NATS and Discord, and begin forwarding messages. When the config file is modified on disk, the connector automatically reloads.

## Events

The connector publishes and subscribes to the following NATS subjects:

### Incoming

| Subject Pattern                                        | Description                          |
| ------------------------------------------------------ | ------------------------------------ |
| `chat.message.incoming.discord.<instance>.<channel>.<user>` | Incoming message from a Discord channel |
| `stats.uptime`                                         | Uptime request — connector responds with its uptime |

### Outgoing

| Subject Pattern                                    | Description                              |
| -------------------------------------------------- | ---------------------------------------- |
| `chat.message.outgoing.discord.<instance>.>`       | Send a message to a Discord channel (requires `channelId` and `text` fields) |

### Control

| Subject Pattern                                  | Description                          |
| ------------------------------------------------ | ------------------------------------ |
| `control.connectors.discord.core.>`              | General control messages for the connector |
| `control.chatConnectors.discord.<instance>`      | Per-instance control messages (e.g. `send-message`) |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  connector-discord                   │
│                                                      │
│  ┌──────────────┐        ┌────────────────────────┐ │
│  │  main.mts    │───┐    │  discord-client.mts     │ │
│  │              │   │    │                         │ │
│  │ • Config     │   └──▶│  DiscordClient           │ │
│  │   loading    │        │  ├─ connect()            │ │
│  │ • NATS setup │        │  ├─ say(channelId, msg) │ │
│  │ • File watch │        │  ├─ dm(userId, msg)     │ │
│  │ • SIG handler│        │  ├─ sendEmbed(ch, emb)  │ │
│  └──────────────┘        │  └─ quit(msg)           │ │
│         │                └────────┬────────────────┘ │
│         │                         │                  │
└─────────┼─────────────────────────┼──────────────────┘
          │                         │
          ▼                         ▼
      ┌───────┐              ┌──────────┐
      │ NATS  │              │ Discord  │
      │       │              │ Gateway  │
      └───────┘              └──────────┘
```

**Key components:**

- **`main.mts`** — Entry point. Loads YAML config, establishes the NATS connection, creates `DiscordClient` instances, subscribes to outgoing message subjects, and watches the config file for hot reloads.
- **`DiscordClient`** (`lib/discord-client.mts`) — Wraps the discord.js `Client`. Emits `message` and `connected` events. Provides `say()`, `dm()`, `sendEmbed()`, and `quit()` methods. Handles all Discord gateway events and filters out bot messages.

**Message flow:**

1. Discord user sends a message → `DiscordClient` emits `message` event → `main.mts` publishes to `chat.message.incoming.discord.*` NATS subject.
2. Another module publishes to `chat.message.outgoing.discord.<instance>.>` → `main.mts` receives it → calls `DiscordClient.say(channelId, text)` → message appears in Discord.

## Development

```bash
# Clone the repo and navigate to the connector
git clone https://github.com/eeveebot/eevee.git
cd eevee/connector-discord

# Install dependencies
npm install

# Lint
npm test

# Build and run locally
npm run dev
```

### Scripts

| Script            | Description                             |
| ----------------- | --------------------------------------- |
| `npm test`        | Lint the source with ESLint             |
| `npm run build`   | Lint + compile TypeScript to `dist/`    |
| `npm run dev`     | Build and run the connector locally     |

## Contributing

Contributions are welcome! Please see the [eevee contributing guide](https://github.com/eeveebot/eevee) for details.

## License

[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) — see [LICENSE](./LICENSE) for the full text.
