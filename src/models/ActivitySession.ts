import mongoose, { Schema, Document, Model } from 'mongoose';
import { ActivityType, ActivitySessionStatus } from '../shared';

export interface IActivityPointDoc {
  latitude: number;
  longitude: number;
  altitude?: number;
  accuracy?: number;
  speed?: number;
  timestamp: number;
}

export interface IActivitySessionDoc extends Document {
  userId: mongoose.Types.ObjectId;
  clientId: string;
  activityType: ActivityType;
  title: string;
  status: ActivitySessionStatus;
  
  startTime: Date;
  endTime?: Date;
  totalDurationSeconds: number;
  activeDurationSeconds: number;
  
  distanceMeters: number;
  steps: number;
  averageSpeedKmh?: number;
  averagePaceMinPerKm?: number;
  estimatedCaloriesBurned?: number;
  
  startLatitude?: number;
  startLongitude?: number;
  endLatitude?: number;
  endLongitude?: number;
  routePoints?: IActivityPointDoc[];
  hasRouteData: boolean;
  
  daySessionId?: mongoose.Types.ObjectId;
  linkedReminderId?: mongoose.Types.ObjectId;
  linkedLogEntryId?: mongoose.Types.ObjectId;
  
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ActivityPointSchema = new Schema<IActivityPointDoc>(
  {
    latitude:  { type: Number, required: true },
    longitude: { type: Number, required: true },
    altitude:  { type: Number },
    accuracy:  { type: Number },
    speed:     { type: Number },
    timestamp: { type: Number, required: true },
  },
  { _id: false }
);

const ActivitySessionSchema = new Schema<IActivitySessionDoc>(
  {
    userId:                { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    clientId:              { type: String, required: true },
    activityType:          {
      type: String,
      enum: ['WALKING', 'SITTING', 'SLEEP', 'EXERCISE', 'STRETCHING', 'MEDITATION', 'CUSTOM'],
      required: true,
      default: 'WALKING',
    },
    title:                 { type: String, required: true, default: 'Walking Session' },
    status:                {
      type: String,
      enum: ['ACTIVE', 'PAUSED', 'COMPLETED', 'DISCARDED'],
      default: 'ACTIVE',
    },
    startTime:             { type: Date, required: true },
    endTime:               { type: Date },
    totalDurationSeconds:  { type: Number, default: 0 },
    activeDurationSeconds: { type: Number, default: 0 },
    distanceMeters:        { type: Number, default: 0 },
    steps:                 { type: Number, default: 0 },
    averageSpeedKmh:       { type: Number },
    averagePaceMinPerKm:   { type: Number },
    estimatedCaloriesBurned:{ type: Number },
    
    startLatitude:         { type: Number },
    startLongitude:        { type: Number },
    endLatitude:           { type: Number },
    endLongitude:          { type: Number },
    routePoints:           [ActivityPointSchema],
    hasRouteData:          { type: Boolean, default: false },
    
    daySessionId:          { type: Schema.Types.ObjectId, ref: 'DaySession' },
    linkedReminderId:      { type: Schema.Types.ObjectId, ref: 'Reminder' },
    linkedLogEntryId:      { type: Schema.Types.ObjectId, ref: 'LogEntry' },
    notes:                 { type: String, maxlength: 1000 },
  },
  { timestamps: true }
);

ActivitySessionSchema.index({ userId: 1, clientId: 1 }, { unique: true });
ActivitySessionSchema.index({ userId: 1, startTime: -1 });
ActivitySessionSchema.index({ userId: 1, activityType: 1, startTime: -1 });

export const ActivitySession: Model<IActivitySessionDoc> =
  mongoose.model<IActivitySessionDoc>('ActivitySession', ActivitySessionSchema);
