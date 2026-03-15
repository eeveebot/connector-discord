import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import { Client, GatewayIntentBits, Events, Message, Partials, ChannelType, TextChannel } from 'discord.js';
import { log } from '@eeveebot/libeevee';

// Define the message event data structure
interface MessageEventData {
  target: string;
  channel: string;
  channelId: string;
  nick: string;
  user: string;
  userId: string;
  hostname: string;
  message: string;
  rawMessage: Message;
}

interface DiscordClientConfig {
  name: string;
  ident: IdentConfig;
  connection: unknown;
  postConnect: PostConnectAction[];
  connectionOptions: ConnectionOptions;
}

interface ConnectionOptions {
  token: string;
  intents: GatewayIntentBits[];
}

interface PostConnectAction {
  action: string;
  join?: {
    channel: string;
    key?: string;
  }[];
}

interface IdentConfig {
  quitMsg: string;
  [key: string]: unknown;
}

interface Status {
  remoteHost: string;
  channels: string[];
  currentUserId?: string;
  [key: string]: unknown;
}

export class DiscordClient extends EventEmitter {
  name: string = '';
  instanceUUID: string = '';
  instanceIdent: string = '';
  ident: IdentConfig;
  postConnect: PostConnectAction[];

  status: Status = {
    remoteHost: '',
    channels: [],
  };

  connectionOptions: ConnectionOptions;

  channels: Map<string, TextChannel> = new Map();

  discord: Client;

  constructor(config: DiscordClientConfig) {
    super();
    this.name = config.name;
    this.ident = config.ident;
    this.postConnect = config.postConnect;
    this.connectionOptions = config.connectionOptions;
    this.instanceIdent = `${process.env.HOSTNAME}-${config.name}`;
    this.instanceUUID = crypto.randomUUID();
    
    // Initialize Discord client with intents
    this.discord = new Client({
      intents: this.connectionOptions.intents,
      partials: [Partials.Channel, Partials.Message, Partials.User]
    });

    // Set up event handlers
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    // When the client is ready
    this.discord.once(Events.ClientReady, (client) => {
      log.info(`Discord client ready as ${client.user.tag}`, {
        producer: 'discordClient',
        instanceUUID: this.instanceUUID,
      });
      this.updateStatus('currentUserId', client.user.id);
      this.updateStatus('remoteHost', 'discord.com');
      
      // Emit our own connected event
      this.emit('connected', { nick: client.user.username });
    });

    // When we receive a message
    this.discord.on(Events.MessageCreate, (message: Message) => {
      // Ignore messages from bots (including ourselves)
      if (message.author.bot) return;
      
      // Only handle text channels
      if (message.channel.type !== ChannelType.GuildText) return;
      
      // Emit message event
      const eventData: MessageEventData = {
        target: message.channel.name,
        channel: message.channel.name,
        channelId: message.channel.id,
        nick: message.author.username,
        user: message.author.username,
        userId: message.author.id,
        hostname: message.author.id,
        message: message.content,
        rawMessage: message
      };
      this.emit('message', eventData);
    });

    // When we join a guild
    this.discord.on(Events.GuildCreate, (guild) => {
      log.info(`Joined guild ${guild.name}`, {
        producer: 'discordClient',
        instanceUUID: this.instanceUUID,
      });
      this.emit('guildCreate', guild);
    });

    // When we leave a guild
    this.discord.on(Events.GuildDelete, (guild) => {
      log.info(`Left guild ${guild.name}`, {
        producer: 'discordClient',
        instanceUUID: this.instanceUUID,
      });
      this.emit('guildDelete', guild);
    });

    // When a user joins a guild
    this.discord.on(Events.GuildMemberAdd, (member) => {
      this.emit('guildMemberAdd', member);
    });

    // When a user leaves a guild
    this.discord.on(Events.GuildMemberRemove, (member) => {
      this.emit('guildMemberRemove', member);
    });

    // When a user updates their profile
    this.discord.on(Events.UserUpdate, (oldUser, newUser) => {
      this.emit('userUpdate', { oldUser, newUser });
    });

    // When a channel is created
    this.discord.on(Events.ChannelCreate, (channel) => {
      this.emit('channelCreate', channel);
    });

    // When a channel is deleted
    this.discord.on(Events.ChannelDelete, (channel) => {
      this.emit('channelDelete', channel);
    });

    // When a channel is updated
    this.discord.on(Events.ChannelUpdate, (oldChannel, newChannel) => {
      this.emit('channelUpdate', { oldChannel, newChannel });
    });

    // When a message is updated
    this.discord.on(Events.MessageUpdate, (oldMessage, newMessage) => {
      // Ignore updates from bots
      if (newMessage.author?.bot) return;
      
      this.emit('messageUpdate', { oldMessage, newMessage });
    });

    // When a message is deleted
    this.discord.on(Events.MessageDelete, (message) => {
      this.emit('messageDelete', message);
    });

    // When messages are bulk deleted
    this.discord.on(Events.MessageBulkDelete, (messages) => {
      this.emit('messageBulkDelete', messages);
    });

    // Passthrough other events
    this.discord.on(Events.Error, (...args: unknown[]) => {
      this.emit('error', ...args);
    });

    this.discord.on(Events.Warn, (...args: unknown[]) => {
      this.emit('warn', ...args);
    });

    this.discord.on(Events.Debug, (...args: unknown[]) => {
      this.emit('debug', ...args);
    });
  }

