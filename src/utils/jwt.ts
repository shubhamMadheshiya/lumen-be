import jwt from 'jsonwebtoken';
import { config } from '../config';

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId, type: 'access' }, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpires as jwt.SignOptions['expiresIn'],
  });
}

export function signRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId, type: 'refresh' }, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpires as jwt.SignOptions['expiresIn'],
  });
}

export function verifyRefreshToken(token: string): { sub: string } {
  const payload = jwt.verify(token, config.jwt.refreshSecret) as { sub: string; type: string };
  if (payload.type !== 'refresh') throw new Error('Not a refresh token');
  return payload;
}
