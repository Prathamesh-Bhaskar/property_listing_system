import { Types } from 'mongoose';

export const isValidObjectId = (id: string): boolean => {
  return Types.ObjectId.isValid(id);
};

export const generatePropertyId = (): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 5);
  return `PROP${timestamp}${random}`.toUpperCase();
};

export const parseAmenities = (amenities: string): string[] => {
  return amenities.split('|').filter(a => a.trim() !== '');
};

export const parseTags = (tags: string): string[] => {
  return tags.split('|').filter(t => t.trim() !== '');
};

export const formatPrice = (price: number): string => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR'
  }).format(price);
};