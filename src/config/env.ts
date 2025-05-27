import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface Config {
  // Server Configuration
  NODE_ENV: string;
  PORT: number;
  API_VERSION: string;

  // Database Configuration
  MONGODB_URI: string;
  MONGODB_DB_NAME: string;

  // Redis Configuration
  REDIS_URL: string;
  REDIS_PASSWORD?: string;
  REDIS_HOST: string;
  REDIS_PORT: number;

  // JWT Configuration
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  JWT_REFRESH_SECRET: string;
  JWT_REFRESH_EXPIRES_IN: string;

  // Email Configuration (for future use)
  EMAIL_HOST?: string;
  EMAIL_PORT?: number;
  EMAIL_USER?: string;
  EMAIL_PASS?: string;
  EMAIL_FROM?: string;

  // Rate Limiting
  RATE_LIMIT_MAX_REQUESTS: number;
  RATE_LIMIT_WINDOW_MS: number;

  // Cache Configuration
  CACHE_TTL_SHORT: number;   // 5 minutes
  CACHE_TTL_MEDIUM: number;  // 30 minutes
  CACHE_TTL_LONG: number;    // 24 hours

  // File Upload Configuration
  MAX_FILE_SIZE: number;
  ALLOWED_FILE_TYPES: string[];

  // Pagination Configuration
  DEFAULT_PAGE_SIZE: number;
  MAX_PAGE_SIZE: number;

  // Security Configuration
  BCRYPT_ROUNDS: number;
  CORS_ORIGIN: string | string[];

  // External API Keys (for future integrations)
  GOOGLE_MAPS_API_KEY?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_REGION?: string;
  AWS_S3_BUCKET?: string;
}

// Validation functions
function validateRequired(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`❌ Environment variable ${name} is required but not set`);
  }
  return value;
}

function validateNumber(value: string | undefined, name: string, defaultValue?: number): number {
  if (!value) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`❌ Environment variable ${name} is required but not set`);
  }
  
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`❌ Environment variable ${name} must be a valid number`);
  }
  return parsed;
}

function validateEnum(value: string | undefined, name: string, allowedValues: string[], defaultValue?: string): string {
  if (!value) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`❌ Environment variable ${name} is required but not set`);
  }
  
  if (!allowedValues.includes(value)) {
    throw new Error(`❌ Environment variable ${name} must be one of: ${allowedValues.join(', ')}`);
  }
  return value;
}

function validateArray(value: string | undefined, name: string, defaultValue?: string[]): string[] {
  if (!value) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`❌ Environment variable ${name} is required but not set`);
  }
  return value.split(',').map(item => item.trim());
}

function validateCorsOrigin(value: string | undefined): string | string[] {
  if (!value) {
    return '*'; // Default to allow all origins in development
  }
  
  if (value === '*') {
    return '*';
  }
  
  // If multiple origins, split by comma
  if (value.includes(',')) {
    return value.split(',').map(origin => origin.trim());
  }
  
  return value;
}

