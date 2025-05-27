import { Request, Response, NextFunction } from 'express';
import { Property, IProperty } from '../models/Property';
import { User } from '../models/User';
import { redisClient } from '../config/redis';
import { config, CACHE_KEYS } from '../config/env';
import mongoose from 'mongoose';

// Interface for query parameters
interface PropertyQueryParams {
  page?: string;
  limit?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';

  // Filtering parameters
  search?: string;
  type?: string;
  listingType?: 'rent' | 'sale';
  minPrice?: string;
  maxPrice?: string;
  state?: string;
  city?: string;
  minArea?: string;
  maxArea?: string;
  bedrooms?: string;
  bathrooms?: string;
  furnished?: string;
  listedBy?: string;
  amenities?: string;
  tags?: string;
  isVerified?: string;
  isFeatured?: string;
  minRating?: string;
  availableFrom?: string;
  availableTo?: string;
}

export class PropertyController {

  // Get all properties with advanced filtering
  static async getProperties(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const {
        page = '1',
        limit = config.DEFAULT_PAGE_SIZE.toString(),
        sortBy = 'createdAt',
        sortOrder = 'desc',
        search,
        type,
        listingType,
        minPrice,
        maxPrice,
        state,
        city,
        minArea,
        maxArea,
        bedrooms,
        bathrooms,
        furnished,
        listedBy,
        amenities,
        tags,
        isVerified,
        isFeatured,
        minRating,
        availableFrom,
        availableTo
      } = req.query as PropertyQueryParams;

      // Pagination
      const pageNum = Math.max(1, parseInt(page));
      const limitNum = Math.min(parseInt(limit), config.MAX_PAGE_SIZE);
      const skip = (pageNum - 1) * limitNum;

      // Build filter query
      const filter: any = { isActive: true };

      // Text search
      if (search) {
        filter.$text = { $search: search };
      }

      // Property type filter
      if (type) {
        filter.type = new RegExp(type, 'i');
      }

      // Listing type filter
      if (listingType) {
        filter.listingType = listingType;
      }

      // Price range filter
      if (minPrice || maxPrice) {
        filter.price = {};
        if (minPrice) filter.price.$gte = parseFloat(minPrice);
        if (maxPrice) filter.price.$lte = parseFloat(maxPrice);
      }

      // Location filters
      if (state) {
        filter['location.state'] = new RegExp(state, 'i');
      }
      if (city) {
        filter['location.city'] = new RegExp(city, 'i');
      }

      // Area filters
      if (minArea || maxArea) {
        filter['specifications.areaSqFt'] = {};
        if (minArea) filter['specifications.areaSqFt'].$gte = parseFloat(minArea);
        if (maxArea) filter['specifications.areaSqFt'].$lte = parseFloat(maxArea);
      }

      // Bedroom/Bathroom filters
      if (bedrooms) {
        filter['specifications.bedrooms'] = parseInt(bedrooms);
      }
      if (bathrooms) {
        filter['specifications.bathrooms'] = parseInt(bathrooms);
      }

      // Furnished filter
      if (furnished) {
        filter.furnished = furnished;
      }

      // Listed by filter
      if (listedBy) {
        filter.listedBy = listedBy;
      }

      // Amenities filter (contains any of the specified amenities)
      if (amenities) {
        const amenitiesArray = amenities.split(',').map(a => a.trim().toLowerCase());
        filter.amenities = { $in: amenitiesArray };
      }

      // Tags filter
      if (tags) {
        const tagsArray = tags.split(',').map(t => t.trim().toLowerCase());
        filter.tags = { $in: tagsArray };
      }

      // Verification filter
      if (isVerified === 'true') {
        filter.isVerified = true;
      }

      // Featured filter
      if (isFeatured === 'true') {
        filter.isFeatured = true;
      }

      // Rating filter
      if (minRating) {
        filter.rating = { $gte: parseFloat(minRating) };
      }

      // Available date range filter
      if (availableFrom || availableTo) {
        filter.availableFrom = {};
        if (availableFrom) filter.availableFrom.$gte = new Date(availableFrom);
        if (availableTo) filter.availableFrom.$lte = new Date(availableTo);
      }

      // Build sort object
      const sortOptions: any = {};

      // Handle text search scoring
      if (search) {
        sortOptions.score = { $meta: 'textScore' };
      }

      // Add primary sort
      if (sortBy === 'price') {
        sortOptions.price = sortOrder === 'asc' ? 1 : -1;
      } else if (sortBy === 'rating') {
        sortOptions.rating = sortOrder === 'asc' ? 1 : -1;
        sortOptions.reviewCount = -1; // Secondary sort by review count
      } else if (sortBy === 'area') {
        sortOptions['specifications.areaSqFt'] = sortOrder === 'asc' ? 1 : -1;
      } else {
        sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;
      }

      // Create cache key for this query
      const cacheKey = `${CACHE_KEYS.PROPERTIES}:${JSON.stringify({
        filter,
        sort: sortOptions,
        page: pageNum,
        limit: limitNum
      })}`;

      // Check cache first
      const cachedResult = await redisClient.getObject(cacheKey);
      if (cachedResult) {
        res.status(200).json(cachedResult);
        return;
      }

      // Execute query
      const [properties, totalCount] = await Promise.all([
        Property.find(filter)
          .sort(sortOptions)
          .skip(skip)
          .limit(limitNum)
          .populate('createdBy', 'firstName lastName email phone')
          .select('-__v')
          .lean()
          .exec(),
        Property.countDocuments(filter)
      ]);

      // Calculate pagination info
      const totalPages = Math.ceil(totalCount / limitNum);
      const hasNextPage = pageNum < totalPages;
      const hasPrevPage = pageNum > 1;

      const result = {
        success: true,
        message: 'Properties retrieved successfully',
        data: {
          properties,
          pagination: {
            currentPage: pageNum,
            totalPages,
            totalCount,
            limit: limitNum,
            hasNextPage,
            hasPrevPage,
            nextPage: hasNextPage ? pageNum + 1 : null,
            prevPage: hasPrevPage ? pageNum - 1 : null
          },
          filters: {
            applied: Object.keys(req.query).length > 4, // More than pagination params
            search: search || null,
            type: type || null,
            listingType: listingType || null,
            priceRange: minPrice || maxPrice ? { min: minPrice, max: maxPrice } : null,
            location: { state: state || null, city: city || null }
          }
        }
      };

      // Cache the result
      await redisClient.set(cacheKey, JSON.stringify(result), config.CACHE_TTL_SHORT);

      res.status(200).json(result);

    } catch (error: any) {
      console.error('Get properties error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve properties',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  // Get single property by ID
  static async getPropertyById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({
          success: false,
          message: 'Invalid property ID format',
          error: 'INVALID_PROPERTY_ID'
        });
        return;
      }

      // Check cache first
      const cacheKey = `${CACHE_KEYS.PROPERTY_DETAIL}:${id}`;
      const cachedProperty = await redisClient.getObject(cacheKey);

      if (cachedProperty) {
        // Increment view count asynchronously (don't wait for it)
        Property.findByIdAndUpdate(id, { $inc: { views: 1 } }, { new: false }).exec();

        res.status(200).json(cachedProperty);
        return;
      }

      // Find property
      const property = await Property.findById(id)
        .populate('createdBy', 'firstName lastName email phone isVerified')
        .exec();

      if (!property) {
        res.status(404).json({
          success: false,
          message: 'Property not found',
          error: 'PROPERTY_NOT_FOUND'
        });
        return;
      }

      if (!property.isActive) {
        res.status(404).json({
          success: false,
          message: 'Property is no longer available',
          error: 'PROPERTY_INACTIVE'
        });
        return;
      }

      // Increment view count
      await property.incrementViews();

      const result = {
        success: true,
        message: 'Property retrieved successfully',
        data: {
          property: property.toJSON()
        }
      };

      // Cache the result
      await redisClient.set(cacheKey, JSON.stringify(result), config.CACHE_TTL_MEDIUM);

      res.status(200).json(result);

    } catch (error: any) {
      console.error('Get property by ID error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve property',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  // Create new property
  static async createProperty(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
          error: 'UNAUTHORIZED'
        });
        return;
      }

