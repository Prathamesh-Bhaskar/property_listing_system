import mongoose, { Document, Schema, Model } from 'mongoose';

// Property interface for TypeScript
export interface IProperty extends Document {
  _id: mongoose.Types.ObjectId;
  id: string; // Custom property ID like PROP1000
  title: string;
  description?: string;
  type: 'Apartment' | 'House' | 'Bungalow' | 'Villa' | 'Penthouse' | 'Studio' | 'Duplex' | 'Townhouse';
  price: number;
  priceType: 'total' | 'per_sqft' | 'monthly' | 'yearly';
  location: {
    state: string;
    city: string;
    area?: string;
    pincode?: string;
    address?: string;
    coordinates?: {
      latitude: number;
      longitude: number;
    };
  };
  specifications: {
    areaSqFt: number;
    bedrooms: number;
    bathrooms: number;
    balconies?: number;
    parking?: number;
    floor?: number;
    totalFloors?: number;
    ageOfProperty?: number;
  };
  amenities: string[]; // Array of amenities
  furnished: 'Furnished' | 'Semi-Furnished' | 'Unfurnished';
  availableFrom: Date;
  listedBy: 'Owner' | 'Dealer' | 'Builder';
  tags: string[]; // Array of tags
  media: {
    images: string[];
    videos?: string[];
    virtualTour?: string;
  };
  colorTheme: string;
  rating: number;
  reviewCount: number;
  isVerified: boolean;
  isActive: boolean;
  isFeatured: boolean;
  listingType: 'rent' | 'sale';
  views: number;
  contactInfo: {
    showPhone: boolean;
    showEmail: boolean;
    contactPerson?: string;
    phone?: string;
    email?: string;
  };
  features: {
    isPetFriendly?: boolean;
    isFurnished?: boolean;
    hasGarden?: boolean;
    hasPool?: boolean;
    hasGym?: boolean;
    hasSecurity?: boolean;
    hasElevator?: boolean;
    hasParking?: boolean;
  };
  policies: {
    deposit?: number;
    brokerage?: number;
    maintenanceCharges?: number;
    electricityBill?: 'included' | 'extra';
    waterBill?: 'included' | 'extra';
  };
  createdBy: mongoose.Types.ObjectId; // Reference to User
  updatedBy?: mongoose.Types.ObjectId; // Reference to User who last updated
  createdAt: Date;
  updatedAt: Date;
  
  // Instance methods
  generatePropertyId(): string;
  getFormattedPrice(): string;
  isOwnedBy(userId: mongoose.Types.ObjectId): boolean;
  incrementViews(): Promise<void>;
  getAmenitiesArray(): string[];
  getTagsArray(): string[];
}