// Create and validate configuration
function createConfig(): Config {
  try {
    return {
      // Server Configuration
      NODE_ENV: validateEnum(
        process.env.NODE_ENV, 
        'NODE_ENV', 
        ['development', 'production', 'test'], 
        'development'
      ),
      PORT: validateNumber(process.env.PORT, 'PORT', 3000),
      API_VERSION: process.env.API_VERSION || 'v1',

      // Database Configuration
      MONGODB_URI: validateRequired(process.env.MONGODB_URI, 'MONGODB_URI'),
      MONGODB_DB_NAME: process.env.MONGODB_DB_NAME || 'property_listings',

      // Redis Configuration
      REDIS_URL: validateRequired(process.env.REDIS_URL, 'REDIS_URL'),
      REDIS_PASSWORD: process.env.REDIS_PASSWORD,
      REDIS_HOST: process.env.REDIS_HOST || 'localhost',
      REDIS_PORT: validateNumber(process.env.REDIS_PORT, 'REDIS_PORT', 6379),

      // JWT Configuration
      JWT_SECRET: validateRequired(process.env.JWT_SECRET, 'JWT_SECRET'),
      JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',
      JWT_REFRESH_SECRET: validateRequired(process.env.JWT_REFRESH_SECRET, 'JWT_REFRESH_SECRET'),
      JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',

      // Email Configuration (optional)
      EMAIL_HOST: process.env.EMAIL_HOST,
      EMAIL_PORT: process.env.EMAIL_PORT ? parseInt(process.env.EMAIL_PORT, 10) : undefined,
      EMAIL_USER: process.env.EMAIL_USER,
      EMAIL_PASS: process.env.EMAIL_PASS,
      EMAIL_FROM: process.env.EMAIL_FROM,

      // Rate Limiting
      RATE_LIMIT_MAX_REQUESTS: validateNumber(process.env.RATE_LIMIT_MAX_REQUESTS, 'RATE_LIMIT_MAX_REQUESTS', 100),
      RATE_LIMIT_WINDOW_MS: validateNumber(process.env.RATE_LIMIT_WINDOW_MS, 'RATE_LIMIT_WINDOW_MS', 900000), // 15 minutes

      // Cache Configuration (in seconds)
      CACHE_TTL_SHORT: validateNumber(process.env.CACHE_TTL_SHORT, 'CACHE_TTL_SHORT', 300),     // 5 minutes
      CACHE_TTL_MEDIUM: validateNumber(process.env.CACHE_TTL_MEDIUM, 'CACHE_TTL_MEDIUM', 1800), // 30 minutes
      CACHE_TTL_LONG: validateNumber(process.env.CACHE_TTL_LONG, 'CACHE_TTL_LONG', 86400),      // 24 hours

      // File Upload Configuration
      MAX_FILE_SIZE: validateNumber(process.env.MAX_FILE_SIZE, 'MAX_FILE_SIZE', 5242880), // 5MB
      ALLOWED_FILE_TYPES: validateArray(
        process.env.ALLOWED_FILE_TYPES, 
        'ALLOWED_FILE_TYPES', 
        ['image/jpeg', 'image/png', 'image/webp']
      ),

      // Pagination Configuration
      DEFAULT_PAGE_SIZE: validateNumber(process.env.DEFAULT_PAGE_SIZE, 'DEFAULT_PAGE_SIZE', 20),
      MAX_PAGE_SIZE: validateNumber(process.env.MAX_PAGE_SIZE, 'MAX_PAGE_SIZE', 100),

      // Security Configuration
      BCRYPT_ROUNDS: validateNumber(process.env.BCRYPT_ROUNDS, 'BCRYPT_ROUNDS', 12),
      CORS_ORIGIN: validateCorsOrigin(process.env.CORS_ORIGIN),

      // External API Keys (optional)
      GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
      AWS_REGION: process.env.AWS_REGION,
      AWS_S3_BUCKET: process.env.AWS_S3_BUCKET,
    };
  } catch (error) {
    console.error('❌ Configuration validation failed:', error);
    process.exit(1);
  }
}

// Export the validated configuration
export const config = createConfig();

// Environment-specific configurations
export const isDevelopment = config.NODE_ENV === 'development';
export const isProduction = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';

// Cache key prefixes for better organization
export const CACHE_KEYS = {
  PROPERTIES: 'properties',
  PROPERTY_DETAIL: 'property_detail',
  USER_FAVORITES: 'user_favorites',
  SEARCH_RESULTS: 'search_results',
  USER_SESSION: 'user_session',
  PROPERTY_STATS: 'property_stats',
  POPULAR_PROPERTIES: 'popular_properties',
  RECOMMENDATIONS: 'recommendations',
} as const;

// Database collection names
export const COLLECTIONS = {
  USERS: 'users',
  PROPERTIES: 'properties',
  FAVORITES: 'favorites',
  RECOMMENDATIONS: 'recommendations',
} as const;

// API response messages
export const MESSAGES = {
  SUCCESS: {
    CREATED: 'Resource created successfully',
    UPDATED: 'Resource updated successfully',
    DELETED: 'Resource deleted successfully',
    RETRIEVED: 'Resource retrieved successfully',
  },
  ERROR: {
    NOT_FOUND: 'Resource not found',
    UNAUTHORIZED: 'Unauthorized access',
    FORBIDDEN: 'Access forbidden',
    VALIDATION_FAILED: 'Validation failed',
    INTERNAL_ERROR: 'Internal server error',
    RATE_LIMIT_EXCEEDED: 'Rate limit exceeded',
  },
} as const;

// Log configuration status
console.log(`📋 Configuration loaded for ${config.NODE_ENV} environment`);
console.log(`🚀 Server will run on port ${config.PORT}`);
console.log(`💾 Database: ${config.MONGODB_DB_NAME}`);
console.log(`⚡ Redis: ${config.REDIS_HOST}:${config.REDIS_PORT}`);
console.log(`🔐 JWT expires in: ${config.JWT_EXPIRES_IN}`);
console.log(`📄 Default page size: ${config.DEFAULT_PAGE_SIZE}`);