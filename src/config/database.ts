import mongoose from 'mongoose';
import { config } from './env';

class Database {
  private static instance: Database;
  private connectionString: string;

  private constructor() {
    this.connectionString = config.MONGODB_URI;
  }

  public static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  public async connect(): Promise<void> {
    try {
      // Mongoose connection options
      const options = {
        autoIndex: true,
        maxPoolSize: 10, // Maintain up to 10 socket connections
        serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
        socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
        bufferMaxEntries: 0, // Disable mongoose buffering
        bufferCommands: false, // Disable mongoose buffering
      };

      // Connect to MongoDB
      await mongoose.connect(this.connectionString, options);

      // Connection event listeners
      mongoose.connection.on('connected', () => {
        console.log('✅ MongoDB connected successfully');
      });

      mongoose.connection.on('error', (error) => {
        console.error('❌ MongoDB connection error:', error);
      });

      mongoose.connection.on('disconnected', () => {
        console.log('⚠️ MongoDB disconnected');
      });

      // Graceful shutdown
      process.on('SIGINT', async () => {
        await this.disconnect();
        process.exit(0);
      });

    } catch (error) {
      console.error('❌ Failed to connect to MongoDB:', error);
      process.exit(1);
    }
  }

  public async disconnect(): Promise<void> {
    try {
      await mongoose.connection.close();
      console.log('✅ MongoDB connection closed');
    } catch (error) {
      console.error('❌ Error closing MongoDB connection:', error);
    }
  }

  public getConnection() {
    return mongoose.connection;
  }

  public async isConnected(): Promise<boolean> {
    return mongoose.connection.readyState === 1;
  }

  // Database health check
  public async healthCheck(): Promise<{ status: string; message: string }> {
    try {
      const state = mongoose.connection.readyState;
      const states = {
        0: 'disconnected',
        1: 'connected',
        2: 'connecting',
        3: 'disconnecting',
      };

      if (state === 1 && mongoose.connection.db) {
        // Test the connection with a simple operation
        await mongoose.connection.db.admin().ping();
        return {
          status: 'healthy',
          message: `MongoDB is ${states[state as keyof typeof states]} and responsive`
        };
      } else {
        return {
          status: 'unhealthy',
          message: `MongoDB is ${states[state as keyof typeof states]}`
        };
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        message: `MongoDB health check failed: ${error}`
      };
    }
  }

  // Create database indexes for better performance
  public async createIndexes(): Promise<void> {
    try {
      // Property indexes
      await mongoose.connection.collection('properties').createIndex({ 
        title: 'text', 
        city: 'text', 
        state: 'text', 
        amenities: 'text' 
      });
      
      await mongoose.connection.collection('properties').createIndex({ price: 1 });
      await mongoose.connection.collection('properties').createIndex({ city: 1, state: 1 });
      await mongoose.connection.collection('properties').createIndex({ type: 1 });
      await mongoose.connection.collection('properties').createIndex({ listingType: 1 });
      await mongoose.connection.collection('properties').createIndex({ createdBy: 1 });
      await mongoose.connection.collection('properties').createIndex({ availableFrom: 1 });
      await mongoose.connection.collection('properties').createIndex({ isVerified: 1 });
      await mongoose.connection.collection('properties').createIndex({ rating: -1 });

      // User indexes
      await mongoose.connection.collection('users').createIndex({ email: 1 }, { unique: true });

      // Favorites indexes
      await mongoose.connection.collection('favorites').createIndex({ userId: 1 });
      await mongoose.connection.collection('favorites').createIndex({ propertyId: 1 });
      await mongoose.connection.collection('favorites').createIndex({ userId: 1, propertyId: 1 }, { unique: true });

      // Recommendations indexes
      await mongoose.connection.collection('recommendations').createIndex({ recipientId: 1 });
      await mongoose.connection.collection('recommendations').createIndex({ senderId: 1 });
      await mongoose.connection.collection('recommendations').createIndex({ status: 1 });

      console.log('✅ Database indexes created successfully');
    } catch (error) {
      console.error('❌ Error creating database indexes:', error);
    }
  }
}

export const database = Database.getInstance();