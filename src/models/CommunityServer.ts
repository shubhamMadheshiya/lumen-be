import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ICommunityServerDoc extends Document {
  name: string;
  slug: string;
  description: string;
  icon: string;
  color: string;
  conditionTags: string[];
  isPrivate: boolean;
  inviteCode: string;
  ownerId: mongoose.Types.ObjectId;
  memberIds: mongoose.Types.ObjectId[];
  membersCount: number;
  isOfficial: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CommunityServerSchema = new Schema<ICommunityServerDoc>(
  {
    name: { type: String, required: true, maxlength: 100 },
    slug: { type: String, required: true, unique: true, index: true },
    description: { type: String, maxlength: 500, default: '' },
    icon: { type: String, default: '🌟', maxlength: 30 },
    color: { type: String, default: '#38BDF8', maxlength: 20 },
    conditionTags: { type: [String], default: [] },
    isPrivate: { type: Boolean, default: false },
    inviteCode: { type: String, required: true, unique: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    memberIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    membersCount: { type: Number, default: 1 },
    isOfficial: { type: Boolean, default: false },
  },
  { timestamps: true }
);

CommunityServerSchema.index({ isPrivate: 1, createdAt: -1 });

export const CommunityServer: Model<ICommunityServerDoc> =
  mongoose.model<ICommunityServerDoc>('CommunityServer', CommunityServerSchema);
