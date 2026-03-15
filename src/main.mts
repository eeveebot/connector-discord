// nodejs natives
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// 3rd party
import * as yaml from 'js-yaml';
import * as chokidar from 'chokidar';
import { GatewayIntentBits } from 'discord.js';

// 1st party
import { DiscordClient } from './lib/discord-client.mjs';
import { NatsClient, handleSIG, log, eeveeLogo } from '@eeveebot/libeevee';

// Record module startup time for uptime tracking
const moduleStartTime = Date.now();

// Every module has a uuid
const moduleUUID = '56B3C640-CAEC-4A65-B648-AE0D70C7D041'; // Generated UUID for this module

// This is mainly for cosmetics, used in quitmsg by default
const connectorVersion = '1.0.0';

// This is of vital importance.
console.log(eeveeLogo);

log.info(`eevee-discord-connector v${connectorVersion} starting up`, {
  producer: 'core',
});

const discordClients: DiscordClient[] = [];
const natsClients: InstanceType<typeof NatsClient>[] = [];
const natsSubscriptions: string[] = [];

//
// Do whatever teardown is necessary before calling common handler
process.on('SIGINT', async () => {
  discordClients.forEach((discordClient) => {
    void discordClient.quit(`SIGINT received - ${discordClient.ident.quitMsg}`);
  });
  natsClients.forEach((natsClient) => {
    void natsClient.drain();
  });
  // Close the config file watcher
  if (configFileWatcher) {
    await configFileWatcher.close();
  }
  await handleSIG('SIGINT');
});

process.on('SIGTERM', async () => {
  discordClients.forEach((discordClient) => {
    void discordClient.quit(`SIGTERM received - ${discordClient.ident.quitMsg}`);
  });
  natsClients.forEach((natsClient) => {
    void natsClient.drain();
  });
  // Close the config file watcher
  if (configFileWatcher) {
    await configFileWatcher.close();
  }
  await handleSIG('SIGTERM');
});

//
// Setup NATS connection

// Get host and token
const natsHost = process.env.NATS_HOST || false;
if (!natsHost) {
  const msg = 'environment variable NATS_HOST is not set.';
  log.error(msg, { producer: 'natsClient' });
  throw new Error(msg);
}

const natsToken = process.env.NATS_TOKEN || false;
if (!natsToken) {
  const msg = 'environment variable NATS_TOKEN is not set.';
  log.error(msg, { producer: 'natsClient' });
  throw new Error(msg);
}

const nats = new NatsClient({
  natsHost: natsHost as string,
  natsToken: natsToken as string,
});
natsClients.push(nats);
await nats.connect();

void nats
  .subscribe('control.connectors.discord.core.>', (subject, message) => {
    log.info(subject, { producer: 'natsClient', message: message.string() });
  })
  .then((sub) => {
    if (sub && typeof sub === 'string') natsSubscriptions.push(sub);
  });

// Subscribe to stats.uptime messages and respond with module uptime
void nats
  .subscribe('stats.uptime', (subject, message) => {
    try {
      const data = JSON.parse(message.string());
      log.info('Received stats.uptime request', {
        producer: 'connector-discord',
        replyChannel: data.replyChannel,
      });

      // Calculate uptime in milliseconds
      const uptime = Date.now() - moduleStartTime;

      // Send uptime back via the ephemeral reply channel
      const uptimeResponse = {
        module: 'connector-discord',
        uptime: uptime,
        uptimeFormatted: `${Math.floor(uptime / 86400000)}d ${Math.floor((uptime % 86400000) / 3600000)}h ${Math.floor((uptime % 3600000) / 60000)}m ${Math.floor((uptime % 60000) / 1000)}s`,
      };

      if (data.replyChannel) {
        void nats.publish(data.replyChannel, JSON.stringify(uptimeResponse));
      }
    } catch (error) {
      log.error('Failed to process stats.uptime request', {
        producer: 'connector-discord',
        error: error,
      });
    }
  })
  .then((sub) => {
    if (sub && typeof sub === 'string') natsSubscriptions.push(sub);
  });

//
// Setup Discord connections from config file

// Get path to config file from env.MODULE_CONFIG_PATH
const configFilePath = process.env.MODULE_CONFIG_PATH || false;
if (!configFilePath) {
  const msg = 'environment variable MODULE_CONFIG_PATH is not set.';
  log.error(msg, { producer: 'discordClient' });
  throw new Error(msg);
}

interface IdentConfig {
  quitMsg: string;
  [key: string]: unknown;
}

interface PostConnectAction {
  action: string;
  join?: {
    channel: string;
    key?: string;
  }[];
}

interface DiscordConfig {
  intents?: string[];
}

interface ConnectionConfig {
  name: string;
  ident: IdentConfig;
  discord: DiscordConfig;
  postConnect: PostConnectAction[];
}

interface ControlMessageData {
  channelId?: string;
  replyChannel?: string;
  [key: string]: unknown;
}

interface ControlMessage {
  action: string;
  data?: ControlMessageData;
}

// Map string intents to GatewayIntentBits
const intentMap: Record<string, GatewayIntentBits> = {
  'GUILDS': GatewayIntentBits.Guilds,
  'GUILD_MESSAGES': GatewayIntentBits.GuildMessages,
  'GUILD_MESSAGE_REACTIONS': GatewayIntentBits.GuildMessageReactions,
  'DIRECT_MESSAGES': GatewayIntentBits.DirectMessages,
  'MESSAGE_CONTENT': GatewayIntentBits.MessageContent,
};

