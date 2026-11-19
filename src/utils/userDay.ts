/**
 * The member's own time zone and Day Reset Boundary, read once, so routes can put an instant on
 * the right Lumen day without repeating the User lookup.
 */
import mongoose from 'mongoose';
import { User } from '../models/User';
import { DEFAULT_BOUNDARY_HOUR, resolveTimeZone, trackingDayKey } from './dayKey';

export interface UserDayContext {
  timeZone: string;
  boundaryHour: number;
  dayKeyOf(date: Date, entryTimeZone?: string | null): string;
}

export function makeDayContext(timeZone: string | undefined | null, boundaryHour: number | undefined | null): UserDayContext {
  const tz = resolveTimeZone(timeZone);
  const boundary = typeof boundaryHour === 'number' ? boundaryHour : DEFAULT_BOUNDARY_HOUR;
  return {
    timeZone: tz,
    boundaryHour: boundary,
    dayKeyOf: (date, entryTimeZone) => trackingDayKey(date, resolveTimeZone(entryTimeZone, tz), boundary),
  };
}

export async function userDayContext(userId: string | mongoose.Types.ObjectId): Promise<UserDayContext> {
  const user = await User.findById(userId).select('preferences.timezone preferences.dayBoundaryHour').lean();
  return makeDayContext(user?.preferences?.timezone, user?.preferences?.dayBoundaryHour);
}
