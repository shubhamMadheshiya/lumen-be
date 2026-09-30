import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface AuthRequest extends Request {
  userId?: string;
}

interface AccessPayload {
  sub: string;
  type: 'access';
  iat: number;
  exp: number;
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'Missing or invalid Authorization header' });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.jwt.accessSecret) as AccessPayload;
    if (payload.type !== 'access') {
      res.status(401).json({ success: false, message: 'Invalid token type' });
      return;
    }
    req.userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired access token' });
  }
}
