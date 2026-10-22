import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ICommunityChannelDoc extends Document {
  serverId?: mongoose.Types.ObjectId;
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  topic: string;
  category: string;
  type: 'text' | 'forum' | 'announcement';
  order: number;
  memberCount: number;
  messageCount: number;
  isFeatured: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CommunityChannelSchema = new Schema<ICommunityChannelDoc>(
  {
    serverId: { type: Schema.Types.ObjectId, ref: 'CommunityServer', index: true },
    slug: { type: String, required: true, index: true },
    name: { type: String, required: true, maxlength: 100 },
    description: { type: String, maxlength: 500 },
    icon: { type: String, default: '💬', maxlength: 30 },
    color: { type: String, default: '#38BDF8', maxlength: 20 },
    topic: { type: String, maxlength: 200, default: '' },
    category: { type: String, default: 'CONDITION HUBS', index: true },
    type: { type: String, enum: ['text', 'forum', 'announcement'], default: 'text' },
    order: { type: Number, default: 0 },
    memberCount: { type: Number, default: 0 },
    messageCount: { type: Number, default: 0 },
    isFeatured: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const CommunityChannel: Model<ICommunityChannelDoc> =
  mongoose.model<ICommunityChannelDoc>('CommunityChannel', CommunityChannelSchema);
