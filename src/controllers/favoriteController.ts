import { Request, Response, NextFunction } from 'express';
import { Favorite, IFavorite } from '../models/Favorite';
import { Property } from '../models/Property';
import { User } from '../models/User';
import { redisClient } from '../config/redis';
import { config, CACHE_KEYS } from '../config/env';
import mongoose from 'mongoose';

// Interface for query parameters
interface FavoriteQueryParams {
  page?: string;
  limit?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  favoriteType?: 'interested' | 'watchlist' | 'shortlisted' | 'considering';
  priority?: 'low' | 'medium' | 'high';
  tags?: string;
  hasReminder?: string;
  priceChanged?: string;
}

export class FavoriteController {

  // Get user's favorites
  static async getFavorites(req: Request, res: Response, next: NextFunction): Promise<void> {
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
        favoriteType,
        priority,
        tags,
        hasReminder,
        priceChanged
      } = req.query as FavoriteQueryParams;

      const pageNum = Math.max(1, parseInt(page));
      const limitNum = Math.min(parseInt(limit), config.MAX_PAGE_SIZE);
      const skip = (pageNum - 1) * limitNum;

      // Build filter query
      const filter: any = { userId: req.user._id };

      if (favoriteType) {
        filter.favoriteType = favoriteType;
      }

      if (priority) {
        filter.priority = priority;
      }

      if (tags) {
        const tagsArray = tags.split(',').map(t => t.trim().toLowerCase());
        filter.tags = { $in: tagsArray };
      }

      if (hasReminder === 'true') {
        filter.reminderDate = { $exists: true, $ne: null };
      }

      // Build sort object
      const sortOptions: any = {};
      if (sortBy === 'price') {
        // This will require population to sort by property price
        sortOptions.createdAt = sortOrder === 'asc' ? 1 : -1;
      } else if (sortBy === 'priority') {
        // Custom priority sorting: high -> medium -> low
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        sortOptions.priority = sortOrder === 'asc' ? 1 : -1;
      } else {
        sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;
      }

