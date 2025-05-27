import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models/User';
import { config } from '../config/env';
import { AuthRequest } from '../types';

interface JwtPayload {
  userId: string;
  iat?: number;
  exp?: number;
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    // Ensure JWT secret exists
    const jwtSecret = config.jwt.secret as string;
    if (!jwtSecret) {
      console.error('JWT secret is not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Verify and decode token with proper typing
    const decoded = jwt.verify(token, jwtSecret) as JwtPayload;
    
    if (!decoded.userId) {
      return res.status(401).json({ error: 'Invalid token payload.' });
    }

    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid token. User not found.' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ error: 'Invalid token.' });
    }
    
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: 'Token expired.' });
    }
    
    res.status(401).json({ error: 'Token verification failed.' });
  }
};