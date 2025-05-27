import { createClient, RedisClientType } from 'redis';
import { config } from './env';

class RedisClient {
  private static instance: RedisClient;
  private client: RedisClientType;
  private subscriber: RedisClientType;
  private publisher: RedisClientType;

  private constructor() {
    // Main Redis client
    this.client = createClient({
      url: config.REDIS_URL,
      socket: {
        reconnectStrategy: (retries: number) => {
          if (retries > 10) {
            console.error('❌ Redis max retry attempts reached');
            return new Error('Max retry attempts reached');
          }
          // Exponential backoff: min(retries * 100, 3000)ms
          return Math.min(retries * 100, 3000);
        },
        connectTimeout: 10000,
      },
    });

    // Subscriber client for pub/sub
    this.subscriber = this.client.duplicate();
    
    // Publisher client for pub/sub
    this.publisher = this.client.duplicate();

    this.setupEventListeners();
  }

  public static getInstance(): RedisClient {
    if (!RedisClient.instance) {
      RedisClient.instance = new RedisClient();
    }
    return RedisClient.instance;
  }

  private setupEventListeners(): void {
    // Main client events
    this.client.on('connect', () => {
      console.log('🔗 Redis client connecting...');
    });

    this.client.on('ready', () => {
      console.log('✅ Redis client ready');
    });

    this.client.on('error', (error) => {
      console.error('❌ Redis client error:', error);
    });

    this.client.on('end', () => {
      console.log('⚠️ Redis client connection ended');
    });

    this.client.on('reconnecting', () => {
      console.log('🔄 Redis client reconnecting...');
    });

    // Subscriber events
    this.subscriber.on('error', (error) => {
      console.error('❌ Redis subscriber error:', error);
    });

    // Publisher events
    this.publisher.on('error', (error) => {
      console.error('❌ Redis publisher error:', error);
    });
  }

  public async connect(): Promise<void> {
    try {
      await Promise.all([
        this.client.connect(),
        this.subscriber.connect(),
        this.publisher.connect()
      ]);

      console.log('✅ Redis clients connected successfully');

      // Graceful shutdown
      process.on('SIGINT', async () => {
        await this.disconnect();
        process.exit(0);
      });

      process.on('SIGTERM', async () => {
        await this.disconnect();
        process.exit(0);
      });

    } catch (error) {
      console.error('❌ Failed to connect to Redis:', error);
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    try {
      await Promise.all([
        this.client.quit(),
        this.subscriber.quit(),
        this.publisher.quit()
      ]);
      console.log('✅ Redis clients disconnected successfully');
    } catch (error) {
      console.error('❌ Error disconnecting Redis clients:', error);
    }
  }

  // Cache operations
  public async set(key: string, value: string | object, ttl?: number): Promise<void> {
    try {
      const serializedValue = typeof value === 'object' ? JSON.stringify(value) : value;
      
      if (ttl) {
        await this.client.setEx(key, ttl, serializedValue);
      } else {
        await this.client.set(key, serializedValue);
      }
    } catch (error) {
      console.error(`❌ Redis SET error for key ${key}:`, error);
      throw error;
    }
  }

  public async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (error) {
      console.error(`❌ Redis GET error for key ${key}:`, error);
      return null;
    }
  }

  public async getObject<T>(key: string): Promise<T | null> {
    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error(`❌ Redis GET OBJECT error for key ${key}:`, error);
      return null;
    }
  }

  public async delete(key: string): Promise<number> {
    try {
      return await this.client.del(key);
    } catch (error) {
      console.error(`❌ Redis DELETE error for key ${key}:`, error);
      return 0;
    }
  }

  public async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      console.error(`❌ Redis EXISTS error for key ${key}:`, error);
      return false;
    }
  }

  public async expire(key: string, seconds: number): Promise<boolean> {
    try {
      const result = await this.client.expire(key, seconds);
      return result === 1;
    } catch (error) {
      console.error(`❌ Redis EXPIRE error for key ${key}:`, error);
      return false;
    }
  }

  public async flush(): Promise<void> {
    try {
      await this.client.flushAll();
      console.log('✅ Redis cache flushed');
    } catch (error) {
      console.error('❌ Redis FLUSH error:', error);
    }
  }

  // Pattern-based operations
  public async deletePattern(pattern: string): Promise<number> {
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        return await this.client.del(keys);
      }
      return 0;
    } catch (error) {
      console.error(`❌ Redis DELETE PATTERN error for pattern ${pattern}:`, error);
      return 0;
    }
  }

  // Hash operations for complex data
  public async hSet(key: string, field: string, value: string | object): Promise<number> {
    try {
      const serializedValue = typeof value === 'object' ? JSON.stringify(value) : value;
      return await this.client.hSet(key, field, serializedValue);
    } catch (error) {
      console.error(`❌ Redis HSET error for key ${key}, field ${field}:`, error);
      return 0;
    }
  }

  public async hGet(key: string, field: string): Promise<string | null> {
    try {
      const result = await this.client.hGet(key, field);
      return result || null;
    } catch (error) {
      console.error(`❌ Redis HGET error for key ${key}, field ${field}:`, error);
      return null;
    }
  }

  public async hGetAll(key: string): Promise<{ [key: string]: string }> {
    try {
      return await this.client.hGetAll(key);
    } catch (error) {
      console.error(`❌ Redis HGETALL error for key ${key}:`, error);
      return {};
    }
  }

  // List operations for queues
  public async lPush(key: string, values: string[]): Promise<number> {
    try {
      return await this.client.lPush(key, values);
    } catch (error) {
      console.error(`❌ Redis LPUSH error for key ${key}:`, error);
      return 0;
    }
  }

  public async rPop(key: string): Promise<string | null> {
    try {
      return await this.client.rPop(key);
    } catch (error) {
      console.error(`❌ Redis RPOP error for key ${key}:`, error);
      return null;
    }
  }

  // Pub/Sub operations
  public async publish(channel: string, message: string | object): Promise<number> {
    try {
      const serializedMessage = typeof message === 'object' ? JSON.stringify(message) : message;
      return await this.publisher.publish(channel, serializedMessage);
    } catch (error) {
      console.error(`❌ Redis PUBLISH error for channel ${channel}:`, error);
      return 0;
    }
  }

  public async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    try {
      await this.subscriber.subscribe(channel, callback);
    } catch (error) {
      console.error(`❌ Redis SUBSCRIBE error for channel ${channel}:`, error);
    }
  }

  // Health check
  public async healthCheck(): Promise<{ status: string; message: string }> {
    try {
      const pong = await this.client.ping();
      if (pong === 'PONG') {
        return {
          status: 'healthy',
          message: 'Redis is connected and responsive'
        };
      } else {
        return {
          status: 'unhealthy',
          message: 'Redis ping returned unexpected response'
        };
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Redis health check failed: ${error}`
      };
    }
  }

  // Get Redis client for direct operations
  public getClient(): RedisClientType {
    return this.client;
  }
}

export const redisClient = RedisClient.getInstance();