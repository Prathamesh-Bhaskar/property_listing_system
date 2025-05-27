export const PROPERTY_TYPES = [
  'Apartment',
  'Villa',
  'Bungalow',
  'Plot',
  'House',
  'Commercial'
];

export const FURNISHED_TYPES = [
  'Furnished',
  'Semi-Furnished',
  'Unfurnished'
];

export const LISTED_BY_TYPES = [
  'Owner',
  'Dealer',
  'Builder'
];

export const LISTING_TYPES = [
  'rent',
  'sale'
];

export const CACHE_KEYS = {
  PROPERTIES: 'properties',
  PROPERTY: 'property',
  USER_PROPERTIES: 'user_properties',
  FAVORITES: 'favorites'
};

export const CACHE_TTL = {
  SHORT: 300,    // 5 minutes
  MEDIUM: 600,   // 10 minutes
  LONG: 3600     // 1 hour
};