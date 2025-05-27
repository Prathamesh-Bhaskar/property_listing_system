import mongoose, { Document, Schema, Model } from 'mongoose';

// Recommendation interface for TypeScript
export interface IRecommendation extends Document {
  _id: mongoose.Types.ObjectId;
  senderId: mongoose.Types.ObjectId; // User who is recommending
  recipientId: mongoose.Types.ObjectId; // User who is receiving the recommendation
  propertyId: mongoose.Types.ObjectId; // Property being recommended
  message?: string; // Optional personal message from sender
  subject?: string; // Optional subject line
  status: 'pending' | 'viewed' | 'interested' | 'not_interested' | 'contacted' | 'dismissed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  category: 'suggestion' | 'perfect_match' | 'similar_interest' | 'price_drop' | 'new_listing' | 'general';
  
  // Interaction tracking
  interactions: {
    sentAt: Date;
    viewedAt?: Date;
    respondedAt?: Date;
    contactedAt?: Date;
    dismissedAt?: Date;
    reminderSentAt?: Date;
    reminderCount: number;
  };
  
  // Metadata for analytics and personalization
  metadata: {
    senderReason?: string; // Why the sender recommended this
    matchScore?: number; // AI/algorithm match score (0-100)
    commonInterests?: string[]; // Common interests between sender and recipient
    similarProperties?: mongoose.Types.ObjectId[]; // Similar properties recipient has viewed
    priceRange?: {
      min: number;
      max: number;
    };
    location?: {
      city: string;
      state: string;
    };
    tags?: string[]; // Tags that made this a good recommendation
  };
  
  // Communication settings
  communication: {
    allowFollowUp: boolean; // Whether sender allows follow-up questions
    hideFromSender: boolean; // Whether recipient wants to hide their response from sender
    allowReminders: boolean; // Whether to send reminder notifications
    preferredContactMethod?: 'email' | 'in_app' | 'phone';
  };
  
  // Tracking fields
  isActive: boolean; // Whether recommendation is still active
  expiresAt?: Date; // Optional expiration date
  createdAt: Date;
  updatedAt: Date;
  
  // Instance methods
  markAsViewed(): Promise<void>;
  markAsInterested(): Promise<void>;
  markAsNotInterested(): Promise<void>;
  markAsContacted(): Promise<void>;
  markAsDismissed(): Promise<void>;
  sendReminder(): Promise<boolean>;
  isExpired(): boolean;
  canSendReminder(): boolean;
  getInteractionStatus(): string;
}

