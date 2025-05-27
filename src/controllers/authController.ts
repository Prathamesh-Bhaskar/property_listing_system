import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User, IUser } from '../models/User';
import { config } from '../config/env';
import { redisClient } from '../config/redis';
import { CACHE_KEYS } from '../config/env';

// Extend Request interface to include user
declare global {
  namespace Express {
    interface Request {
      user?: IUser;
    }
  }
}

// Interface for JWT payload
interface JWTPayload {
  userId: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

// Helper function to generate JWT tokens
const generateTokens = (user: IUser) => {
  const payload: JWTPayload = {
    userId: user._id.toString(),
    email: user.email,
    role: user.role
  };

  const secret: jwt.Secret = config.JWT_SECRET;

  const accessToken = jwt.sign(
    payload,
    secret,
    { expiresIn: String(config.JWT_EXPIRES_IN) }
  );

  const refreshToken = jwt.sign(
    payload,
    String(config.JWT_REFRESH_SECRET),
    { expiresIn: String(config.JWT_REFRESH_EXPIRES_IN) }
  );

  return { accessToken, refreshToken };
};

// Helper function to cache user session
const cacheUserSession = async (userId: string, tokenData: any) => {
  const cacheKey = `${CACHE_KEYS.USER_SESSION}:${userId}`;
  await redisClient.set(cacheKey, JSON.stringify(tokenData), config.CACHE_TTL_MEDIUM);
};

// Helper function to clear user session
const clearUserSession = async (userId: string) => {
  const cacheKey = `${CACHE_KEYS.USER_SESSION}:${userId}`;
  await redisClient.delete(cacheKey);
};

export class AuthController {

  // Register new user
  static async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password, firstName, lastName, phone } = req.body;

      // Check if user already exists
      const existingUser = await User.findOne({ email: email.toLowerCase() });
      if (existingUser) {
        res.status(409).json({
          success: false,
          message: 'User already exists with this email',
          error: 'EMAIL_ALREADY_EXISTS'
        });
        return;
      }

      // Create new user
      const newUser = new User({
        email: email.toLowerCase().trim(),
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone?.trim()
      });

      // Generate email verification token
      const verificationToken = newUser.generateEmailVerificationToken();

      // Save user
      await newUser.save();

      // Generate JWT tokens
      const { accessToken, refreshToken } = generateTokens(newUser);

      // Cache user session
      await cacheUserSession(newUser._id.toString(), {
        accessToken,
        refreshToken,
        user: newUser.toJSON()
      });

      // Update last login
      newUser.lastLoginAt = new Date();
      await newUser.save({ validateBeforeSave: false });

      // Send verification email (in production, you'd integrate with email service)
      // await emailService.sendVerificationEmail(newUser.email, verificationToken);

