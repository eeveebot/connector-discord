# Eevee.Bot Discord Connector

This is the Discord connector for the Eevee.Bot chatbot platform. It allows Eevee.Bot to connect to Discord servers and interact with users through the Discord API.

## Features

- Connects to Discord using the discord.js library
- Receives messages from Discord channels and forwards them to the Eevee.Bot router via NATS
- Sends messages from the Eevee.Bot router to Discord channels
- Supports multiple Discord bot instances
- Configurable through YAML configuration files
- Automatic reconnection on connection loss
- Hot reloading of configuration files

## Installation

```bash
npm install
```

## Configuration

Create a YAML configuration file with your Discord bot token and settings:

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

## Usage

Set the required environment variables:

```bash
export NATS_HOST="your-nats-host"
export NATS_TOKEN="your-nats-token"
export DISCORD_BOT_TOKEN="your-discord-bot-token"
export MODULE_CONFIG_PATH="/path/to/your/config.yaml"
```

Then run the connector:

```bash
npm run dev
```

## Events

The Discord connector emits the following events that are forwarded through NATS:

- `chat.message.incoming.discord.*` - Incoming messages from Discord channels
- `control.connectors.discord.core.>` - Control messages for the connector
- `stats.uptime` - Uptime statistics requests

## License

MIT
