import { Request, Response, NextFunction } from 'express';
import { Recommendation, IRecommendation } from '../models/Recommendation';
import { User, IUser } from '../models/User';
import { Property } from '../models/Property';
import { redisClient } from '../config/redis';
import { config, CACHE_KEYS } from '../config/env';
import mongoose from 'mongoose';

// Interface for query parameters
interface RecommendationQueryParams {
  page?: string;
  limit?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  status?: 'pending' | 'viewed' | 'interested' | 'not_interested' | 'contacted' | 'dismissed';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  category?: string;
}

export class RecommendationController {

  // Search users by email for recommendations
  static async searchUserByEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
          error: 'UNAUTHORIZED'
        });
        return;
      }

      const { email } = req.query;

      if (!email || typeof email !== 'string') {
        res.status(400).json({
          success: false,
          message: 'Email is required for user search',
          error: 'MISSING_EMAIL'
        });
        return;
      }

      // Prevent users from searching for themselves
      if (email.toLowerCase() === req.user.email.toLowerCase()) {
        res.status(400).json({
          success: false,
          message: 'You cannot send recommendations to yourself',
          error: 'SELF_RECOMMENDATION'
        });
        return;
      }

      // Search for user by email
      const user = await User.findOne({ 
        email: email.toLowerCase().trim(),
        isActive: true,
        isVerified: true
      }).select('firstName lastName email avatar preferences.privacy');

      if (!user) {
        res.status(404).json({
          success: false,
          message: 'User not found or not available for recommendations',
          error: 'USER_NOT_FOUND'
        });
        return;
      }

      // Check if user allows recommendations
      if (!user.preferences?.notifications?.recommendations) {
        res.status(403).json({
          success: false,
          message: 'This user has disabled property recommendations',
          error: 'RECOMMENDATIONS_DISABLED'
        });
        return;
      }

      // Return limited user info based on privacy settings
      const userInfo: any = {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email
      };

      if (user.preferences?.privacy?.showProfile) {
        userInfo.avatar = user.avatar;
        userInfo.fullName = user.getFullName();
      }

      res.status(200).json({
        success: true,
        message: 'User found and available for recommendations',
        data: {
          user: userInfo,
          canReceiveRecommendations: true
        }
      });

    } catch (error: any) {
      console.error('Search user by email error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to search user',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  // Send property recommendation to another user
  static async sendRecommendation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
          error: 'UNAUTHORIZED'
        });
        return;
      }

      const {
        recipientEmail,
        propertyId,
        message,
        subject,
        priority = 'medium',
        category = 'general',
        senderReason
      } = req.body;

      // Validate required fields
      if (!recipientEmail || !propertyId) {
        res.status(400).json({
          success: false,
          message: 'Recipient email and property ID are required',
          error: 'MISSING_REQUIRED_FIELDS'
        });
        return;
      }

      if (!mongoose.Types.ObjectId.isValid(propertyId)) {
        res.status(400).json({
          success: false,
          message: 'Invalid property ID format',
          error: 'INVALID_PROPERTY_ID'
        });
        return;
      }

      // Find recipient user
      const recipient = await User.findOne({ 
        email: recipientEmail.toLowerCase().trim(),
        isActive: true,
        isVerified: true
      });

      if (!recipient) {
        res.status(404).json({
          success: false,
          message: 'Recipient not found or not available',
          error: 'RECIPIENT_NOT_FOUND'
        });
        return;
      }

      // Prevent self-recommendations
      if (recipient._id.toString() === req.user._id.toString()) {
        res.status(400).json({
          success: false,
          message: 'You cannot send recommendations to yourself',
          error: 'SELF_RECOMMENDATION'
        });
        return;
      }

      // Check if recipient allows recommendations
      if (!recipient.preferences?.notifications?.recommendations) {
        res.status(403).json({
          success: false,
          message: 'This user has disabled property recommendations',
          error: 'RECOMMENDATIONS_DISABLED'
        });
        return;
      }

      // Verify property exists and is active
      const property = await Property.findById(propertyId);
      if (!property || !property.isActive) {
        res.status(404).json({
          success: false,
          message: 'Property not found or not available',
          error: 'PROPERTY_NOT_FOUND'
        });
        return;
      }

      // Check for duplicate recommendations
      const existingRecommendation = await Recommendation.findOne({
        senderId: req.user._id,
        recipientId: recipient._id,
        propertyId,
        isActive: true
      });

      if (existingRecommendation) {
        res.status(409).json({
          success: false,
          message: 'You have already recommended this property to this user',
          error: 'DUPLICATE_RECOMMENDATION',
          data: {
            existingRecommendation: existingRecommendation.toJSON()
          }
        });
        return;
      }

      // Create recommendation
      const recommendationData: any = {
        senderId: req.user._id,
        recipientId: recipient._id,
        propertyId,
        message: message?.trim(),
        subject: subject?.trim() || `${req.user.getFullName()} recommended a property for you`,
        priority,
        category,
        metadata: {
          senderReason: senderReason?.trim(),
          location: {
            city: property.location.city,
            state: property.location.state
          }
        },
        communication: {
          allowFollowUp: true,
          hideFromSender: false,
          allowReminders: true,
          preferredContactMethod: 'in_app'
        }
      };

      const recommendation = new Recommendation(recommendationData);
      await recommendation.save();

      // Clear related caches
      await redisClient.deletePattern(`${CACHE_KEYS.RECOMMENDATIONS}:*`);

      // Populate for response
      await recommendation.populate([
        { path: 'recipientId', select: 'firstName lastName email' },
        { path: 'propertyId', select: 'id title type price location rating' }
      ]);

      // Here you would typically send a notification email/push notification
      // await notificationService.sendRecommendationNotification(recommendation);

      res.status(201).json({
        success: true,
        message: 'Recommendation sent successfully',
        data: {
          recommendation: recommendation.toJSON()
        }
      });

    } catch (error: any) {
      console.error('Send recommendation error:', error);
      
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
        message: 'Failed to send recommendation',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  // Get recommendations received by user
  static async getReceivedRecommendations(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
          error: 'UNAUTHORIZED'
        });
        return;
      }

      const {
        page = '1',
        limit = config.DEFAULT_PAGE_SIZE.toString(),
        sortBy = 'createdAt',
        sortOrder = 'desc',
        status,
        priority,
        category
      } = req.query as RecommendationQueryParams;

      const pageNum = Math.max(1, parseInt(page));
      const limitNum = Math.min(parseInt(limit), config.MAX_PAGE_SIZE);
      const skip = (pageNum - 1) * limitNum;

      // Build filter query
      const filter: any = { 
        recipientId: req.user._id,
        isActive: true
      };

      if (status) {
        filter.status = status;
      }

      if (priority) {
        filter.priority = priority;
      }

      if (category) {
        filter.category = category;
      }

      // Exclude expired recommendations
      filter.$or = [
        { expiresAt: { $exists: false } },
        { expiresAt: { $gt: new Date() } }
      ];

      // Build sort options
      const sortOptions: any = {};
      if (sortBy === 'priority') {
        const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
        sortOptions.priority = sortOrder === 'asc' ? 1 : -1;
      } else {
        sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;
      }

      // Check cache
      const cacheKey = `${CACHE_KEYS.RECOMMENDATIONS}:received:${req.user._id}:${JSON.stringify({
        filter,
        sort: sortOptions,
        page: pageNum,
        limit: limitNum
      })}`;

      const cachedResult = await redisClient.getObject(cacheKey);
      if (cachedResult) {
        res.status(200).json(cachedResult);
        return;
      }

      // Execute query
      const [recommendations, totalCount] = await Promise.all([
        Recommendation.find(filter)
          .sort(sortOptions)
          .skip(skip)
          .limit(limitNum)
          .populate([
            { path: 'senderId', select: 'firstName lastName email avatar' },
            { 
              path: 'propertyId', 
              select: 'id title type price location specifications rating isVerified media colorTheme',
              match: { isActive: true }
            }
          ])
          .lean()
          .exec(),
        Recommendation.countDocuments(filter)
      ]);

      // Filter out recommendations where property is no longer active
      const validRecommendations = recommendations.filter(rec => rec.propertyId);

      // Calculate summary stats
      const summaryStats = await Recommendation.aggregate([
        { $match: { recipientId: req.user._id, isActive: true } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]);

      const result = {
        success: true,
        message: 'Received recommendations retrieved successfully',
        data: {
          recommendations: validRecommendations,
          pagination: {
            currentPage: pageNum,
            totalPages: Math.ceil(totalCount / limitNum),
            totalCount,
            limit: limitNum,
            hasNextPage: pageNum < Math.ceil(totalCount / limitNum),
            hasPrevPage: pageNum > 1
          },
          summary: {
            total: totalCount,
            active: validRecommendations.length,
            byStatus: summaryStats.reduce((acc, stat) => {
              acc[stat._id] = stat.count;
              return acc;
            }, {} as any)
          }
        }
      };

      // Cache the result
      await redisClient.set(cacheKey, JSON.stringify(result), config.CACHE_TTL_SHORT);

      res.status(200).json(result);

    } catch (error: any) {
      console.error('Get received recommendations error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve received recommendations',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  // Get recommendations sent by user
  static async getSentRecommendations(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
          error: 'UNAUTHORIZED'
        });
        return;
      }

      const {
        page = '1',
        limit = config.DEFAULT_PAGE_SIZE.toString(),
        sortBy = 'createdAt',
        sortOrder = 'desc',
        status
      } = req.query as RecommendationQueryParams;

      const pageNum = Math.max(1, parseInt(page));
      const limitNum = Math.min(parseInt(limit), config.MAX_PAGE_SIZE);
      const skip = (pageNum - 1) * limitNum;

      // Build filter
      const filter: any = { 
        senderId: req.user._id,
        isActive: true
      };

      if (status) {
        filter.status = status;
      }

      const sortOptions: any = {};
      sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;

      // Execute query
      const [recommendations, totalCount] = await Promise.all([
        Recommendation.find(filter)
          .sort(sortOptions)
          .skip(skip)
          .limit(limitNum)
          .populate([
            { path: 'recipientId', select: 'firstName lastName email' },
            { 
              path: 'propertyId', 
              select: 'id title type price location rating',
              match: { isActive: true }
            }
          ])
          .lean()
          .exec(),
        Recommendation.countDocuments(filter)
      ]);

      const validRecommendations = recommendations.filter(rec => rec.propertyId);

      res.status(200).json({
        success: true,
        message: 'Sent recommendations retrieved successfully',
        data: {
          recommendations: validRecommendations,
          pagination: {
            currentPage: pageNum,
            totalPages: Math.ceil(totalCount / limitNum),
            totalCount,
            limit: limitNum,
            hasNextPage: pageNum < Math.ceil(totalCount / limitNum),
            hasPrevPage: pageNum > 1
          }
        }
      });

    } catch (error: any) {
      console.error('Get sent recommendations error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve sent recommendations',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  // Update recommendation status
  static async updateRecommendationStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { status, response } = req.body;

      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
          error: 'UNAUTHORIZED'
        });
        return;
      }

      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({
          success: false,
          message: 'Invalid recommendation ID format',
          error: 'INVALID_RECOMMENDATION_ID'
        });
        return;
      }

      const validStatuses = ['viewed', 'interested', 'not_interested', 'contacted', 'dismissed'];
      if (!status || !validStatuses.includes(status)) {
        res.status(400).json({
          success: false,
          message: 'Valid status is required',
          error: 'INVALID_STATUS',
          validStatuses
        });
        return;
      }

      // Find recommendation
      const recommendation = await Recommendation.findOne({
        _id: id,
        recipientId: req.user._id,
        isActive: true
      });

      if (!recommendation) {
        res.status(404).json({
          success: false,
          message: 'Recommendation not found',
          error: 'RECOMMENDATION_NOT_FOUND'
        });
        return;
      }

      // Update status using appropriate method
      switch (status) {
        case 'viewed':
          await recommendation.markAsViewed();
          break;
        case 'interested':
          await recommendation.markAsInterested();
          break;
        case 'not_interested':
          await recommendation.markAsNotInterested();
          break;
        case 'contacted':
          await recommendation.markAsContacted();
          break;
        case 'dismissed':
          await recommendation.markAsDismissed();
          break;
      }

      // Add response message if provided
      if (response && response.trim()) {
        recommendation.message = response.trim();
        await recommendation.save();
      }

      // Clear caches
      await redisClient.deletePattern(`${CACHE_KEYS.RECOMMENDATIONS}:*`);

      res.status(200).json({
        success: true,
        message: 'Recommendation status updated successfully',
        data: {
          recommendation: recommendation.toJSON(),
          newStatus: status
        }
      });

    } catch (error: any) {
      console.error('Update recommendation status error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update recommendation status',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  // Get single recommendation details
  static async getRecommendationById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
          error: 'UNAUTHORIZED'
        });
        return;
      }

      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({
          success: false,
          message: 'Invalid recommendation ID format',
          error: 'INVALID_RECOMMENDATION_ID'
        });
        return;
      }

      const recommendation = await Recommendation.findOne({
        _id: id,
        $or: [
          { senderId: req.user._id },
          { recipientId: req.user._id }
        ],
        isActive: true
      })
      .populate([
        { path: 'senderId', select: 'firstName lastName email avatar' },
        { path: 'recipientId', select: 'firstName lastName email avatar' },
        { path: 'propertyId' }
      ])
      .exec();

      if (!recommendation) {
        res.status(404).json({
          success: false,
          message: 'Recommendation not found',
          error: 'RECOMMENDATION_NOT_FOUND'
        });
        return;
      }

      // Mark as viewed if user is the recipient and not already viewed
      if (recommendation.recipientId._id.toString() === req.user._id.toString() && 
          recommendation.status === 'pending') {
        await recommendation.markAsViewed();
      }

      res.status(200).json({
        success: true,
        message: 'Recommendation details retrieved successfully',
        data: {
          recommendation: recommendation.toJSON(),
          isRecipient: recommendation.recipientId._id.toString() === req.user._id.toString(),
          isSender: recommendation.senderId._id.toString() === req.user._id.toString(),
          interactionStatus: recommendation.getInteractionStatus(),
          canRespond: recommendation.recipientId._id.toString() === req.user._id.toString() && 
                     ['pending', 'viewed'].includes(recommendation.status)
        }
      });

    } catch (error: any) {
      console.error('Get recommendation by ID error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve recommendation details',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  // Get recommendation analytics
  static async getRecommendationAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
          error: 'UNAUTHORIZED'
        });
        return;
      }

      const userId = req.user._id;

      // Get comprehensive analytics
      const [
        sentStats,
        receivedStats,
        responseRates,
        topCategories,
        recentActivity
      ] = await Promise.all([
        // Sent recommendations stats
        Recommendation.aggregate([
          { $match: { senderId: userId } },
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 }
            }
          }
        ]),

        // Received recommendations stats
        Recommendation.aggregate([
          { $match: { recipientId: userId, isActive: true } },
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 }
            }
          }
        ]),

        // Response rate calculation
        Recommendation.aggregate([
          { $match: { senderId: userId } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              responded: {
                $sum: {
                  $cond: [
                    { $in: ['$status', ['interested', 'not_interested', 'contacted']] },
                    1,
                    0
                  ]
                }
              }
            }
          }
        ]),

        // Top recommendation categories
        Recommendation.aggregate([
          { 
            $match: { 
              $or: [{ senderId: userId }, { recipientId: userId }],
              isActive: true
            }
          },
          {
            $group: {
              _id: '$category',
              count: { $sum: 1 }
            }
          },
          { $sort: { count: -1 } },
          { $limit: 5 }
        ]),

        // Recent activity
        Recommendation.find({
          $or: [{ senderId: userId }, { recipientId: userId }],
          isActive: true
        })
        .sort({ updatedAt: -1 })
        .limit(10)
        .populate([
          { path: 'senderId', select: 'firstName lastName' },
          { path: 'recipientId', select: 'firstName lastName' },
          { path: 'propertyId', select: 'id title location' }
        ])
        .lean()
      ]);

      // Calculate response rate
      const responseRate = responseRates[0] ? 
        ((responseRates[0].responded / responseRates[0].total) * 100).toFixed(1) : 0;

      res.status(200).json({
        success: true,
        message: 'Recommendation analytics retrieved successfully',
        data: {
          overview: {
            totalSent: req.user.stats.recommendationsSent,
            totalReceived: req.user.stats.recommendationsReceived,
            responseRate: `${responseRate}%`
          },
          sent: {
            breakdown: sentStats.reduce((acc, stat) => {
              acc[stat._id] = stat.count;
              return acc;
            }, {} as any),
            total: sentStats.reduce((sum, stat) => sum + stat.count, 0)
          },
          received: {
            breakdown: receivedStats.reduce((acc, stat) => {
              acc[stat._id] = stat.count;
              return acc;
            }, {} as any),
            total: receivedStats.reduce((sum, stat) => sum + stat.count, 0)
          },
          categories: {
            popular: topCategories,
            count: topCategories.length
          },
          recentActivity: {
            items: recentActivity,
            count: recentActivity.length
          },
          generatedAt: new Date().toISOString()
        }
      });

    } catch (error: any) {
      console.error('Get recommendation analytics error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve recommendation analytics',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  // Send reminder for pending recommendations
  static async sendReminder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
          error: 'UNAUTHORIZED'
        });
        return;
      }

      const recommendation = await Recommendation.findOne({
        _id: id,
        senderId: req.user._id,
        status: 'pending',
        isActive: true
      });

      if (!recommendation) {
        res.status(404).json({
          success: false,
          message: 'Recommendation not found or cannot send reminder',
          error: 'RECOMMENDATION_NOT_FOUND'
        });
        return;
      }

      const reminderSent = await recommendation.sendReminder();

      if (!reminderSent) {
        res.status(400).json({
          success: false,
          message: 'Cannot send reminder at this time',
          error: 'REMINDER_NOT_ALLOWED'
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: 'Reminder sent successfully',
        data: {
          reminderCount: recommendation.interactions.reminderCount,
          lastReminderSent: recommendation.interactions.reminderSentAt
        }
      });

    } catch (error: any) {
      console.error('Send reminder error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to send reminder',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }
}