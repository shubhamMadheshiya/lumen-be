import mongoose, { Schema, Document, Model } from 'mongoose';

/** A member hides another member. Blocking from an anonymous message works without revealing who wrote it. */
export interface ICommunityBlockDoc extends Document {
  userId: mongoose.Types.ObjectId;
  blockedUserId: mongoose.Types.ObjectId;
  label: string;
  viaAnonymous: boolean;
  createdAt: Date;
}

const CommunityBlockSchema = new Schema<ICommunityBlockDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    blockedUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    label: { type: String, default: 'Community member', maxlength: 80 },
    viaAnonymous: { type: Boolean, default: false },
  },
  { timestamps: true }
);
CommunityBlockSchema.index({ userId: 1, blockedUserId: 1 }, { unique: true });

export const CommunityBlock: Model<ICommunityBlockDoc> =
  mongoose.model<ICommunityBlockDoc>('CommunityBlock', CommunityBlockSchema);