// Function to reload configuration and recreate Discord clients
async function reloadConfiguration() {
  log.info('Reloading configuration...', { producer: 'core' });
  
  try {
    // Disconnect all existing clients
    for (const client of discordClients) {
      await client.quit('Configuration reload - reconnecting...');
    }
    
    // Clear the discordClients array
    discordClients.length = 0;
    
    // Clear NATS subscriptions (just clear the array, don't unsubscribe)
    natsSubscriptions.splice(0, natsSubscriptions.length);
    
    // Re-read the configuration file
    const configFileContent = fs.readFileSync(
      path.resolve(configFilePath as string),
      'utf8'
    );
    const newConnectionsConfig = yaml.load(configFileContent);
    
    log.info(`config reloaded from ${configFilePath}`, {
      producer: 'discordClient',
    });
    
    // Create new clients based on the reloaded configuration
    (newConnectionsConfig as { connections: ConnectionConfig[] }).connections.forEach((conn: ConnectionConfig) => {
      log.info(`setting up discord connection for ${conn.name}`, {
        producer: 'discordClient',
      });
      
      // Convert string intents to GatewayIntentBits
      const intents = conn.discord.intents?.map(intent => intentMap[intent]) || [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ];
      
      // Get Discord bot token from environment variable
      const discordToken = process.env.DISCORD_BOT_TOKEN || false;
      if (!discordToken) {
        const msg = `environment variable DISCORD_BOT_TOKEN is not set for connection ${conn.name}.`;
        log.error(msg, { producer: 'discordClient' });
        throw new Error(msg);
      }
      
      const client = new DiscordClient({
        name: conn.name,
        ident: conn.ident,
        connection: conn.discord,
        postConnect: conn.postConnect,
        connectionOptions: {
          token: discordToken,
          intents: intents,
        },
      });
      
      discordClients.push(client);
      
      // Connect the client
      client.connect().catch(error => {
        log.error(`Failed to connect Discord client ${conn.name}`, {
          producer: 'discordClient',
          error: error,
        });
      });
      
      // Subscribe to control messages for this client
      void nats
        .subscribe(
          `control.chatConnectors.discord.${client.name}`,
          (subject, message) => {
            try {
              const controlMessage: ControlMessage = JSON.parse(message.string());
              log.info('Control message received', {
                producer: 'discordClient',
                subject: subject,
                action: controlMessage.action,
                data: controlMessage.data,
              });
              
              switch (controlMessage.action) {
                case 'send-message':
                  if (controlMessage.data && controlMessage.data.channelId) {
                    // We would need the actual message text from the control message
                    // This is just a placeholder implementation
                    log.warn('Send message control action not fully implemented', {
                      producer: 'discordClient',
                    });
                  }
                  break;
                default:
                  log.warn('Unknown control action', {
                    producer: 'discordClient',
                    action: controlMessage.action,
                  });
              }
            } catch (error) {
              log.error('Error processing control message', {
                producer: 'discordClient',
                error: error,
              });
            }
          }
        )
        .then((sub) => {
          if (sub && typeof sub === 'string') natsSubscriptions.push(sub);
        });
      
      // Set up message event handler
      client.on('message', (data: { channel: string; channelId: string; user: string; userId: string; hostname: string; message: string; [key: string]: unknown }) => {
        const message = {
          producer: 'discordClient',
          subject: `chat.message.incoming.discord.${client.name}.${data.channel}.${data.user}`,
          moduleUUID: moduleUUID,
          type: 'chat.message.incoming',
          trace: crypto.randomUUID(),
          platform: 'discord',
          instance: client.name,
          network: 'discord.com',
          channel: data.channel,
          channelId: data.channelId,
          user: data.user,
          userId: data.userId,
          userHost: data.hostname,
          text: data.message,
          botNick: data.user,
          rawEvent: data,
        };
        
        void nats.publish(
          `chat.message.incoming.discord.${client.name}.${data.channel}.${data.user}`,
          JSON.stringify(message)
        );
        
        log.info(`message received`, message);
      });
      
      // Set up outgoing message handlers
      client.on('connected', () => {
        // Subscribe to outgoing messages for this client
        void nats
          .subscribe(
            `chat.message.outgoing.discord.${client.name}.>`,
            (subject, ipcMessage) => {
              const outgoingMessage = JSON.parse(ipcMessage.string());
              log.info('Outgoing message', {
                producer: 'discordClient',
                subject: subject,
                channelId: outgoingMessage.channelId,
                text: outgoingMessage.text,
              });
              
              if (outgoingMessage.channelId) {
                void client.say(outgoingMessage.channelId, outgoingMessage.text);
              }
            }
          )
          .then((sub) => {
            if (sub && typeof sub === 'string') natsSubscriptions.push(sub);
          });
      });
    });
  } catch (error) {
    log.error('Error reloading configuration', {
      producer: 'core',
      error: error,
    });
  }
}

// Watch the config file for changes and reload when it changes
const configFileWatcher = chokidar.watch(configFilePath as string, {
  persistent: true,
  ignoreInitial: false, // Trigger on initial add for initial setup
  awaitWriteFinish: {
    stabilityThreshold: 2000,
    pollInterval: 100,
  },
});

configFileWatcher.on('add', async (path: string) => {
  log.info(`Config file added: ${path}`, { producer: 'core' });
  await reloadConfiguration();
});

configFileWatcher.on('change', async (path: string) => {
  log.info(`Config file changed: ${path}`, { producer: 'core' });
  await reloadConfiguration();
});

log.info(`Watching config file for changes: ${configFilePath}`, {
  producer: 'core',
});