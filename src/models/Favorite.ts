import mongoose, { Document, Schema, Model } from 'mongoose';

// Favorite interface for TypeScript
export interface IFavorite extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId; // Reference to User
  propertyId: mongoose.Types.ObjectId; // Reference to Property
  notes?: string; // Optional notes about why they favorited it
  tags: string[]; // User's custom tags for organization
  reminderDate?: Date; // Optional reminder date
  isNotificationEnabled: boolean; // Whether to notify about price changes, etc.
  favoriteType: 'interested' | 'watchlist' | 'shortlisted' | 'considering';
  priority: 'low' | 'medium' | 'high';
  metadata: {
    addedFromPage?: string; // Where they added it from (search, detail, etc.)
    priceWhenAdded?: number; // Price when they favorited it
    lastPriceCheck?: Date; // Last time we checked price changes
    priceChangeCount?: number; // How many times price has changed
    viewCount?: number; // How many times they've viewed this favorite
    lastViewedAt?: Date; // When they last viewed this favorite
  };
  createdAt: Date;
  updatedAt: Date;
  
  // Instance methods
  isPriceChanged(): Promise<boolean>;
  updateViewCount(): Promise<void>;
  addTag(tag: string): Promise<void>;
  removeTag(tag: string): Promise<void>;
  setReminder(date: Date): Promise<void>;
}

