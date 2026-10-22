import mongoose, { Schema, Document, Model } from 'mongoose';
import {
  CommunityEmbedType,
  INoteEmbedPayload,
  ITodoEmbedPayload,
  ILogTemplateEmbedPayload,
} from '../shared/types';

export interface IForumPostDoc extends Document {
  channelId: mongoose.Types.ObjectId;
  title: string;
  tags: string[];
  author: {
    senderId: mongoose.Types.ObjectId;
    senderDisplayName: string;
    senderAvatarEmoji?: string;
    isAnonymous: boolean;
    senderRoleColor?: string;
    senderRoleBadges?: string[];
  };
  content: string;
  embedType?: CommunityEmbedType;
  embedData?: {
    note?: INoteEmbedPayload;
    todo?: ITodoEmbedPayload;
    logTemplate?: ILogTemplateEmbedPayload;
    photoUrl?: string;
  };
  stats: {
    replyCount: number;
    spoonsCount: number;
    cloneCount: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const ForumPostSchema = new Schema<IForumPostDoc>(
  {
    channelId: { type: Schema.Types.ObjectId, ref: 'CommunityChannel', required: true, index: true },
    title: { type: String, required: true, maxlength: 200 },
    tags: { type: [String], default: [] },
    author: {
      senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      senderDisplayName: { type: String, required: true, maxlength: 80 },
      senderAvatarEmoji: { type: String, default: '🥄', maxlength: 20 },
      isAnonymous: { type: Boolean, default: false },
      senderRoleColor: { type: String, default: '#38BDF8', maxlength: 20 },
      senderRoleBadges: { type: [String], default: [] },
    },
    content: { type: String, required: true, maxlength: 10000 },
    embedType: {
      type: String,
      enum: ['note', 'todo_list', 'log_template', 'photo'],
    },
    embedData: { type: Schema.Types.Mixed },
    stats: {
      replyCount: { type: Number, default: 0 },
      spoonsCount: { type: Number, default: 0 },
      cloneCount: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

ForumPostSchema.index({ channelId: 1, createdAt: -1 });

export const ForumPost: Model<IForumPostDoc> =
  mongoose.model<IForumPostDoc>('ForumPost', ForumPostSchema);
