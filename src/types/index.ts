import { Document, Types } from 'mongoose';

export interface IUser extends Document {
  _id: Types.ObjectId;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

export interface IProperty extends Document {
  _id: Types.ObjectId;
  id: string;
  title: string;
  type: string;
  price: number;
  state: string;
  city: string;
  areaSqFt: number;
  bedrooms: number;
  bathrooms: number;
  amenities: string;
  furnished: string;
  availableFrom: Date;
  listedBy: string;
  tags: string;
  colorTheme: string;
  rating: number;
  isVerified: boolean;
  listingType: 'rent' | 'sale';
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface IFavorite extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  propertyId: Types.ObjectId;
  createdAt: Date;
}

export interface IRecommendation extends Document {
  _id: Types.ObjectId;
  fromUserId: Types.ObjectId;
  toUserId: Types.ObjectId;
  propertyId: Types.ObjectId;
  message?: string;
  isRead: boolean;
  createdAt: Date;
}

export interface AuthRequest extends Request {
  user?: IUser;
}

export interface PropertyQuery {
  type?: string;
  state?: string;
  city?: string;
  minPrice?: number;
  maxPrice?: number;
  bedrooms?: number;
  bathrooms?: number;
  furnished?: string;
  listingType?: 'rent' | 'sale';
  amenities?: string[];
  tags?: string[];
  isVerified?: boolean;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}