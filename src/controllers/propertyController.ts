import { Response } from 'express';
import { Property } from '../models/Property';
import { AuthRequest, PropertyQuery } from '../types';
import { CacheService } from '../services/cacheService';
import Joi from 'joi';

const propertySchema = Joi.object({
  id: Joi.string().required(),
  title: Joi.string().required(),
  type: Joi.string().valid('Apartment', 'Villa', 'Bungalow', 'Plot', 'House', 'Commercial').required(),
  price: Joi.number().min(0).required(),
  state: Joi.string().required(),
  city: Joi.string().required(),
  areaSqFt: Joi.number().min(0).required(),
  bedrooms: Joi.number().min(0).required(),
  bathrooms: Joi.number().min(0).required(),
  amenities: Joi.string().default(''),
  furnished: Joi.string().valid('Furnished', 'Semi-Furnished', 'Unfurnished').default('Unfurnished'),
  availableFrom: Joi.date().required(),
  listedBy: Joi.string().valid('Owner', 'Dealer', 'Builder').required(),
  tags: Joi.string().default(''),
  colorTheme: Joi.string().default('#000000'),
  rating: Joi.number().min(0).max(5).default(0),
  isVerified: Joi.boolean().default(false),
  listingType: Joi.string().valid('rent', 'sale').required()
});

export const propertyController = {
  create: async (req: AuthRequest, res: Response) => {
    try {
      const { error, value } = propertySchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const existingProperty = await Property.findOne({ id: value.id });
      if (existingProperty) {
        return res.status(400).json({ error: 'Property with this ID already exists' });
      }

      const property = new Property({
        ...value,
        createdBy: req.user!._id
      });

      await property.save();
      
      // Clear cache
      await CacheService.delPattern('properties:*');

      res.status(201).json({
        message: 'Property created successfully',
        property
      });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  getAll: async (req: AuthRequest, res: Response) => {
    try {
      const query: PropertyQuery = req.query as any;
      const page = parseInt(query.page as string) || 1;
      const limit = parseInt(query.limit as string) || 10;
      const skip = (page - 1) * limit;

      // Build cache key
      const cacheKey = `properties:${JSON.stringify(query)}`;
      
      // Try to get from cache first
      const cachedData = await CacheService.get(cacheKey);
      if (cachedData) {
        return res.json(cachedData);
      }

      // Build filter object
      const filter: any = {};
      
      if (query.type) filter.type = query.type;
      if (query.state) filter.state = new RegExp(query.state, 'i');
      if (query.city) filter.city = new RegExp(query.city, 'i');
      if (query.listingType) filter.listingType = query.listingType;
      if (query.furnished) filter.furnished = query.furnished;
      if (query.bedrooms) filter.bedrooms = query.bedrooms;
      if (query.bathrooms) filter.bathrooms = query.bathrooms;
      if (query.isVerified !== undefined) filter.isVerified = query.isVerified;
      
      if (query.minPrice || query.maxPrice) {
        filter.price = {};
        if (query.minPrice) filter.price.$gte = query.minPrice;
        if (query.maxPrice) filter.price.$lte = query.maxPrice;
      }

      if (query.amenities && query.amenities.length > 0) {
        const amenityRegex = query.amenities.map(a => new RegExp(a, 'i'));
        filter.amenities = { $regex: amenityRegex.join('|') };
      }

      if (query.tags && query.tags.length > 0) {
        const tagRegex = query.tags.map(t => new RegExp(t, 'i'));
        filter.tags = { $regex: tagRegex.join('|') };
      }

      // Build sort object
      const sort: any = {};
      if (query.sortBy) {
        sort[query.sortBy] = query.sortOrder === 'desc' ? -1 : 1;
      } else {
        sort.createdAt = -1;
      }

      const properties = await Property.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .populate('createdBy', 'firstName lastName email');

      const total = await Property.countDocuments(filter);

      const result = {
        properties,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };

      // Cache the result
      await CacheService.set(cacheKey, result, 300); // 5 minutes

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  getById: async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      
      const cacheKey = `property:${id}`;
      const cachedProperty = await CacheService.get(cacheKey);
      
      if (cachedProperty) {
        return res.json(cachedProperty);
      }

      const property = await Property.findById(id)
        .populate('createdBy', 'firstName lastName email');

      if (!property) {
        return res.status(404).json({ error: 'Property not found' });
      }

      await CacheService.set(cacheKey, property, 600); // 10 minutes

      res.json(property);
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  update: async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      
      const property = await Property.findById(id);
      if (!property) {
        return res.status(404).json({ error: 'Property not found' });
      }

      // Check if user owns the property
      if (property.createdBy.toString() !== req.user!._id.toString()) {
        return res.status(403).json({ error: 'You can only update your own properties' });
      }

      const { error, value } = propertySchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      // Check if new ID conflicts with existing property
      if (value.id !== property.id) {
        const existingProperty = await Property.findOne({ id: value.id });
        if (existingProperty) {
          return res.status(400).json({ error: 'Property with this ID already exists' });
        }
      }

      const updatedProperty = await Property.findByIdAndUpdate(
        id,
        value,
        { new: true, runValidators: true }
      ).populate('createdBy', 'firstName lastName email');

      // Clear cache
      await CacheService.del(`property:${id}`);
      await CacheService.delPattern('properties:*');

      res.json({
        message: 'Property updated successfully',
        property: updatedProperty
      });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  delete: async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      
      const property = await Property.findById(id);
      if (!property) {
        return res.status(404).json({ error: 'Property not found' });
      }

      // Check if user owns the property
      if (property.createdBy.toString() !== req.user!._id.toString()) {
        return res.status(403).json({ error: 'You can only delete your own properties' });
      }

      await Property.findByIdAndDelete(id);

      // Clear cache
      await CacheService.del(`property:${id}`);
      await CacheService.delPattern('properties:*');

      res.json({ message: 'Property deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  getMyProperties: async (req: AuthRequest, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;

      const properties = await Property.find({ createdBy: req.user!._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const total = await Property.countDocuments({ createdBy: req.user!._id });

      res.json({
        properties,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
};