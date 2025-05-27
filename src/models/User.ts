import mongoose, { Document, Schema, Model } from 'mongoose';
import bcrypt from 'bcryptjs';

// User interface for TypeScript
export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  avatar?: string;
  role: 'user' | 'admin';
  isVerified: boolean;
  isActive: boolean;
  lastLoginAt?: Date;
  resetPasswordToken?: string;
  resetPasswordExpires?: Date;
  emailVerificationToken?: string;
  emailVerificationExpires?: Date;
  preferences: {
    notifications: {
      email: boolean;
      push: boolean;
      recommendations: boolean;
      favorites: boolean;
    };
    privacy: {
      showProfile: boolean;
      showContactInfo: boolean;
    };
  };
  stats: {
    propertiesListed: number;
    favoriteCount: number;
    recommendationsSent: number;
    recommendationsReceived: number;
  };
  createdAt: Date;
  updatedAt: Date;
  
  // Instance methods
  comparePassword(candidatePassword: string): Promise<boolean>;
  getFullName(): string;
  generatePasswordResetToken(): string;
  generateEmailVerificationToken(): string;
  toJSON(): any;
}

// User schema
const UserSchema = new Schema<IUser>({
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      'Please provide a valid email address'
    ],
    index: true
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters long'],
    select: false // Don't include password in queries by default
  },
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true,
    maxlength: [50, 'First name cannot exceed 50 characters']
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true,
    maxlength: [50, 'Last name cannot exceed 50 characters']
  },
  phone: {
    type: String,
    trim: true,
    match: [
      /^[\+]?[1-9][\d]{0,15}$/,
      'Please provide a valid phone number'
    ]
  },
  avatar: {
    type: String,
    default: null
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLoginAt: {
    type: Date,
    default: null
  },
  resetPasswordToken: {
    type: String,
    default: null
  },
  resetPasswordExpires: {
    type: Date,
    default: null
  },
  emailVerificationToken: {
    type: String,
    default: null
  },
  emailVerificationExpires: {
    type: Date,
    default: null
  },
  preferences: {
    notifications: {
      email: {
        type: Boolean,
        default: true
      },
      push: {
        type: Boolean,
        default: true
      },
      recommendations: {
        type: Boolean,
        default: true
      },
      favorites: {
        type: Boolean,
        default: true
      }
    },
    privacy: {
      showProfile: {
        type: Boolean,
        default: true
      },
      showContactInfo: {
        type: Boolean,
        default: false
      }
    }
  },
  stats: {
    propertiesListed: {
      type: Number,
      default: 0
    },
    favoriteCount: {
      type: Number,
      default: 0
    },
    recommendationsSent: {
      type: Number,
      default: 0
    },
    recommendationsReceived: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better performance
UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ firstName: 1, lastName: 1 });
UserSchema.index({ role: 1 });
UserSchema.index({ isActive: 1 });
UserSchema.index({ createdAt: -1 });

// Pre-save middleware to hash password
UserSchema.pre('save', async function(next) {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified('password')) return next();

  try {
    // Hash the password with cost of 12
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error as Error);
  }
});

// Instance method to check password
UserSchema.methods.comparePassword = async function(candidatePassword: string): Promise<boolean> {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw new Error('Password comparison failed');
  }
};

// Instance method to get full name
UserSchema.methods.getFullName = function(): string {
  return `${this.firstName} ${this.lastName}`.trim();
};

// Instance method to generate password reset token
UserSchema.methods.generatePasswordResetToken = function(): string {
  const resetToken = Math.random().toString(36).substring(2, 15) + 
                     Math.random().toString(36).substring(2, 15);
  
  this.resetPasswordToken = resetToken;
  this.resetPasswordExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  
  return resetToken;
};

// Instance method to generate email verification token
UserSchema.methods.generateEmailVerificationToken = function(): string {
  const verificationToken = Math.random().toString(36).substring(2, 15) + 
                           Math.random().toString(36).substring(2, 15);
  
  this.emailVerificationToken = verificationToken;
  this.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  
  return verificationToken;
};

// Override toJSON to remove sensitive fields
UserSchema.methods.toJSON = function() {
  const userObject = this.toObject();
  
  // Remove sensitive fields
  delete userObject.password;
  delete userObject.resetPasswordToken;
  delete userObject.resetPasswordExpires;
  delete userObject.emailVerificationToken;
  delete userObject.emailVerificationExpires;
  delete userObject.__v;
  
  return userObject;
};

// Virtual for full name
UserSchema.virtual('fullName').get(function() {
  return this.getFullName();
});

// Virtual for properties
UserSchema.virtual('properties', {
  ref: 'Property',
  localField: '_id',
  foreignField: 'createdBy'
});

// Virtual for favorites
UserSchema.virtual('favorites', {
  ref: 'Favorite',
  localField: '_id',
  foreignField: 'userId'
});

// Static methods
UserSchema.statics.findByEmail = function(email: string) {
  return this.findOne({ email: email.toLowerCase() });
};

UserSchema.statics.findActiveUsers = function() {
  return this.find({ isActive: true });
};

UserSchema.statics.findVerifiedUsers = function() {
  return this.find({ isVerified: true, isActive: true });
};

// Pre-remove middleware to clean up related data
UserSchema.pre('deleteOne', { document: true, query: false }, async function(next) {
  try {
    // Remove user's properties
    await mongoose.model('Property').deleteMany({ createdBy: this._id });
    
    // Remove user's favorites
    await mongoose.model('Favorite').deleteMany({ userId: this._id });
    
    // Remove user's recommendations (both sent and received)
    await mongoose.model('Recommendation').deleteMany({
      $or: [{ senderId: this._id }, { recipientId: this._id }]
    });
    
    next();
  } catch (error) {
    next(error as Error);
  }
});

// Create and export the model
export const User: Model<IUser> = mongoose.model<IUser>('User', UserSchema);