// Recommendation schema
const RecommendationSchema = new Schema<IRecommendation>({
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Sender ID is required'],
    index: true
  },
  recipientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Recipient ID is required'],
    index: true
  },
  propertyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
    required: [true, 'Property ID is required'],
    index: true
  },
  message: {
    type: String,
    trim: true,
    maxlength: [1000, 'Message cannot exceed 1000 characters']
  },
  subject: {
    type: String,
    trim: true,
    maxlength: [200, 'Subject cannot exceed 200 characters']
  },
  status: {
    type: String,
    enum: ['pending', 'viewed', 'interested', 'not_interested', 'contacted', 'dismissed'],
    default: 'pending',
    index: true
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium',
    index: true
  },
  category: {
    type: String,
    enum: ['suggestion', 'perfect_match', 'similar_interest', 'price_drop', 'new_listing', 'general'],
    default: 'general',
    index: true
  },
  interactions: {
    sentAt: {
      type: Date,
      default: Date.now,
      required: true
    },
    viewedAt: {
      type: Date,
      default: null
    },
    respondedAt: {
      type: Date,
      default: null
    },
    contactedAt: {
      type: Date,
      default: null
    },
    dismissedAt: {
      type: Date,
      default: null
    },
    reminderSentAt: {
      type: Date,
      default: null
    },
    reminderCount: {
      type: Number,
      min: [0, 'Reminder count cannot be negative'],
      default: 0
    }
  },
  metadata: {
    senderReason: {
      type: String,
      trim: true,
      maxlength: [500, 'Sender reason cannot exceed 500 characters']
    },
    matchScore: {
      type: Number,
      min: [0, 'Match score cannot be less than 0'],
      max: [100, 'Match score cannot be more than 100']
    },
    commonInterests: [{
      type: String,
      trim: true,
      lowercase: true
    }],
    similarProperties: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property'
    }],
    priceRange: {
      min: {
        type: Number,
        min: [0, 'Minimum price cannot be negative']
      },
      max: {
        type: Number,
        min: [0, 'Maximum price cannot be negative']
      }
    },
    location: {
      city: {
        type: String,
        trim: true
      },
      state: {
        type: String,
        trim: true
      }
    },
    tags: [{
      type: String,
      trim: true,
      lowercase: true
    }]
  },
  communication: {
    allowFollowUp: {
      type: Boolean,
      default: true
    },
    hideFromSender: {
      type: Boolean,
      default: false
    },
    allowReminders: {
      type: Boolean,
      default: true
    },
    preferredContactMethod: {
      type: String,
      enum: ['email', 'in_app', 'phone'],
      default: 'in_app'
    }
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  expiresAt: {
    type: Date,
    validate: {
      validator: function(date: Date) {
        return !date || date > new Date();
      },
      message: 'Expiration date must be in the future'
    },
    index: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound indexes for better performance
RecommendationSchema.index({ recipientId: 1, status: 1 });
RecommendationSchema.index({ senderId: 1, createdAt: -1 });
RecommendationSchema.index({ recipientId: 1, createdAt: -1 });
RecommendationSchema.index({ propertyId: 1, recipientId: 1 });
RecommendationSchema.index({ expiresAt: 1 }, { sparse: true });
RecommendationSchema.index({ 'interactions.viewedAt': 1 }, { sparse: true });

// Prevent duplicate recommendations (same sender, recipient, property)
RecommendationSchema.index(
  { senderId: 1, recipientId: 1, propertyId: 1 },
  { 
    unique: true,
    partialFilterExpression: { isActive: true }
  }
);

// Pre-save middleware
RecommendationSchema.pre('save', async function(next) {
  // Set default expiration (30 days from now) if not provided
  if (this.isNew && !this.expiresAt) {
    this.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }
  
  // Update user stats
  if (this.isNew) {
    try {
      const User = mongoose.model('User');
      await User.findByIdAndUpdate(
        this.senderId,
        { $inc: { 'stats.recommendationsSent': 1 } }
      );
      await User.findByIdAndUpdate(
        this.recipientId,
        { $inc: { 'stats.recommendationsReceived': 1 } }
      );
    } catch (error) {
      console.error('Error updating user recommendation stats:', error);
    }
  }
  
  next();
});

// Instance method to mark as viewed
RecommendationSchema.methods.markAsViewed = async function(): Promise<void> {
  if (!this.interactions.viewedAt) {
    this.interactions.viewedAt = new Date();
    this.status = 'viewed';
    await this.save({ validateBeforeSave: false });
  }
};

// Instance method to mark as interested
RecommendationSchema.methods.markAsInterested = async function(): Promise<void> {
  this.status = 'interested';
  this.interactions.respondedAt = new Date();
  if (!this.interactions.viewedAt) {
    this.interactions.viewedAt = new Date();
  }
  await this.save();
};

// Instance method to mark as not interested
RecommendationSchema.methods.markAsNotInterested = async function(): Promise<void> {
  this.status = 'not_interested';
  this.interactions.respondedAt = new Date();
  if (!this.interactions.viewedAt) {
    this.interactions.viewedAt = new Date();
  }
  await this.save();
};

// Instance method to mark as contacted
RecommendationSchema.methods.markAsContacted = async function(): Promise<void> {
  this.status = 'contacted';
  this.interactions.contactedAt = new Date();
  this.interactions.respondedAt = new Date();
  if (!this.interactions.viewedAt) {
    this.interactions.viewedAt = new Date();
  }
  await this.save();
};

// Instance method to mark as dismissed
RecommendationSchema.methods.markAsDismissed = async function(): Promise<void> {
  this.status = 'dismissed';
  this.interactions.dismissedAt = new Date();
  this.isActive = false;
  await this.save();
};

// Instance method to send reminder
RecommendationSchema.methods.sendReminder = async function(): Promise<boolean> {
  if (!this.canSendReminder()) {
    return false;
  }
  
  try {
    this.interactions.reminderSentAt = new Date();
    this.interactions.reminderCount += 1;
    await this.save({ validateBeforeSave: false });
    
    // Here you would integrate with your notification service
    // await notificationService.sendRecommendationReminder(this);
    
    return true;
  } catch (error) {
    console.error('Error sending reminder:', error);
    return false;
  }
};

// Instance method to check if expired
RecommendationSchema.methods.isExpired = function(): boolean {
  return this.expiresAt ? this.expiresAt < new Date() : false;
};

// Instance method to check if can send reminder
RecommendationSchema.methods.canSendReminder = function(): boolean {
  if (!this.communication.allowReminders || this.status !== 'pending' || this.isExpired()) {
    return false;
  }
  
  // Don't send more than 3 reminders
  if (this.interactions.reminderCount >= 3) {
    return false;
  }
  
  // Don't send reminder if one was sent in the last 3 days
  if (this.interactions.reminderSentAt) {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    if (this.interactions.reminderSentAt > threeDaysAgo) {
      return false;
    }
  }
  
  return true;
};

// Instance method to get interaction status
RecommendationSchema.methods.getInteractionStatus = function(): string {
  if (this.interactions.contactedAt) return 'contacted';
  if (this.interactions.dismissedAt) return 'dismissed';
  if (this.interactions.respondedAt) return 'responded';
  if (this.interactions.viewedAt) return 'viewed';
  return 'sent';
};

// Virtual for sender details
RecommendationSchema.virtual('sender', {
  ref: 'User',
  localField: 'senderId',
  foreignField: '_id',
  justOne: true
});

// Virtual for recipient details
RecommendationSchema.virtual('recipient', {
  ref: 'User',
  localField: 'recipientId',
  foreignField: '_id',
  justOne: true
});

// Virtual for property details
RecommendationSchema.virtual('property', {
  ref: 'Property',
  localField: 'propertyId',
  foreignField: '_id',
  justOne: true
});

// Virtual for days since sent
RecommendationSchema.virtual('daysSinceSent').get(function() {
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - this.interactions.sentAt.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// Virtual for response time in hours
RecommendationSchema.virtual('responseTimeHours').get(function() {
  if (!this.interactions.respondedAt) return null;
  
  const diffTime = this.interactions.respondedAt.getTime() - this.interactions.sentAt.getTime();
  return Math.round(diffTime / (1000 * 60 * 60));
});

// Static methods
RecommendationSchema.statics.findBySender = function(senderId: mongoose.Types.ObjectId) {
  return this.find({ senderId, isActive: true })
    .populate(['recipientId', 'propertyId'])
    .sort({ createdAt: -1 });
};

RecommendationSchema.statics.findByRecipient = function(recipientId: mongoose.Types.ObjectId) {
  return this.find({ recipientId, isActive: true })
    .populate(['senderId', 'propertyId'])
    .sort({ createdAt: -1 });
};

RecommendationSchema.statics.findPendingByRecipient = function(recipientId: mongoose.Types.ObjectId) {
  return this.find({ 
    recipientId, 
    status: 'pending', 
    isActive: true,
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: { $gt: new Date() } }
    ]
  })
  .populate(['senderId', 'propertyId'])
  .sort({ priority: -1, createdAt: -1 });
};

RecommendationSchema.statics.findExpired = function() {
  return this.find({
    expiresAt: { $lt: new Date() },
    isActive: true
  });
};

RecommendationSchema.statics.findForReminders = function() {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  
  return this.find({
    status: 'pending',
    isActive: true,
    'communication.allowReminders': true,
    'interactions.reminderCount': { $lt: 3 },
    $or: [
      { 'interactions.reminderSentAt': { $exists: false } },
      { 'interactions.reminderSentAt': { $lt: threeDaysAgo } }
    ].flatMap(reminderCondition =>
      [
        {
          ...reminderCondition,
          ...{
            $or: [
              { expiresAt: { $exists: false } },
              { expiresAt: { $gt: new Date() } }
            ]
          }
        }
      ]
    )
  });
};

RecommendationSchema.statics.getRecommendationStats = async function(userId: mongoose.Types.ObjectId) {
  const [sentStats, receivedStats] = await Promise.all([
    this.aggregate([
      { $match: { senderId: userId } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]),
    this.aggregate([
      { $match: { recipientId: userId } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ])
  ]);
  
  return { sent: sentStats, received: receivedStats };
};

// Create and export the model
export const Recommendation: Model<IRecommendation> = mongoose.model<IRecommendation>('Recommendation', RecommendationSchema);