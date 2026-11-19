import mongoose, { Schema, Document, Model } from 'mongoose';
import { REF_KINDS, type ChatRef } from '../services/llm/assistant/refTypes';

export interface IAiMessage {
  role: 'user' | 'assistant';
  text: string;
  mediaIds: string[];
  /** Member messages: Lumen items and PDFs attached to it (a day, a note, a lab report...). */
  refs?: ChatRef[];
  createdAt: Date;
  /** Assistant replies: which provider/model wrote it, and the tokens it used (for the cost estimate). */
  provider?: 'gemini' | 'claude';
  llmModel?: string;
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number };
  /** Notes and template drafts this reply made. */
  artifacts?: { type: 'note' | 'template_draft'; id: string; title: string }[];
}

/** One Lumen AI chat thread. Only the member who owns it can read it. */
export interface IAiConversationDoc extends Document {
  userId: mongoose.Types.ObjectId;
  title: string;
  /** Set when the thread started from "Analyse with AI" on a photo. */
  sourceMediaId?: string;
  messages: IAiMessage[];
  createdAt: Date;
  updatedAt: Date;
}

const AiMessageSchema = new Schema<IAiMessage>(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    text: { type: String, default: '', maxlength: 20000 },
    mediaIds: [{ type: String }],
    refs: {
      type: [new Schema({ kind: { type: String, enum: REF_KINDS, required: true }, id: { type: String, required: true }, title: { type: String, maxlength: 200 } }, { _id: false })],
      default: undefined,
    },
    createdAt: { type: Date, default: Date.now },
    provider: { type: String, enum: ['gemini', 'claude'] },
    llmModel: { type: String },
    usage: {
      inputTokens: { type: Number },
      outputTokens: { type: Number },
      cacheReadTokens: { type: Number },
      cacheWriteTokens: { type: Number },
    },
    artifacts: {
      type: [new Schema({ type: { type: String, enum: ['note', 'template_draft'] }, id: String, title: String }, { _id: false })],
      default: undefined,
    },
  },
  { _id: true },
);

const AiConversationSchema = new Schema<IAiConversationDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, default: 'New chat', maxlength: 120 },
    sourceMediaId: { type: String },
    messages: [AiMessageSchema],
  },
  { timestamps: true },
);

AiConversationSchema.index({ userId: 1, updatedAt: -1 });

export const AiConversation: Model<IAiConversationDoc> =
  mongoose.model<IAiConversationDoc>('AiConversation', AiConversationSchema);