      // Check cache first
      const cacheKey = `${CACHE_KEYS.USER_FAVORITES}:${req.user._id}:${JSON.stringify({
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

      // Execute query with population
      const [favorites, totalCount] = await Promise.all([
        Favorite.find(filter)
          .sort(sortOptions)
          .skip(skip)
          .limit(limitNum)
          .populate({
            path: 'propertyId',
            select: 'id title type price location specifications amenities rating isVerified listingType media colorTheme',
            match: { isActive: true } // Only populate active properties
          })
          .lean()
          .exec(),
        Favorite.countDocuments(filter)
      ]);

      // Filter out favorites where property was not populated (inactive properties)
      const validFavorites = favorites.filter(fav => fav.propertyId);

      // Check for price changes if requested
      if (priceChanged === 'true') {
        for (const favorite of validFavorites) {
          const fav = await Favorite.findById(favorite._id);
          if (fav) {
            await fav.isPriceChanged();
          }
        }
      }

      // Calculate pagination
      const totalPages = Math.ceil(totalCount / limitNum);

      const result = {
        success: true,
        message: 'Favorites retrieved successfully',
        data: {
          favorites: validFavorites,
          pagination: {
            currentPage: pageNum,
            totalPages,
            totalCount,
            limit: limitNum,
            hasNextPage: pageNum < totalPages,
            hasPrevPage: pageNum > 1
          },
          summary: {
            totalFavorites: totalCount,
            validFavorites: validFavorites.length,
            byType: await Favorite.aggregate([
              { $match: { userId: req.user._id } },
              { $group: { _id: '$favoriteType', count: { $sum: 1 } } }
            ]),
            byPriority: await Favorite.aggregate([
              { $match: { userId: req.user._id } },
              { $group: { _id: '$priority', count: { $sum: 1 } } }
            ])
          }
        }
      };

      // Cache the result
      await redisClient.set(cacheKey, JSON.stringify(result), config.CACHE_TTL_SHORT);

      res.status(200).json(result);

    } catch (error: any) {
      console.error('Get favorites error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve favorites',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  // Add property to favorites
  static async addToFavorites(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { propertyId } = req.params;
      const {
        notes,
        tags = [],
        favoriteType = 'interested',
        priority = 'medium',
        reminderDate,
        addedFromPage = 'other'
      } = req.body;

      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
          error: 'UNAUTHORIZED'
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

      // Check if property exists and is active
      const property = await Property.findById(propertyId);
      if (!property || !property.isActive) {
        res.status(404).json({
          success: false,
          message: 'Property not found or not available',
          error: 'PROPERTY_NOT_FOUND'
        });
        return;
      }

      // Check if already favorited
      const existingFavorite = await Favorite.findOne({
        userId: req.user._id,
        propertyId
      });

      if (existingFavorite) {
        res.status(409).json({
          success: false,
          message: 'Property is already in your favorites',
          error: 'ALREADY_FAVORITED',
          data: {
            favorite: existingFavorite.toJSON()
          }
        });
        return;
      }

      // Create new favorite
      const favoriteData: any = {
        userId: req.user._id,
        propertyId,
        notes: notes?.trim(),
        tags: Array.isArray(tags) ? tags.map((t: string) => t.trim().toLowerCase()) : [],
        favoriteType,
        priority,
        metadata: {
          addedFromPage,
          priceWhenAdded: property.price
        }
      };

      if (reminderDate) {
        favoriteData.reminderDate = new Date(reminderDate);
      }

      const favorite = new Favorite(favoriteData);
      await favorite.save();

      // Clear user favorites cache
      await redisClient.deletePattern(`${CACHE_KEYS.USER_FAVORITES}:${req.user._id}:*`);

      // Populate for response
      await favorite.populate('propertyId', 'id title type price location rating');

      res.status(201).json({
        success: true,
        message: 'Property added to favorites successfully',
        data: {
          favorite: favorite.toJSON()
        }
      });

    } catch (error: any) {
      console.error('Add to favorites error:', error);
      
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
        message: 'Failed to add property to favorites',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  // Remove property from favorites
  static async removeFromFavorites(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { propertyId } = req.params;

      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
          error: 'UNAUTHORIZED'
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

      // Find and remove favorite
      const favorite = await Favorite.findOneAndDelete({
        userId: req.user._id,
        propertyId
      });

      if (!favorite) {
        res.status(404).json({
          success: false,
          message: 'Favorite not found',
          error: 'FAVORITE_NOT_FOUND'
        });
        return;
      }

      // Clear user favorites cache
      await redisClient.deletePattern(`${CACHE_KEYS.USER_FAVORITES}:${req.user._id}:*`);

      res.status(200).json({
        success: true,
        message: 'Property removed from favorites successfully'
      });

    } catch (error: any) {
      console.error('Remove from favorites error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to remove property from favorites',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  // Update favorite details
  static async updateFavorite(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { favoriteId } = req.params;
      const updateData = req.body;

      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
          error: 'UNAUTHORIZED'
        });
        return;
      }

      if (!mongoose.Types.ObjectId.isValid(favoriteId)) {
        res.status(400).json({
          success: false,
          message: 'Invalid favorite ID format',
          error: 'INVALID_FAVORITE_ID'
        });
        return;
      }

      // Find favorite
      const favorite = await Favorite.findOne({
        _id: favoriteId,
        userId: req.user._id
      });

      if (!favorite) {
        res.status(404).json({
          success: false,
          message: 'Favorite not found',
          error: 'FAVORITE_NOT_FOUND'
        });
        return;
      }

      // Allowed update fields
      const allowedUpdates = ['notes', 'tags', 'favoriteType', 'priority', 'reminderDate', 'isNotificationEnabled'];
      const updates = Object.keys(updateData);
      const isValidOperation = updates.every(update => allowedUpdates.includes(update));

      if (!isValidOperation) {
        res.status(400).json({
          success: false,
          message: 'Invalid updates attempted',
          error: 'INVALID_UPDATES'
        });
        return;
      }

      // Apply updates
      updates.forEach(update => {
        if (update === 'tags' && Array.isArray(updateData[update])) {
          (favorite as any)[update] = updateData[update].map((t: string) => t.trim().toLowerCase());
        } else if (update === 'reminderDate' && updateData[update]) {
          (favorite as any)[update] = new Date(updateData[update]);
        } else {
          (favorite as any)[update] = updateData[update];
        }
      });

      await favorite.save();

      // Clear user favorites cache
      await redisClient.deletePattern(`${CACHE_KEYS.USER_FAVORITES}:${req.user._id}:*`);

      // Populate for response
      await favorite.populate('propertyId', 'id title type price location rating');

      res.status(200).json({
        success: true,
        message: 'Favorite updated successfully',
        data: {
          favorite: favorite.toJSON()
        }
      });

    } catch (error: any) {
      console.error('Update favorite error:', error);
      
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
        message: 'Failed to update favorite',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  // Get single favorite details
  static async getFavoriteById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { favoriteId } = req.params;

      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
          error: 'UNAUTHORIZED'
        });
        return;
      }

      if (!mongoose.Types.ObjectId.isValid(favoriteId)) {
        res.status(400).json({
          success: false,
          message: 'Invalid favorite ID format',
          error: 'INVALID_FAVORITE_ID'
        });
        return;
      }

      const favorite = await Favorite.findOne({
        _id: favoriteId,
        userId: req.user._id
      })
      .populate('propertyId')
      .exec();

      if (!favorite) {
        res.status(404).json({
          success: false,
          message: 'Favorite not found',
          error: 'FAVORITE_NOT_FOUND'
        });
        return;
      }

      // Update view count
      await favorite.updateViewCount();

      // Check for price changes
      const priceChanged = await favorite.isPriceChanged();

      res.status(200).json({
        success: true,
        message: 'Favorite details retrieved successfully',
        data: {
          favorite: favorite.toJSON(),
          insights: {
            priceChanged,
            daysSinceAdded: favorite.createdAt ? Math.floor((Date.now() - new Date(favorite.createdAt).getTime()) / (1000 * 60 * 60 * 24)) : null,
            viewCount: favorite.metadata?.viewCount ?? null
          }
        }
      });

    } catch (error: any) {
      console.error('Get favorite by ID error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve favorite details',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  // Check if property is favorited by user
  static async checkFavoriteStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { propertyId } = req.params;

      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
          error: 'UNAUTHORIZED'
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

      const favorite = await Favorite.findOne({
        userId: req.user._id,
        propertyId
      }).select('favoriteType priority createdAt').lean();

      res.status(200).json({
        success: true,
        message: 'Favorite status retrieved successfully',
        data: {
          isFavorited: !!favorite,
          favorite: favorite || null
        }
      });

    } catch (error: any) {
      console.error('Check favorite status error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to check favorite status',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  // Add tag to favorite
  static async addTag(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { favoriteId } = req.params;
      const { tag } = req.body;

      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
          error: 'UNAUTHORIZED'
        });
        return;
      }

      if (!tag || typeof tag !== 'string') {
        res.status(400).json({
          success: false,
          message: 'Tag is required and must be a string',
          error: 'INVALID_TAG'
        });
        return;
      }

      const favorite = await Favorite.findOne({
        _id: favoriteId,
        userId: req.user._id
      });

      if (!favorite) {
        res.status(404).json({
          success: false,
          message: 'Favorite not found',
          error: 'FAVORITE_NOT_FOUND'
        });
        return;
      }

      await favorite.addTag(tag);

      // Clear cache
      await redisClient.deletePattern(`${CACHE_KEYS.USER_FAVORITES}:${req.user._id}:*`);

      res.status(200).json({
        success: true,
        message: 'Tag added successfully',
        data: {
          tags: favorite.tags
        }
      });

    } catch (error: any) {
      console.error('Add tag error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to add tag',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  // Remove tag from favorite
  static async removeTag(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { favoriteId } = req.params;
      const { tag } = req.body;

      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
          error: 'UNAUTHORIZED'
        });
        return;
      }

      if (!tag || typeof tag !== 'string') {
        res.status(400).json({
          success: false,
          message: 'Tag is required and must be a string',
          error: 'INVALID_TAG'
        });
        return;
      }

      const favorite = await Favorite.findOne({
        _id: favoriteId,
        userId: req.user._id
      });

      if (!favorite) {
        res.status(404).json({
          success: false,
          message: 'Favorite not found',
          error: 'FAVORITE_NOT_FOUND'
        });
        return;
      }

      await favorite.removeTag(tag);

      // Clear cache
      await redisClient.deletePattern(`${CACHE_KEYS.USER_FAVORITES}:${req.user._id}:*`);

      res.status(200).json({
        success: true,
        message: 'Tag removed successfully',
        data: {
          tags: favorite.tags
        }
      });

    } catch (error: any) {
      console.error('Remove tag error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to remove tag',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  // Get favorite analytics/insights
  static async getFavoriteInsights(req: Request, res: Response, next: NextFunction): Promise<void> {
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

      // Get comprehensive insights
      const [
        totalFavorites,
        favoritesByType,
        favoritesByPriority,
        recentFavorites,
        priceChanges,
        popularTags,
        upcomingReminders
      ] = await Promise.all([
        Favorite.countDocuments({ userId }),
        
        Favorite.aggregate([
          { $match: { userId } },
          { $group: { _id: '$favoriteType', count: { $sum: 1 } } }
        ]),
        
        Favorite.aggregate([
          { $match: { userId } },
          { $group: { _id: '$priority', count: { $sum: 1 } } }
        ]),
        
        Favorite.find({ userId })
          .sort({ createdAt: -1 })
          .limit(5)
          .populate('propertyId', 'id title price location')
          .lean(),
          
        // Properties with price changes (simplified)
        Favorite.countDocuments({ 
          userId, 
          'metadata.priceChangeCount': { $gt: 0 } 
        }),
        
        Favorite.aggregate([
          { $match: { userId } },
          { $unwind: '$tags' },
          { $group: { _id: '$tags', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 }
        ]),
        
        Favorite.find({
          userId,
          reminderDate: { 
            $exists: true, 
            $gte: new Date(),
            $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // Next 7 days
          }
        })
        .sort({ reminderDate: 1 })
        .populate('propertyId', 'id title')
        .limit(5)
        .lean()
      ]);

      res.status(200).json({
        success: true,
        message: 'Favorite insights retrieved successfully',
        data: {
          overview: {
            totalFavorites,
            priceChanges,
            upcomingReminders: upcomingReminders.length
          },
          distribution: {
            byType: favoritesByType,
            byPriority: favoritesByPriority
          },
          recent: {
            favorites: recentFavorites,
            count: recentFavorites.length
          },
          tags: {
            popular: popularTags,
            totalUniqueTags: popularTags.length
          },
          reminders: {
            upcoming: upcomingReminders,
            count: upcomingReminders.length
          },
          generatedAt: new Date().toISOString()
        }
      });

    } catch (error: any) {
      console.error('Get favorite insights error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve favorite insights',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }
}