// Property schema
const PropertySchema = new Schema<IProperty>({
  id: {
    type: String,
    unique: true,
    required: true,
    index: true
  },
  title: {
    type: String,
    required: [true, 'Property title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters'],
    index: true
  },
  description: {
    type: String,
    trim: true,
    maxlength: [2000, 'Description cannot exceed 2000 characters']
  },
  type: {
    type: String,
    required: [true, 'Property type is required'],
    enum: ['Apartment', 'House', 'Bungalow', 'Villa', 'Penthouse', 'Studio', 'Duplex', 'Townhouse'],
    index: true
  },
  price: {
    type: Number,
    required: [true, 'Price is required'],
    min: [0, 'Price cannot be negative'],
    index: true
  },
  priceType: {
    type: String,
    enum: ['total', 'per_sqft', 'monthly', 'yearly'],
    default: 'total'
  },
  location: {
    state: {
      type: String,
      required: [true, 'State is required'],
      trim: true,
      index: true
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      trim: true,
      index: true
    },
    area: {
      type: String,
      trim: true
    },
    pincode: {
      type: String,
      trim: true,
      match: [/^\d{6}$/, 'Please provide a valid pincode']
    },
    address: {
      type: String,
      trim: true,
      maxlength: [500, 'Address cannot exceed 500 characters']
    },
    coordinates: {
      latitude: {
        type: Number,
        min: [-90, 'Latitude must be between -90 and 90'],
        max: [90, 'Latitude must be between -90 and 90']
      },
      longitude: {
        type: Number,
        min: [-180, 'Longitude must be between -180 and 180'],
        max: [180, 'Longitude must be between -180 and 180']
      }
    }
  },
  specifications: {
    areaSqFt: {
      type: Number,
      required: [true, 'Area in square feet is required'],
      min: [1, 'Area must be at least 1 square foot'],
      index: true
    },
    bedrooms: {
      type: Number,
      required: [true, 'Number of bedrooms is required'],
      min: [0, 'Bedrooms cannot be negative'],
      max: [20, 'Bedrooms cannot exceed 20'],
      index: true
    },
    bathrooms: {
      type: Number,
      required: [true, 'Number of bathrooms is required'],
      min: [0, 'Bathrooms cannot be negative'],
      max: [20, 'Bathrooms cannot exceed 20'],
      index: true
    },
    balconies: {
      type: Number,
      min: [0, 'Balconies cannot be negative'],
      max: [10, 'Balconies cannot exceed 10'],
      default: 0
    },
    parking: {
      type: Number,
      min: [0, 'Parking cannot be negative'],
      max: [10, 'Parking cannot exceed 10'],
      default: 0
    },
    floor: {
      type: Number,
      min: [0, 'Floor cannot be negative']
    },
    totalFloors: {
      type: Number,
      min: [1, 'Total floors must be at least 1']
    },
    ageOfProperty: {
      type: Number,
      min: [0, 'Age of property cannot be negative'],
      max: [100, 'Age of property cannot exceed 100 years']
    }
  },
  amenities: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  furnished: {
    type: String,
    required: [true, 'Furnished status is required'],
    enum: ['Furnished', 'Semi-Furnished', 'Unfurnished'],
    index: true
  },
  availableFrom: {
    type: Date,
    required: [true, 'Available from date is required'],
    index: true
  },
  listedBy: {
    type: String,
    required: [true, 'Listed by is required'],
    enum: ['Owner', 'Dealer', 'Builder'],
    index: true
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  media: {
    images: [{
      type: String,
      validate: {
        validator: function(v: string) {
          return /^https?:\/\/.+\.(jpg|jpeg|png|webp|gif)$/i.test(v);
        },
        message: 'Invalid image URL format'
      }
    }],
    videos: [{
      type: String,
      validate: {
        validator: function(v: string) {
          return /^https?:\/\/.+\.(mp4|avi|mov|wmv)$/i.test(v);
        },
        message: 'Invalid video URL format'
      }
    }],
    virtualTour: {
      type: String,
      validate: {
        validator: function(v: string) {
          return /^https?:\/\/.+/.test(v);
        },
        message: 'Invalid virtual tour URL format'
      }
    }
  },
  colorTheme: {
    type: String,
    match: [/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Please provide a valid hex color'],
    default: '#3B82F6'
  },
  rating: {
    type: Number,
    min: [0, 'Rating cannot be less than 0'],
    max: [5, 'Rating cannot be more than 5'],
    default: 0,
    index: true
  },
  reviewCount: {
    type: Number,
    min: [0, 'Review count cannot be negative'],
    default: 0
  },
  isVerified: {
    type: Boolean,
    default: false,
    index: true
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  isFeatured: {
    type: Boolean,
    default: false,
    index: true
  },
  listingType: {
    type: String,
    required: [true, 'Listing type is required'],
    enum: ['rent', 'sale'],
    index: true
  },
  views: {
    type: Number,
    min: [0, 'Views cannot be negative'],
    default: 0
  },
  contactInfo: {
    showPhone: {
      type: Boolean,
      default: true
    },
    showEmail: {
      type: Boolean,
      default: true
    },
    contactPerson: {
      type: String,
      trim: true
    },
    phone: {
      type: String,
      trim: true
    },
    email: {
      type: String,
      trim: true,
      lowercase: true
    }
  },
  features: {
    isPetFriendly: { type: Boolean, default: false },
    isFurnished: { type: Boolean, default: false },
    hasGarden: { type: Boolean, default: false },
    hasPool: { type: Boolean, default: false },
    hasGym: { type: Boolean, default: false },
    hasSecurity: { type: Boolean, default: false },
    hasElevator: { type: Boolean, default: false },
    hasParking: { type: Boolean, default: false }
  },
  policies: {
    deposit: {
      type: Number,
      min: [0, 'Deposit cannot be negative']
    },
    brokerage: {
      type: Number,
      min: [0, 'Brokerage cannot be negative']
    },
    maintenanceCharges: {
      type: Number,
      min: [0, 'Maintenance charges cannot be negative']
    },
    electricityBill: {
      type: String,
      enum: ['included', 'extra'],
      default: 'extra'
    },
    waterBill: {
      type: String,
      enum: ['included', 'extra'],
      default: 'extra'
    }
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Created by user is required'],
    index: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound indexes for better query performance
PropertySchema.index({ 'location.city': 1, 'location.state': 1 });
PropertySchema.index({ type: 1, listingType: 1 });
PropertySchema.index({ price: 1, 'specifications.areaSqFt': 1 });
PropertySchema.index({ 'specifications.bedrooms': 1, 'specifications.bathrooms': 1 });
PropertySchema.index({ rating: -1, reviewCount: -1 });
PropertySchema.index({ createdAt: -1 });
PropertySchema.index({ availableFrom: 1 });

// Text index for search functionality
PropertySchema.index({
  title: 'text',
  description: 'text',
  'location.city': 'text',
  'location.state': 'text',
  'location.area': 'text'
});

// Pre-save middleware to generate property ID
PropertySchema.pre('save', async function(next) {
  if (this.isNew && !this.id) {
    this.id = await this.generatePropertyId();
  }
  next();
});

// Instance method to generate unique property ID
PropertySchema.methods.generatePropertyId = async function(): Promise<string> {
  const Property = mongoose.model('Property');
  let isUnique = false;
  let propertyId = '';
  
  while (!isUnique) {
    const randomNum = Math.floor(Math.random() * 9000) + 1000; // 4-digit number
    propertyId = `PROP${randomNum}`;
    
    const existingProperty = await Property.findOne({ id: propertyId });
    if (!existingProperty) {
      isUnique = true;
    }
  }
  
  return propertyId;
};

// Instance method to format price
PropertySchema.methods.getFormattedPrice = function(): string {
  const formatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
  
  return formatter.format(this.price);
};

// Instance method to check ownership
PropertySchema.methods.isOwnedBy = function(userId: mongoose.Types.ObjectId): boolean {
  return this.createdBy.toString() === userId.toString();
};

// Instance method to increment views
PropertySchema.methods.incrementViews = async function(): Promise<void> {
  this.views += 1;
  await this.save({ validateBeforeSave: false });
};

// Instance method to get amenities as array
PropertySchema.methods.getAmenitiesArray = function(): string[] {
  return this.amenities || [];
};

// Instance method to get tags as array
PropertySchema.methods.getTagsArray = function(): string[] {
  return this.tags || [];
};

// Virtual for price per square foot
PropertySchema.virtual('pricePerSqFt').get(function() {
  if (this.specifications && this.specifications.areaSqFt > 0) {
    return Math.round(this.price / this.specifications.areaSqFt);
  }
  return 0;
});

// Virtual for property age in years
PropertySchema.virtual('ageInYears').get(function() {
  if (this.specifications && this.specifications.ageOfProperty) {
    return this.specifications.ageOfProperty;
  }
  return 0;
});

// Virtual for location display
PropertySchema.virtual('locationDisplay').get(function() {
  const parts = [this.location.area, this.location.city, this.location.state].filter(Boolean);
  return parts.join(', ');
});

// Static methods
PropertySchema.statics.findByCity = function(city: string) {
  return this.find({ 'location.city': new RegExp(city, 'i'), isActive: true });
};

PropertySchema.statics.findByType = function(type: string) {
  return this.find({ type, isActive: true });
};

PropertySchema.statics.findByPriceRange = function(minPrice: number, maxPrice: number) {
  return this.find({ 
    price: { $gte: minPrice, $lte: maxPrice }, 
    isActive: true 
  });
};

PropertySchema.statics.findFeatured = function() {
  return this.find({ isFeatured: true, isActive: true }).sort({ rating: -1, createdAt: -1 });
};

PropertySchema.statics.findVerified = function() {
  return this.find({ isVerified: true, isActive: true }).sort({ rating: -1, createdAt: -1 });
};

// Create and export the model
export const Property: Model<IProperty> = mongoose.model<IProperty>('Property', PropertySchema);