      res.status(201).json({
        success: true,
        message: 'User registered successfully. Please verify your email.',
        data: {
          user: newUser.toJSON(),
          tokens: {
            accessToken,
            refreshToken
          },
          verificationRequired: true
        }
      });

    } catch (error: any) {
      console.error('Registration error:', error);

      // Handle mongoose validation errors
      if (error.name === 'ValidationError') {
        const validationErrors = Object.values(error.errors).map((err: any) => err.message);
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: validationErrors
        });
        return;
      }

      res.status(500).json({
        success: false,
        message: 'Registration failed',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  // Login user
  static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password, rememberMe = false } = req.body;

      // Find user with password field
      const user = await User.findOne({ email: email.toLowerCase() })
        .select('+password')
        .exec();

      if (!user) {
        res.status(401).json({
          success: false,
          message: 'Invalid credentials',
          error: 'INVALID_CREDENTIALS'
        });
        return;
      }

      // Check if account is active
      if (!user.isActive) {
        res.status(403).json({
          success: false,
          message: 'Account is deactivated. Please contact support.',
          error: 'ACCOUNT_DEACTIVATED'
        });
        return;
      }

      // Verify password
      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        res.status(401).json({
          success: false,
          message: 'Invalid credentials',
          error: 'INVALID_CREDENTIALS'
        });
        return;
      }

      // Generate JWT tokens
      const { accessToken, refreshToken } = generateTokens(user);

      // Cache user session
      const sessionData = {
        accessToken,
        refreshToken,
        user: user.toJSON(),
        rememberMe
      };
      await cacheUserSession(user._id.toString(), sessionData);

      // Update last login
      user.lastLoginAt = new Date();
      await user.save({ validateBeforeSave: false });

      res.status(200).json({
        success: true,
        message: 'Login successful',
        data: {
          user: user.toJSON(),
          tokens: {
            accessToken,
            refreshToken
          },
          sessionExpiry: rememberMe ? '7d' : '24h'
        }
      });

    } catch (error: any) {
      console.error('Login error:', error);
      res.status(500).json({
        success: false,
        message: 'Login failed',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  // Logout user
  static async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?._id.toString();

      if (userId) {
        // Clear user session from cache
        await clearUserSession(userId);
      }

      res.status(200).json({
        success: true,
        message: 'Logout successful'
      });

    } catch (error: any) {
      console.error('Logout error:', error);
      res.status(500).json({
        success: false,
        message: 'Logout failed',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  // Get current user profile
  static async getProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Unauthorized',
          error: 'UNAUTHORIZED'
        });
        return;
      }

      // Get fresh user data with stats
      const user = await User.findById(req.user._id)
        .populate('properties', 'id title price listingType isActive')
        .populate('favorites', 'propertyId createdAt')
        .exec();

      if (!user) {
        res.status(404).json({
          success: false,
          message: 'User not found',
          error: 'USER_NOT_FOUND'
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: 'Profile retrieved successfully',
        data: {
          user: user.toJSON()
        }
      });

    } catch (error: any) {
      console.error('Get profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve profile',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  // Update user profile
  static async updateProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Unauthorized',
          error: 'UNAUTHORIZED'
        });
        return;
      }

      const allowedUpdates = ['firstName', 'lastName', 'phone', 'avatar', 'preferences'];
      const updates = Object.keys(req.body);
      const isValidOperation = updates.every(update => allowedUpdates.includes(update));

      if (!isValidOperation) {
        res.status(400).json({
          success: false,
          message: 'Invalid updates attempted',
          error: 'INVALID_UPDATES'
        });
        return;
      }

      // Update user
      const user = await User.findById(req.user._id);
      if (!user) {
        res.status(404).json({
          success: false,
          message: 'User not found',
          error: 'USER_NOT_FOUND'
        });
        return;
      }

      // Apply updates
      updates.forEach(update => {
        (user as any)[update] = req.body[update];
      });

      await user.save();

      // Clear and update cached session
      await clearUserSession(user._id.toString());
      const { accessToken, refreshToken } = generateTokens(user);
      await cacheUserSession(user._id.toString(), {
        accessToken,
        refreshToken,
        user: user.toJSON()
      });

      res.status(200).json({
        success: true,
        message: 'Profile updated successfully',
        data: {
          user: user.toJSON()
        }
      });

    } catch (error: any) {
      console.error('Update profile error:', error);

      if (error.name === 'ValidationError') {
        const validationErrors = Object.values(error.errors).map((err: any) => err.message);
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: validationErrors
        });
        return;
      }

      res.status(500).json({
        success: false,
        message: 'Failed to update profile',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  // Change password
  static async changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Unauthorized',
          error: 'UNAUTHORIZED'
        });
        return;
      }

      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        res.status(400).json({
          success: false,
          message: 'Current password and new password are required',
          error: 'MISSING_REQUIRED_FIELDS'
        });
        return;
      }

      // Get user with password
      const user = await User.findById(req.user._id).select('+password');
      if (!user) {
        res.status(404).json({
          success: false,
          message: 'User not found',
          error: 'USER_NOT_FOUND'
        });
        return;
      }

      // Verify current password
      const isCurrentPasswordValid = await user.comparePassword(currentPassword);
      if (!isCurrentPasswordValid) {
        res.status(401).json({
          success: false,
          message: 'Current password is incorrect',
          error: 'INVALID_CURRENT_PASSWORD'
        });
        return;
      }

      // Update password
      user.password = newPassword;
      await user.save();

      // Clear all user sessions (force re-login)
      await clearUserSession(user._id.toString());

      res.status(200).json({
        success: true,
        message: 'Password changed successfully. Please login again.'
      });

    } catch (error: any) {
      console.error('Change password error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to change password',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  // Refresh access token
  static async refreshToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        res.status(400).json({
          success: false,
          message: 'Refresh token is required',
          error: 'MISSING_REFRESH_TOKEN'
        });
        return;
      }

      // Verify refresh token
      const decoded = jwt.verify(refreshToken, config.JWT_REFRESH_SECRET) as JWTPayload;

      // Find user
      const user = await User.findById(decoded.userId);
      if (!user || !user.isActive) {
        res.status(401).json({
          success: false,
          message: 'Invalid refresh token',
          error: 'INVALID_REFRESH_TOKEN'
        });
        return;
      }

      // Generate new tokens
      const tokens = generateTokens(user);

      // Update cached session
      await cacheUserSession(user._id.toString(), {
        ...tokens,
        user: user.toJSON()
      });

      res.status(200).json({
        success: true,
        message: 'Token refreshed successfully',
        data: {
          tokens
        }
      });

    } catch (error: any) {
      console.error('Refresh token error:', error);

      if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
        res.status(401).json({
          success: false,
          message: 'Invalid or expired refresh token',
          error: 'INVALID_REFRESH_TOKEN'
        });
        return;
      }

      res.status(500).json({
        success: false,
        message: 'Failed to refresh token',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  // Verify email
  static async verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token } = req.params;

      if (!token) {
        res.status(400).json({
          success: false,
          message: 'Verification token is required',
          error: 'MISSING_VERIFICATION_TOKEN'
        });
        return;
      }

      // Find user with verification token
      const user = await User.findOne({
        emailVerificationToken: token,
        emailVerificationExpires: { $gt: new Date() }
      });

      if (!user) {
        res.status(400).json({
          success: false,
          message: 'Invalid or expired verification token',
          error: 'INVALID_VERIFICATION_TOKEN'
        });
        return;
      }

      // Mark user as verified
      user.isVerified = true;
      user.emailVerificationToken = undefined;
      user.emailVerificationExpires = undefined;
      await user.save();

      res.status(200).json({
        success: true,
        message: 'Email verified successfully',
        data: {
          user: user.toJSON()
        }
      });

    } catch (error: any) {
      console.error('Email verification error:', error);
      res.status(500).json({
        success: false,
        message: 'Email verification failed',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  // Get user stats
  static async getUserStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Unauthorized',
          error: 'UNAUTHORIZED'
        });
        return;
      }

      const userId = req.user._id;

      // Get comprehensive stats
      const [propertyCount, favoriteCount, recommendationStats] = await Promise.all([
        // Properties created by user
        req.user.stats.propertiesListed,

        // User's favorites count
        req.user.stats.favoriteCount,

        // Recommendation stats (you'd import Recommendation model)
        // Recommendation.getRecommendationStats(userId)
        { sent: [], received: [] } // Placeholder
      ]);

      res.status(200).json({
        success: true,
        message: 'User stats retrieved successfully',
        data: {
          stats: {
            propertiesListed: propertyCount,
            favorites: favoriteCount,
            recommendations: {
              sent: req.user.stats.recommendationsSent,
              received: req.user.stats.recommendationsReceived
            },
            accountAge: Math.floor((Date.now() - req.user.createdAt.getTime()) / (1000 * 60 * 60 * 24)),
            lastLoginDaysAgo: req.user.lastLoginAt
              ? Math.floor((Date.now() - req.user.lastLoginAt.getTime()) / (1000 * 60 * 60 * 24))
              : null,
            isVerified: req.user.isVerified
          }
        }
      });

    } catch (error: any) {
      console.error('Get user stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve user stats',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }
}