import { Response } from 'express';
import { Favorite } from '../models/Favorite';
import { Property } from '../models/Property';
import { AuthRequest } from '../types';
import { CacheService } from '../services/cacheService';
import { isValidObjectId } from '../utils/helpers';

export const favoriteController = {
  // Add property to favorites
  add: async (req: AuthRequest, res: Response) => {
    try {
      const { propertyId } = req.body;
      
      if (!propertyId) {
        return res.status(400).json({ error: 'Property ID is required' });
      }

      // Validate ObjectId format
      if (!isValidObjectId(propertyId)) {
        return res.status(400).json({ error: 'Invalid property ID format' });
      }

      // Check if property exists
      const property = await Property.findById(propertyId);
      if (!property) {
        return res.status(404).json({ error: 'Property not found' });
      }

      // Check if already in favorites
      const existingFavorite = await Favorite.findOne({
        userId: req.user!._id,
        propertyId
      });

      if (existingFavorite) {
        return res.status(400).json({ error: 'Property already in favorites' });
      }

      // Create new favorite
      const favorite = new Favorite({
        userId: req.user!._id,
        propertyId
      });

      await favorite.save();

      // Clear user's favorites cache
      await CacheService.del(`favorites:${req.user!._id}`);

      // Populate property details for response
      await favorite.populate('propertyId', 'title type price city state listingType');

      res.status(201).json({
        message: 'Property added to favorites successfully',
        favorite
      });
    } catch (error) {
      console.error('Add to favorites error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Remove property from favorites
  remove: async (req: AuthRequest, res: Response) => {
    try {
      const { propertyId } = req.params;

      if (!propertyId) {
        return res.status(400).json({ error: 'Property ID is required' });
      }

      // Validate ObjectId format
      if (!isValidObjectId(propertyId)) {
        return res.status(400).json({ error: 'Invalid property ID format' });
      }

      // Find and remove favorite
      const favorite = await Favorite.findOne({
        userId: req.user!._id,
        propertyId
      });

      if (!favorite) {
        return res.status(404).json({ error: 'Property not found in favorites' });
      }

      await Favorite.findByIdAndDelete(favorite._id);

      // Clear user's favorites cache
      await CacheService.del(`favorites:${req.user!._id}`);

      res.json({ 
        message: 'Property removed from favorites successfully',
        propertyId 
      });
    } catch (error) {
      console.error('Remove from favorites error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Get all user favorites
  getAll: async (req: AuthRequest, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;

      // Validate pagination parameters
      if (page < 1 || limit < 1 || limit > 100) {
        return res.status(400).json({ error: 'Invalid pagination parameters' });
      }

      // Check cache first
      const cacheKey = `favorites:${req.user!._id}:page:${page}:limit:${limit}`;
      const cachedFavorites = await CacheService.get(cacheKey);
      
      if (cachedFavorites) {
        return res.json(cachedFavorites);
      }

      // Get favorites with property details
      const favorites = await Favorite.find({ userId: req.user!._id })
        .populate({
          path: 'propertyId',
          select: 'id title type price state city areaSqFt bedrooms bathrooms furnished listingType rating isVerified colorTheme availableFrom createdAt',
          populate: {
            path: 'createdBy',
            select: 'firstName lastName email'
          }
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      // Filter out favorites where property might have been deleted
      const validFavorites = favorites.filter(fav => fav.propertyId);

      const total = await Favorite.countDocuments({ userId: req.user!._id });

      const result = {
        favorites: validFavorites,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
          hasNextPage: page < Math.ceil(total / limit),
          hasPrevPage: page > 1
        }
      };

      // Cache the result for 5 minutes
      await CacheService.set(cacheKey, result, 300);

      res.json(result);
    } catch (error) {
      console.error('Get favorites error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Check if property is in user's favorites
  checkFavorite: async (req: AuthRequest, res: Response) => {
    try {
      const { propertyId } = req.params;

      if (!propertyId) {
        return res.status(400).json({ error: 'Property ID is required' });
      }

      // Validate ObjectId format
      if (!isValidObjectId(propertyId)) {
        return res.status(400).json({ error: 'Invalid property ID format' });
      }

      const favorite = await Favorite.findOne({
        userId: req.user!._id,
        propertyId
      });

      res.json({
        isFavorite: !!favorite,
        favoriteId: favorite?._id || null
      });
    } catch (error) {
      console.error('Check favorite error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Get favorite statistics for user
  getStats: async (req: AuthRequest, res: Response) => {
    try {
      const cacheKey = `favorite_stats:${req.user!._id}`;
      const cachedStats = await CacheService.get(cacheKey);
      
      if (cachedStats) {
        return res.json(cachedStats);
      }

      // Get total favorites count
      const totalFavorites = await Favorite.countDocuments({ userId: req.user!._id });

      // Get favorites by property type
      const favoritesByType = await Favorite.aggregate([
        { $match: { userId: req.user!._id } },
        {
          $lookup: {
            from: 'properties',
            localField: 'propertyId',
            foreignField: '_id',
            as: 'property'
          }
        },
        { $unwind: '$property' },
        {
          $group: {
            _id: '$property.type',
            count: { $sum: 1 }
          }
        },
        {
          $project: {
            type: '$_id',
            count: 1,
            _id: 0
          }
        }
      ]);

      // Get favorites by listing type
      const favoritesByListingType = await Favorite.aggregate([
        { $match: { userId: req.user!._id } },
        {
          $lookup: {
            from: 'properties',
            localField: 'propertyId',
            foreignField: '_id',
            as: 'property'
          }
        },
        { $unwind: '$property' },
        {
          $group: {
            _id: '$property.listingType',
            count: { $sum: 1 }
          }
        },
        {
          $project: {
            listingType: '$_id',
            count: 1,
            _id: 0
          }
        }
      ]);

      // Get recent favorites (last 5)
      const recentFavorites = await Favorite.find({ userId: req.user!._id })
        .populate('propertyId', 'title type price city state listingType')
        .sort({ createdAt: -1 })
        .limit(5);

      const stats = {
        totalFavorites,
        favoritesByType,
        favoritesByListingType,
        recentFavorites: recentFavorites.filter(fav => fav.propertyId)
      };

      // Cache stats for 10 minutes
      await CacheService.set(cacheKey, stats, 600);

      res.json(stats);
    } catch (error) {
      console.error('Get favorite stats error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Bulk add properties to favorites
  bulkAdd: async (req: AuthRequest, res: Response) => {
    try {
      const { propertyIds } = req.body;

      if (!propertyIds || !Array.isArray(propertyIds) || propertyIds.length === 0) {
        return res.status(400).json({ error: 'Property IDs array is required' });
      }

      if (propertyIds.length > 50) {
        return res.status(400).json({ error: 'Cannot add more than 50 properties at once' });
      }

      // Validate all property IDs
      for (const id of propertyIds) {
        if (!isValidObjectId(id)) {
          return res.status(400).json({ error: `Invalid property ID format: ${id}` });
        }
      }

      // Check which properties exist
      const existingProperties = await Property.find({
        _id: { $in: propertyIds }
      }).select('_id');

      const existingPropertyIds = existingProperties.map(p => p._id.toString());
      const invalidIds = propertyIds.filter(id => !existingPropertyIds.includes(id));

      if (invalidIds.length > 0) {
        return res.status(404).json({ 
          error: 'Some properties not found',
          invalidIds 
        });
      }

      // Check which properties are already in favorites
      const existingFavorites = await Favorite.find({
        userId: req.user!._id,
        propertyId: { $in: propertyIds }
      }).select('propertyId');

      const alreadyFavoriteIds = existingFavorites.map(f => f.propertyId.toString());
      const newFavoriteIds = propertyIds.filter(id => !alreadyFavoriteIds.includes(id));

      if (newFavoriteIds.length === 0) {
        return res.status(400).json({ error: 'All properties are already in favorites' });
      }

      // Create new favorites
      const newFavorites = newFavoriteIds.map(propertyId => ({
        userId: req.user!._id,
        propertyId
      }));

      const createdFavorites = await Favorite.insertMany(newFavorites);

      // Clear user's favorites cache
      await CacheService.delPattern(`favorites:${req.user!._id}*`);

      res.status(201).json({
        message: `${createdFavorites.length} properties added to favorites`,
        addedCount: createdFavorites.length,
        skippedCount: alreadyFavoriteIds.length,
        alreadyFavoriteIds
      });
    } catch (error) {
      console.error('Bulk add favorites error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Bulk remove properties from favorites
  bulkRemove: async (req: AuthRequest, res: Response) => {
    try {
      const { propertyIds } = req.body;

      if (!propertyIds || !Array.isArray(propertyIds) || propertyIds.length === 0) {
        return res.status(400).json({ error: 'Property IDs array is required' });
      }

      if (propertyIds.length > 50) {
        return res.status(400).json({ error: 'Cannot remove more than 50 properties at once' });
      }

      // Validate all property IDs
      for (const id of propertyIds) {
        if (!isValidObjectId(id)) {
          return res.status(400).json({ error: `Invalid property ID format: ${id}` });
        }
      }

      const result = await Favorite.deleteMany({
        userId: req.user!._id,
        propertyId: { $in: propertyIds }
      });

      // Clear user's favorites cache
      await CacheService.delPattern(`favorites:${req.user!._id}*`);

      res.json({
        message: `${result.deletedCount} properties removed from favorites`,
        removedCount: result.deletedCount
      });
    } catch (error) {
      console.error('Bulk remove favorites error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Clear all favorites for user
  clearAll: async (req: AuthRequest, res: Response) => {
    try {
      const result = await Favorite.deleteMany({ userId: req.user!._id });

      // Clear user's favorites cache
      await CacheService.delPattern(`favorites:${req.user!._id}*`);

      res.json({
        message: 'All favorites cleared successfully',
        removedCount: result.deletedCount
      });
    } catch (error) {
      console.error('Clear all favorites error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
};