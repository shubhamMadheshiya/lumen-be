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
  /** A notice such as "Ana added Cy" shown in the middle of the chat, not a person's message. */
  isSystem?: boolean;
  /** Forwarded from another chat. forwardedFrom.displayName is left out when the original was anonymous. */
  isForwarded?: boolean;
  forwardedFrom?: { displayName?: string };
  content: string;
  contentWarning?: string;
  isEdited?: boolean;
  editedAt?: Date;
  isPinned?: boolean;
  pinnedAt?: Date;
  pinnedBy?: {
    userId: mongoose.Types.ObjectId;
    displayName: string;
  };
  mentions?: string[];
  audioUrl?: string;
  audioMediaId?: mongoose.Types.ObjectId;
  audioDurationSeconds?: number;
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
    photoMediaId?: string;
    /** Several photos in one message (the first is also in photoMediaId for older app versions). */
    photos?: Array<{ photoMediaId: string; photoUrl?: string; width?: number; height?: number; isGif?: boolean }>;
    caption?: string;
    /** A GIF from GIF search. */
    gifUrl?: string;
    previewUrl?: string;
    gifId?: string;
    width?: number;
    height?: number;
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
    isSystem: { type: Boolean, default: false },
    isForwarded: { type: Boolean, default: false },
    forwardedFrom: { displayName: { type: String, maxlength: 80 } },
    content: { type: String, maxlength: 3000, default: '' },
    contentWarning: { type: String, maxlength: 60 },
    isEdited: { type: Boolean, default: false },
    editedAt: { type: Date },
    isPinned: { type: Boolean, default: false, index: true },
    pinnedAt: { type: Date },
    pinnedBy: {
      userId: { type: Schema.Types.ObjectId, ref: 'User' },
      displayName: { type: String },
    },
    mentions: { type: [String], default: [] },
    audioUrl: { type: String },
    audioMediaId: { type: Schema.Types.ObjectId, ref: 'Media' },
    audioDurationSeconds: { type: Number },
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
      enum: ['note', 'todo_list', 'log_template', 'photo', 'gif'],
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
