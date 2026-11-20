import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * How someone can be reached for a direct message without sharing a community: a personal invite
 * code (the link) and an optional @handle. One per member. `enabled` switches both off at once.
 */
export interface IDmInviteDoc extends Document {
  userId: mongoose.Types.ObjectId;
  code: string;
  /** Lowercase, unique; absent until the member picks one. */
  handle?: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const DmInviteSchema = new Schema<IDmInviteDoc>(
  {
    userId:  { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    code:    { type: String, required: true, unique: true },
    handle:  { type: String, unique: true, sparse: true },
    enabled: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const DmInvite: Model<IDmInviteDoc> = mongoose.model<IDmInviteDoc>('DmInvite', DmInviteSchema);