// Favorite schema
const FavoriteSchema = new Schema<IFavorite>({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required'],
    index: true
  },
  propertyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
    required: [true, 'Property ID is required'],
    index: true
  },
  notes: {
    type: String,
    trim: true,
    maxlength: [500, 'Notes cannot exceed 500 characters']
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true,
    maxlength: [50, 'Tag cannot exceed 50 characters']
  }],
  reminderDate: {
    type: Date,
    validate: {
      validator: function(date: Date) {
        return !date || date > new Date();
      },
      message: 'Reminder date must be in the future'
    }
  },
  isNotificationEnabled: {
    type: Boolean,
    default: true
  },
  favoriteType: {
    type: String,
    enum: ['interested', 'watchlist', 'shortlisted', 'considering'],
    default: 'interested',
    index: true
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium',
    index: true
  },
  metadata: {
    addedFromPage: {
      type: String,
      trim: true,
      enum: ['search', 'detail', 'recommendations', 'featured', 'list', 'map', 'other'],
      default: 'other'
    },
    priceWhenAdded: {
      type: Number,
      min: [0, 'Price cannot be negative']
    },
    lastPriceCheck: {
      type: Date,
      default: Date.now
    },
    priceChangeCount: {
      type: Number,
      min: [0, 'Price change count cannot be negative'],
      default: 0
    },
    viewCount: {
      type: Number,
      min: [0, 'View count cannot be negative'],
      default: 1
    },
    lastViewedAt: {
      type: Date,
      default: Date.now
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound indexes for better performance
FavoriteSchema.index({ userId: 1, propertyId: 1 }, { unique: true }); // Prevent duplicate favorites
FavoriteSchema.index({ userId: 1, favoriteType: 1 });
FavoriteSchema.index({ userId: 1, priority: 1 });
FavoriteSchema.index({ userId: 1, createdAt: -1 });
FavoriteSchema.index({ reminderDate: 1 });
FavoriteSchema.index({ isNotificationEnabled: 1 });

// Pre-save middleware to set initial price
FavoriteSchema.pre('save', async function(next) {
  if (this.isNew && !this.metadata.priceWhenAdded) {
    try {
      const Property = mongoose.model('Property');
      const property = await Property.findById(this.propertyId).select('price');
      if (property) {
        this.metadata.priceWhenAdded = property.price;
      }
    } catch (error) {
      console.error('Error setting initial price for favorite:', error);
    }
  }
  next();
});

// Post-save middleware to update user stats
FavoriteSchema.post('save', async function(doc) {
  if (doc.isNew) {
    try {
      const User = mongoose.model('User');
      await User.findByIdAndUpdate(
        doc.userId,
        { $inc: { 'stats.favoriteCount': 1 } }
      );
    } catch (error) {
      console.error('Error updating user favorite count:', error);
    }
  }
});

// Post-remove middleware to update user stats
FavoriteSchema.post('deleteOne', { document: true, query: false }, async function(doc) {
  try {
    const User = mongoose.model('User');
    await User.findByIdAndUpdate(
      doc.userId,
      { $inc: { 'stats.favoriteCount': -1 } }
    );
  } catch (error) {
    console.error('Error updating user favorite count on removal:', error);
  }
});

// Instance method to check if price has changed
FavoriteSchema.methods.isPriceChanged = async function(): Promise<boolean> {
  try {
    const Property = mongoose.model('Property');
    const property = await Property.findById(this.propertyId).select('price');
    
    if (!property || !this.metadata.priceWhenAdded) {
      return false;
    }
    
    const hasChanged = property.price !== this.metadata.priceWhenAdded;
    
    if (hasChanged) {
      // Update the metadata
      this.metadata.lastPriceCheck = new Date();
      this.metadata.priceChangeCount = (this.metadata.priceChangeCount || 0) + 1;
      await this.save({ validateBeforeSave: false });
    }
    
    return hasChanged;
  } catch (error) {
    console.error('Error checking price change:', error);
    return false;
  }
};

// Instance method to update view count
FavoriteSchema.methods.updateViewCount = async function(): Promise<void> {
  try {
    this.metadata.viewCount = (this.metadata.viewCount || 0) + 1;
    this.metadata.lastViewedAt = new Date();
    await this.save({ validateBeforeSave: false });
  } catch (error) {
    console.error('Error updating view count:', error);
  }
};

// Instance method to add tag
FavoriteSchema.methods.addTag = async function(tag: string): Promise<void> {
  try {
    const normalizedTag = tag.toLowerCase().trim();
    if (normalizedTag && !this.tags.includes(normalizedTag)) {
      this.tags.push(normalizedTag);
      await this.save();
    }
  } catch (error) {
    console.error('Error adding tag:', error);
    throw error;
  }
};

// Instance method to remove tag
FavoriteSchema.methods.removeTag = async function(tag: string): Promise<void> {
  try {
    const normalizedTag = tag.toLowerCase().trim();
    this.tags = this.tags.filter((t: string) => t !== normalizedTag);
    await this.save();
  } catch (error) {
    console.error('Error removing tag:', error);
    throw error;
  }
};

// Instance method to set reminder
FavoriteSchema.methods.setReminder = async function(date: Date): Promise<void> {
  try {
    if (date <= new Date()) {
      throw new Error('Reminder date must be in the future');
    }
    this.reminderDate = date;
    await this.save();
  } catch (error) {
    console.error('Error setting reminder:', error);
    throw error;
  }
};

// Virtual for property details
FavoriteSchema.virtual('property', {
  ref: 'Property',
  localField: 'propertyId',
  foreignField: '_id',
  justOne: true
});

// Virtual for user details
FavoriteSchema.virtual('user', {
  ref: 'User',
  localField: 'userId',
  foreignField: '_id',
  justOne: true
});

// Virtual for price change percentage
FavoriteSchema.virtual('priceChangePercentage').get(function() {
  if (!this.metadata.priceWhenAdded || !this.populated('property')) {
    return 0;
  }
  
  const property = this.get('property');
  const currentPrice = property?.price || 0;
  const originalPrice = this.metadata.priceWhenAdded;
  
  if (originalPrice === 0) return 0;
  
  return ((currentPrice - originalPrice) / originalPrice) * 100;
});

// Virtual for days since added
FavoriteSchema.virtual('daysSinceAdded').get(function() {
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - this.createdAt.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// Static methods
FavoriteSchema.statics.findByUser = function(userId: mongoose.Types.ObjectId) {
  return this.find({ userId }).populate('propertyId').sort({ createdAt: -1 });
};

FavoriteSchema.statics.findByUserAndType = function(userId: mongoose.Types.ObjectId, favoriteType: string) {
  return this.find({ userId, favoriteType }).populate('propertyId').sort({ createdAt: -1 });
};

FavoriteSchema.statics.findByUserAndPriority = function(userId: mongoose.Types.ObjectId, priority: string) {
  return this.find({ userId, priority }).populate('propertyId').sort({ createdAt: -1 });
};

FavoriteSchema.statics.findWithReminders = function() {
  return this.find({
    reminderDate: { $lte: new Date() },
    isNotificationEnabled: true
  }).populate(['userId', 'propertyId']);
};

FavoriteSchema.statics.findByProperty = function(propertyId: mongoose.Types.ObjectId) {
  return this.find({ propertyId }).populate('userId');
};

FavoriteSchema.statics.getUserFavoriteCount = async function(userId: mongoose.Types.ObjectId): Promise<number> {
  return this.countDocuments({ userId });
};

FavoriteSchema.statics.getPopularProperties = function(limit: number = 10) {
  return this.aggregate([
    {
      $group: {
        _id: '$propertyId',
        favoriteCount: { $sum: 1 },
        lastFavorited: { $max: '$createdAt' }
      }
    },
    {
      $sort: { favoriteCount: -1, lastFavorited: -1 }
    },
    {
      $limit: limit
    },
    {
      $lookup: {
        from: 'properties',
        localField: '_id',
        foreignField: '_id',
        as: 'property'
      }
    },
    {
      $unwind: '$property'
    }
  ]);
};

// Create and export the model
export const Favorite: Model<IFavorite> = mongoose.model<IFavorite>('Favorite', FavoriteSchema);