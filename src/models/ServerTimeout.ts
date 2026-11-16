import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IServerTimeoutDoc extends Document {
  serverId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  timedOutUntil: Date;
  reason?: string;
  timedOutBy: mongoose.Types.ObjectId;
  createdAt: Date;
}

const ServerTimeoutSchema = new Schema<IServerTimeoutDoc>(
  {
    serverId: { type: Schema.Types.ObjectId, ref: 'CommunityServer', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    timedOutUntil: { type: Date, required: true, index: true },
    reason: { type: String, maxlength: 200 },
    timedOutBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

ServerTimeoutSchema.index({ serverId: 1, userId: 1 });

export const ServerTimeout: Model<IServerTimeoutDoc> =
  mongoose.model<IServerTimeoutDoc>('ServerTimeout', ServerTimeoutSchema);

