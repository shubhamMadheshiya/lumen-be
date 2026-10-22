import mongoose, { Schema, Document, Model } from 'mongoose';
import {
  CommunityEmbedType,
  INoteEmbedPayload,
  ITodoEmbedPayload,
  ILogTemplateEmbedPayload,
} from '../shared/types';

export interface ICommunityMessageDoc extends Document {
  channelId: mongoose.Types.ObjectId;
  senderId: mongoose.Types.ObjectId;
  senderDisplayName: string;
  senderAvatarEmoji?: string;
  senderRoleColor?: string;
  senderRoleBadges?: string[];
  isAnonymous: boolean;
  content: string;
  replyTo?: {
    messageId: mongoose.Types.ObjectId;
    senderDisplayName: string;
    snippet: string;
  };
  threadMeta?: {
    replyCount: number;
    lastReplyAt?: Date;
  };
  embedType?: CommunityEmbedType;
  embedData?: {
    note?: INoteEmbedPayload;
    todo?: ITodoEmbedPayload;
    logTemplate?: ILogTemplateEmbedPayload;
    photoUrl?: string;
    caption?: string;
  };
  reactions: Map<string, number>;
  userReactions: Map<string, string[]>; // userId -> list of emojis
  cloneCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const CommunityMessageSchema = new Schema<ICommunityMessageDoc>(
  {
    channelId: { type: Schema.Types.ObjectId, ref: 'CommunityChannel', required: true, index: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    senderDisplayName: { type: String, required: true, maxlength: 80 },
    senderAvatarEmoji: { type: String, default: '🥄', maxlength: 20 },
    senderRoleColor: { type: String, default: '#38BDF8', maxlength: 20 },
    senderRoleBadges: { type: [String], default: [] },
    isAnonymous: { type: Boolean, default: false },
    content: { type: String, maxlength: 3000, default: '' },
    replyTo: {
      messageId: { type: Schema.Types.ObjectId, ref: 'CommunityMessage' },
      senderDisplayName: { type: String },
      snippet: { type: String },
    },
    threadMeta: {
      replyCount: { type: Number, default: 0 },
      lastReplyAt: { type: Date },
    },
    embedType: {
      type: String,
      enum: ['note', 'todo_list', 'log_template', 'photo'],
    },
    embedData: { type: Schema.Types.Mixed },
    reactions: {
      type: Map,
      of: Number,
      default: {},
    },
    userReactions: {
      type: Map,
      of: [String],
      default: {},
    },
    cloneCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

CommunityMessageSchema.index({ channelId: 1, createdAt: -1 });

export const CommunityMessage: Model<ICommunityMessageDoc> =
  mongoose.model<ICommunityMessageDoc>('CommunityMessage', CommunityMessageSchema);
