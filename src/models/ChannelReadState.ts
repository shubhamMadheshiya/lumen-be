import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IChannelReadStateDoc extends Document {
  userId: mongoose.Types.ObjectId;
  channelId: mongoose.Types.ObjectId;
  lastReadMessageId?: mongoose.Types.ObjectId;
  lastReadAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ChannelReadStateSchema = new Schema<IChannelReadStateDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    channelId: { type: Schema.Types.ObjectId, ref: 'CommunityChannel', required: true, index: true },
    lastReadMessageId: { type: Schema.Types.ObjectId, ref: 'CommunityMessage' },
    lastReadAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

ChannelReadStateSchema.index({ userId: 1, channelId: 1 }, { unique: true });

export const ChannelReadState: Model<IChannelReadStateDoc> =
  mongoose.model<IChannelReadStateDoc>('ChannelReadState', ChannelReadStateSchema);