      // Create property data
      const propertyData = {
        ...req.body,
        createdBy: req.user._id
      };

      // Handle amenities and tags if they come as strings
      if (typeof propertyData.amenities === 'string') {
        propertyData.amenities = propertyData.amenities.split('|').map((a: string) => a.trim().toLowerCase());
      }

      if (typeof propertyData.tags === 'string') {
        propertyData.tags = propertyData.tags.split('|').map((t: string) => t.trim().toLowerCase());
      }

      // Create new property
      const property = new Property(propertyData);
      await property.save();

      // Update user stats
      await User.findByIdAndUpdate(
        req.user._id,
        { $inc: { 'stats.propertiesListed': 1 } }
      );

      // Clear related caches
      await redisClient.deletePattern(`${CACHE_KEYS.PROPERTIES}:*`);

      // Populate createdBy for response
      await property.populate('createdBy', 'firstName lastName email');

      res.status(201).json({
        success: true,
        message: 'Property created successfully',
        data: {
          property: property.toJSON()
        }
      });

    } catch (error: any) {
      console.error('Create property error:', error);

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
        message: 'Failed to create property',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  // Update property (only by owner)
  static async updateProperty(req: Request, res: Response, next: NextFunction): Promise<void> {
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
          message: 'Invalid property ID format',
          error: 'INVALID_PROPERTY_ID'
        });
        return;
      }

      // Find property
      const property = await Property.findById(id);
      if (!property) {
        res.status(404).json({
          success: false,
          message: 'Property not found',
          error: 'PROPERTY_NOT_FOUND'
        });
        return;
      }

      // Check ownership
      if (!property.isOwnedBy(req.user._id)) {
        res.status(403).json({
          success: false,
          message: 'You can only update your own properties',
          error: 'FORBIDDEN'
        });
        return;
      }

      // Handle amenities and tags if they come as strings
      const updateData = { ...req.body };
      if (typeof updateData.amenities === 'string') {
        updateData.amenities = updateData.amenities.split('|').map((a: string) => a.trim().toLowerCase());
      }

      if (typeof updateData.tags === 'string') {
        updateData.tags = updateData.tags.split('|').map((t: string) => t.trim().toLowerCase());
      }

      // Add updatedBy field
      updateData.updatedBy = req.user._id;

      // Update property
      Object.assign(property, updateData);
      await property.save();

      // Clear related caches
      await Promise.all([
        redisClient.deletePattern(`${CACHE_KEYS.PROPERTIES}:*`),
        redisClient.delete(`${CACHE_KEYS.PROPERTY_DETAIL}:${id}`)
      ]);

      // Populate for response
      await property.populate('createdBy', 'firstName lastName email');

      res.status(200).json({
        success: true,
        message: 'Property updated successfully',
        data: {
          property: property.toJSON()
        }
      });

    } catch (error: any) {
      console.error('Update property error:', error);

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
        message: 'Failed to update property',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  // Delete property (only by owner)
  static async deleteProperty(req: Request, res: Response, next: NextFunction): Promise<void> {
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
          message: 'Invalid property ID format',
          error: 'INVALID_PROPERTY_ID'
        });
        return;
      }

      // Find property
      const property = await Property.findById(id);
      if (!property) {
        res.status(404).json({
          success: false,
          message: 'Property not found',
          error: 'PROPERTY_NOT_FOUND'
        });
        return;
      }

      // Check ownership
      if (!property.isOwnedBy(req.user._id)) {
        res.status(403).json({
          success: false,
          message: 'You can only delete your own properties',
          error: 'FORBIDDEN'
        });
        return;
      }

      // Soft delete (set isActive to false) or hard delete based on preference
      // For this example, we'll do soft delete
      property.isActive = false;
      property.updatedBy = req.user._id;
      await property.save();

      // Update user stats
      await User.findByIdAndUpdate(
        req.user._id,
        { $inc: { 'stats.propertiesListed': -1 } }
      );

      // Clear related caches
      await Promise.all([
        redisClient.deletePattern(`${CACHE_KEYS.PROPERTIES}:*`),
        redisClient.delete(`${CACHE_KEYS.PROPERTY_DETAIL}:${id}`)
      ]);

      res.status(200).json({
        success: true,
        message: 'Property deleted successfully'
      });

    } catch (error: any) {
      console.error('Delete property error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete property',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  // Get user's properties
  static async getMyProperties(req: Request, res: Response, next: NextFunction): Promise<void> {
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
        status = 'all' // all, active, inactive
      } = req.query as any;

      const pageNum = Math.max(1, parseInt(page));
      const limitNum = Math.min(parseInt(limit), config.MAX_PAGE_SIZE);
      const skip = (pageNum - 1) * limitNum;

      // Build filter for user's properties
      const filter: any = { createdBy: req.user._id };

      if (status === 'active') {
        filter.isActive = true;
      } else if (status === 'inactive') {
        filter.isActive = false;
      }

      // Get properties and count
      const [properties, totalCount] = await Promise.all([
        Property.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .select('-__v')
          .lean()
          .exec(),
        Property.countDocuments(filter)
      ]);

      // Calculate pagination
      const totalPages = Math.ceil(totalCount / limitNum);

      res.status(200).json({
        success: true,
        message: 'Your properties retrieved successfully',
        data: {
          properties,
          pagination: {
            currentPage: pageNum,
            totalPages,
            totalCount,
            limit: limitNum,
            hasNextPage: pageNum < totalPages,
            hasPrevPage: pageNum > 1
          },
          summary: {
            total: totalCount,
            active: status === 'all' ? await Property.countDocuments({ createdBy: req.user._id, isActive: true }) : null,
            inactive: status === 'all' ? await Property.countDocuments({ createdBy: req.user._id, isActive: false }) : null
          }
        }
      });

    } catch (error: any) {
      console.error('Get my properties error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve your properties',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  // Get featured properties
  static async getFeaturedProperties(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { limit = '10' } = req.query as any;
      const limitNum = Math.min(parseInt(limit), 50);

      const cacheKey = `${CACHE_KEYS.PROPERTIES}:featured:${limitNum}`;
      const cachedResult = await redisClient.getObject(cacheKey);

      if (cachedResult) {
        res.status(200).json(cachedResult);
        return;
      }

      // Use a standard query for featured properties since findFeatured does not exist
      const properties = await Property.find({ isFeatured: true, isActive: true })
        .limit(limitNum)
        .populate('createdBy', 'firstName lastName')
        .lean()
        .exec();

      const result = {
        success: true,
        message: 'Featured properties retrieved successfully',
        data: {
          properties,
          count: properties.length
        }
      };

      // Cache for longer since featured properties don't change often
      await redisClient.set(cacheKey, JSON.stringify(result), config.CACHE_TTL_LONG);

      res.status(200).json(result);

    } catch (error: any) {
      console.error('Get featured properties error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve featured properties',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  // Search properties with advanced options
  static async searchProperties(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { query } = req.body;

      if (!query || query.trim().length === 0) {
        res.status(400).json({
          success: false,
          message: 'Search query is required',
          error: 'MISSING_SEARCH_QUERY'
        });
        return;
      }

      const cacheKey = `${CACHE_KEYS.SEARCH_RESULTS}:${JSON.stringify(query)}`;
      const cachedResult = await redisClient.getObject(cacheKey);

      if (cachedResult) {
        res.status(200).json(cachedResult);
        return;
      }

      // Perform text search
      const properties = await Property.find({
        $text: { $search: query },
        isActive: true
      })
        .sort({ score: { $meta: 'textScore' }, rating: -1 })
        .limit(50)
        .populate('createdBy', 'firstName lastName')
        .lean()
        .exec();

      const result = {
        success: true,
        message: 'Search completed successfully',
        data: {
          query,
          properties,
          count: properties.length,
          searchTime: new Date().toISOString()
        }
      };

      // Cache search results
      await redisClient.set(cacheKey, JSON.stringify(result), config.CACHE_TTL_SHORT);

      res.status(200).json(result);

    } catch (error: any) {
      console.error('Search properties error:', error);
      res.status(500).json({
        success: false,
        message: 'Search failed',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }

  // Get property statistics
  static async getPropertyStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cacheKey = `${CACHE_KEYS.PROPERTY_STATS}:general`;
      const cachedStats = await redisClient.getObject(cacheKey);

      if (cachedStats) {
        res.status(200).json(cachedStats);
        return;
      }

      // Aggregate statistics
      const [
        totalProperties,
        activeProperties,
        verifiedProperties,
        featuredProperties,
        typeStats,
        locationStats,
        priceStats
      ] = await Promise.all([
        Property.countDocuments({}),
        Property.countDocuments({ isActive: true }),
        Property.countDocuments({ isVerified: true, isActive: true }),
        Property.countDocuments({ isFeatured: true, isActive: true }),

        // Properties by type
        Property.aggregate([
          { $match: { isActive: true } },
          { $group: { _id: '$type', count: { $sum: 1 } } },
          { $sort: { count: -1 } }
        ]),

        // Properties by location (top cities)
        Property.aggregate([
          { $match: { isActive: true } },
          { $group: { _id: '$location.city', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 }
        ]),

        // Price statistics
        Property.aggregate([
          { $match: { isActive: true } },
          {
            $group: {
              _id: null,
              avgPrice: { $avg: '$price' },
              minPrice: { $min: '$price' },
              maxPrice: { $max: '$price' }
            }
          }
        ])
      ]);

      const result = {
        success: true,
        message: 'Property statistics retrieved successfully',
        data: {
          overview: {
            totalProperties,
            activeProperties,
            verifiedProperties,
            featuredProperties,
            activePercentage: totalProperties > 0 ? ((activeProperties / totalProperties) * 100).toFixed(1) : 0
          },
          typeDistribution: typeStats,
          topLocations: locationStats,
          priceStats: priceStats[0] || { avgPrice: 0, minPrice: 0, maxPrice: 0 },
          lastUpdated: new Date().toISOString()
        }
      };

      // Cache stats for a longer time
      await redisClient.set(cacheKey, JSON.stringify(result), config.CACHE_TTL_LONG);

      res.status(200).json(result);

    } catch (error: any) {
      console.error('Get property stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve property statistics',
        error: 'INTERNAL_SERVER_ERROR'
      });
    }
  }
}