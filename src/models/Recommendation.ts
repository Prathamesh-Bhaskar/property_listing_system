import mongoose, { Schema } from 'mongoose';
import { IRecommendation } from '../types';

const recommendationSchema = new Schema<IRecommendation>({
  fromUserId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  toUserId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  propertyId: {
    type: Schema.Types.ObjectId,
    ref: 'Property',
    required: true
  },
  message: {
    type: String,
    trim: true,
    maxlength: 500
  },
  isRead: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

recommendationSchema.index({ toUserId: 1 });
recommendationSchema.index({ fromUserId: 1 });

export const Recommendation = mongoose.model<IRecommendation>('Recommendation', recommendationSchema);