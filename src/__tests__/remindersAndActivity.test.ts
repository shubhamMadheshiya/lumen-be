import { Reminder } from '../models/Reminder';
import { ActivitySession } from '../models/ActivitySession';
import { NotificationEvent } from '../models/NotificationEvent';
import mongoose from 'mongoose';

describe('Server Models: Reminder & ActivitySession Validation', () => {
  it('validates a complete Interval Reminder model instance', () => {
    const userId = new mongoose.Types.ObjectId();
    const reminder = new Reminder({
      userId,
      clientId: 'mock-client-id-1',
      name: 'Drink Water',
      category: 'HYDRATION',
      scheduleType: 'INTERVAL',
      windowStartTime: '08:00',
      windowEndTime: '22:00',
      intervalMinutes: 60,
      notificationMessage: 'Time to hydrate',
      snoozeDurationMinutes: 10,
      enabled: true,
    });

    const err = reminder.validateSync();
    expect(err).toBeUndefined();
    expect(reminder.name).toBe('Drink Water');
    expect(reminder.scheduleType).toBe('INTERVAL');
    expect(reminder.intervalMinutes).toBe(60);
  });

  it('validates an Inactivity Reminder model instance', () => {
    const userId = new mongoose.Types.ObjectId();
    const reminder = new Reminder({
      userId,
      name: 'Stand Up',
      category: 'MOVEMENT',
      scheduleType: 'INACTIVITY',
      inactivityThresholdMinutes: 45,
      notificationMessage: 'Time to stand up and stretch',
      enabled: true,
    });

    const err = reminder.validateSync();
    expect(err).toBeUndefined();
    expect(reminder.inactivityThresholdMinutes).toBe(45);
  });

  it('validates a complete ActivitySession model instance with walking metrics', () => {
    const userId = new mongoose.Types.ObjectId();
    const session = new ActivitySession({
      userId,
      clientId: 'session-client-123',
      activityType: 'WALKING',
      title: 'Morning Walk',
      status: 'COMPLETED',
      startTime: new Date('2026-09-30T07:10:00.000Z'),
      endTime: new Date('2026-09-30T07:52:18.000Z'),
      totalDurationSeconds: 2538,
      activeDurationSeconds: 2410,
      distanceMeters: 3420,
      steps: 4820,
      averageSpeedKmh: 5.11,
      averagePaceMinPerKm: 11.74,
      startLatitude: 12.9716,
      startLongitude: 77.5946,
      endLatitude: 12.9780,
      endLongitude: 77.6010,
      routePoints: [
        { latitude: 12.9716, longitude: 77.5946, timestamp: 1790752200000 },
        { latitude: 12.9780, longitude: 77.6010, timestamp: 1790754600000 },
      ],
      hasRouteData: true,
    });

    const err = session.validateSync();
    expect(err).toBeUndefined();
    expect(session.distanceMeters).toBe(3420);
    expect(session.steps).toBe(4820);
    expect(session.activityType).toBe('WALKING');
  });

  it('validates a NotificationEvent instance tracking reminder completion', () => {
    const userId = new mongoose.Types.ObjectId();
    const reminderId = new mongoose.Types.ObjectId();

    const notifEvent = new NotificationEvent({
      userId,
      reminderId,
      clientId: 'event-uuid-1',
      scheduledFor: new Date('2026-09-30T10:00:00.000Z'),
      triggeredAt: new Date('2026-09-30T10:00:01.000Z'),
      status: 'COMPLETED',
      actionTaken: 'LOGGED_250ML',
    });

    const err = notifEvent.validateSync();
    expect(err).toBeUndefined();
    expect(notifEvent.status).toBe('COMPLETED');
    expect(notifEvent.actionTaken).toBe('LOGGED_250ML');
  });
});
