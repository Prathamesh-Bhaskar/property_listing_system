import mongoose, { Schema } from 'mongoose';
import { IProperty } from '../types';

const propertySchema = new Schema<IProperty>({
  id: {
    type: String,
    required: true,
    unique: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    required: true,
    enum: ['Apartment', 'Villa', 'Bungalow', 'Plot', 'House', 'Commercial']
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  state: {
    type: String,
    required: true,
    trim: true
  },
  city: {
    type: String,
    required: true,
    trim: true
  },
  areaSqFt: {
    type: Number,
    required: true,
    min: 0
  },
  bedrooms: {
    type: Number,
    required: true,
    min: 0
  },
  bathrooms: {
    type: Number,
    required: true,
    min: 0
  },
  amenities: {
    type: String,
    default: ''
  },
  furnished: {
    type: String,
    enum: ['Furnished', 'Semi-Furnished', 'Unfurnished'],
    default: 'Unfurnished'
  },
  availableFrom: {
    type: Date,
    required: true
  },
  listedBy: {
    type: String,
    enum: ['Owner', 'Dealer', 'Builder'],
    required: true
  },
  tags: {
    type: String,
    default: ''
  },
  colorTheme: {
    type: String,
    default: '#000000'
  },
  rating: {
    type: Number,
    min: 0,
    max: 5,
    default: 0
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  listingType: {
    type: String,
    enum: ['rent', 'sale'],
    required: true
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

propertySchema.index({ state: 1, city: 1 });
propertySchema.index({ type: 1 });
propertySchema.index({ price: 1 });
propertySchema.index({ listingType: 1 });
propertySchema.index({ createdBy: 1 });

export const Property = mongoose.model<IProperty>('Property', propertySchema);