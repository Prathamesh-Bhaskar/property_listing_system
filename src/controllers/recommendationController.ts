import { Response } from 'express';
import { Recommendation } from '../models/Recommendation';
import { Property } from '../models/Property';
import { User } from '../models/User';
import { AuthRequest } from '../types';
import Joi from 'joi';

const recommendSchema = Joi.object({
  recipientEmail: Joi.string().email().required(),
  propertyId: Joi.string().required(),
  message: Joi.string().max(500).optional()
});

export const recommendationController = {
  send: async (req: AuthRequest, res: Response) => {
    try {
      const { error, value } = recommendSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const { recipientEmail, propertyId, message } = value;

      // Find recipient user
      const recipient = await User.findOne({ email: recipientEmail });
      if (!recipient) {
        return res.status(404).json({ error: 'Recipient user not found' });
      }

      // Check if property exists
      const property = await Property.findById(propertyId);
      if (!property) {
        return res.status(404).json({ error: 'Property not found' });
      }

      // Check if recommendation already exists
      const existingRecommendation = await Recommendation.findOne({
        fromUserId: req.user!._id,
        toUserId: recipient._id,
        propertyId
      });

      if (existingRecommendation) {
        return res.status(400).json({ error: 'Property already recommended to this user' });
      }

      const recommendation = new Recommendation({
        fromUserId: req.user!._id,
        toUserId: recipient._id,
        propertyId,
        message
      });

      await recommendation.save();

      // Populate for response
      await recommendation.populate('fromUserId', 'firstName lastName email');
      await recommendation.populate('propertyId', 'title type price city state');

      res.status(201).json({
        message: 'Property recommended successfully',
        recommendation
      });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  getReceived: async (req: AuthRequest, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;

      const recommendations = await Recommendation.find({ toUserId: req.user!._id })
        .populate('fromUserId', 'firstName lastName email')
        .populate('propertyId')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const total = await Recommendation.countDocuments({ toUserId: req.user!._id });

      res.json({
        recommendations,
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
  },

  getSent: async (req: AuthRequest, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;

      const recommendations = await Recommendation.find({ fromUserId: req.user!._id })
        .populate('toUserId', 'firstName lastName email')
        .populate('propertyId')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const total = await Recommendation.countDocuments({ fromUserId: req.user!._id });

      res.json({
        recommendations,
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
  },

  markAsRead: async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;

      const recommendation = await Recommendation.findOne({
        _id: id,
        toUserId: req.user!._id
      });

      if (!recommendation) {
        return res.status(404).json({ error: 'Recommendation not found' });
      }

      recommendation.isRead = true;
      await recommendation.save();

      res.json({ message: 'Recommendation marked as read' });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  searchUsers: async (req: AuthRequest, res: Response) => {
    try {
      const { email } = req.query;
      
      if (!email) {
        return res.status(400).json({ error: 'Email query parameter is required' });
      }

      const users = await User.find({
        email: { $regex: email, $options: 'i' },
        _id: { $ne: req.user!._id } // Exclude current user
      })
      .select('firstName lastName email')
      .limit(10);

      res.json({ users });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
};