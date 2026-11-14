import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IAiMessage {
  role: 'user' | 'assistant';
  text: string;
  mediaIds: string[];
  createdAt: Date;
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
    createdAt: { type: Date, default: Date.now },
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
