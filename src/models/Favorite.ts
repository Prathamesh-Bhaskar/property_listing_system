import mongoose, { Schema } from 'mongoose';
import { IFavorite } from '../types';

const favoriteSchema = new Schema<IFavorite>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  propertyId: {
    type: Schema.Types.ObjectId,
    ref: 'Property',
    required: true
  }
}, {
  timestamps: true
});

favoriteSchema.index({ userId: 1, propertyId: 1 }, { unique: true });

export const Favorite = mongoose.model<IFavorite>('Favorite', favoriteSchema);