  // Connect to Discord
  async connect() {
    log.info(`Disc to Discord`, {
      producer: 'discordClient',
      instanceUUID: this.instanceUUID,
    });

    try {
      await this.discord.login(this.connectionOptions.token);
    } catch (error) {
      log.error('Failed to connect to Discord', {
        producer: 'discordClient',
        instanceUUID: this.instanceUUID,
        error: error,
      });
      throw error;
    }
  }

  // Send a message to a channel
  async say(channelId: string, message: string) {
    try {
      const channel = await this.discord.channels.fetch(channelId);
      if (channel && channel.isTextBased() && 'send' in channel) {
        const result = await (channel as TextChannel).send(message);
        return result;
      } else {
        log.warn(`Channel ${channelId} is not text-based or not found`, {
          producer: 'discordClient',
          instanceUUID: this.instanceUUID,
        });
        return null;
      }
    } catch (error) {
      log.error(`Failed to send message to channel ${channelId}`, {
        producer: 'discordClient',
        instanceUUID: this.instanceUUID,
        error: error,
      });
      return null;
    }
  }

  // Send a direct message to a user
  async dm(userId: string, message: string) {
    try {
      const user = await this.discord.users.fetch(userId);
      if (user) {
        const dmChannel = await user.createDM();
        const result = await dmChannel.send(message);
        return result;
      } else {
        log.warn(`User ${userId} not found`, {
          producer: 'discordClient',
          instanceUUID: this.instanceUUID,
        });
        return null;
      }
    } catch (error) {
      log.error(`Failed to send DM to user ${userId}`, {
        producer: 'discordClient',
        instanceUUID: this.instanceUUID,
        error: error,
      });
      return null;
    }
  }

  // Send a rich embed message to a channel
  async sendEmbed(channelId: string, embed: Record<string, unknown>) {
    try {
      const channel = await this.discord.channels.fetch(channelId);
      if (channel && channel.isTextBased() && 'send' in channel) {
        const result = await (channel as TextChannel).send({ embeds: [embed] });
        return result;
      } else {
        log.warn(`Channel ${channelId} is not text-based or not found`, {
          producer: 'discordClient',
          instanceUUID: this.instanceUUID,
        });
        return null;
      }
    } catch (error) {
      log.error(`Failed to send embed to channel ${channelId}`, {
        producer: 'discordClient',
        instanceUUID: this.instanceUUID,
        error: error,
      });
      return null;
    }
  }

  // Disconnect from Discord
  async quit(msg?: string) {
    log.info(`Disconnecting from Discord: ${msg || this.ident.quitMsg}`, {
      producer: 'discordClient',
      instanceUUID: this.instanceUUID,
    });
    
    try {
      await this.discord.destroy();
    } catch (error) {
      log.error('Error while disconnecting from Discord', {
        producer: 'discordClient',
        instanceUUID: this.instanceUUID,
        error: error,
      });
    }
  }

  // Update status field
  updateStatus(field: string, value: unknown) {
    this.status[field] = value;
  }

  // Join a channel (store reference for later use)
  addChannel(channelId: string, channel: TextChannel) {
    this.channels.set(channelId, channel);
    log.info(`Added channel ${channel.name} (${channelId}) to cache`, {
      producer: 'discordClient',
      instanceUUID: this.instanceUUID,
    });
  }

  // Get a cached channel
  getChannel(channelId: string): TextChannel | undefined {
    return this.channels.get(channelId);
  }
}