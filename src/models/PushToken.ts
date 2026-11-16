import mongoose, { Schema, Document, Model } from 'mongoose';

/** An Expo push token for one installed copy of the app. A token belongs to whoever registered it last. */
export interface IPushTokenDoc extends Document {
  userId: mongoose.Types.ObjectId;
  token: string;
  platform: 'android' | 'ios' | 'web';
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PushTokenSchema = new Schema<IPushTokenDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    token: { type: String, required: true, unique: true, maxlength: 200 },
    platform: { type: String, enum: ['android', 'ios', 'web'], default: 'android' },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export const PushToken: Model<IPushTokenDoc> = mongoose.model<IPushTokenDoc>('PushToken', PushTokenSchema);
