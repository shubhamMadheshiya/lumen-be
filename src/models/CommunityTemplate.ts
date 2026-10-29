import mongoose, { Schema, Document, Model } from 'mongoose';
import {
  CommunityTemplateCategory,
  CommunityTemplateQuickAction,
} from '../shared';

export interface ICommunityTemplateDoc extends Document {
  creatorId: mongoose.Types.ObjectId;
  creatorDisplayName: string;
  isAnonymous: boolean;
  title: string;
  description: string;
  conditionTags: string[];
  icon: string;
  color: string;
  categories: CommunityTemplateCategory[];
  quickActions: CommunityTemplateQuickAction[];
  installCount: number;
  likesCount: number;
  isVerified: boolean;
  flags: Array<{
    userId: mongoose.Types.ObjectId;
    reason: string;
    createdAt: Date;
  }>;
  flagCount: number;
  status: 'published' | 'hidden_flagged' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

const OptionFieldSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    dataType: { type: String, required: true },
    unit: { type: String },
    allowedUnits: [{ type: String }],
    min: { type: Number },
    max: { type: Number },
    step: { type: Number },
    enumValues: [
      {
        value: { type: String, required: true },
        label: { type: String, required: true },
        icon: { type: String },
        color: { type: String },
        description: { type: String },
      },
    ],
    required: { type: Boolean, default: false },
    placeholder: { type: String },
    displayAs: { type: String },
    helpText: { type: String },
  },
  { _id: false },
);

const OptionSchema = new Schema(
  {
    label: { type: String, required: true },
    icon: { type: String },
    color: { type: String },
    allowComment: { type: Boolean, default: false },
    captureTime: { type: String, enum: ['none', 'auto_now', 'user_picks'], default: 'none' },
    fields: [OptionFieldSchema],
  },
  { _id: false },
);

const QuestionSchema = new Schema(
  {
    title: { type: String, required: true },
    helpText: { type: String },
    icon: { type: String },
    selectionType: { type: String, enum: ['single', 'multiple'], default: 'single' },
    allowOther: { type: Boolean, default: false },
    required: { type: Boolean, default: false },
    frequency: {
      type: String,
      enum: ['anytime', 'once_per_day', 'morning', 'evening'],
      default: 'anytime',
    },
    options: [OptionSchema],
  },
  { _id: false },
);

const CategorySchema = new Schema(
  {
    name: { type: String, required: true },
    icon: { type: String, required: true },
    color: { type: String, required: true },
    role: { type: String, enum: ['trigger_candidate', 'symptom', 'context'], required: true },
    questions: [QuestionSchema],
  },
  { _id: false },
);

const QuickActionSchema = new Schema(
  {
    label: { type: String, required: true },
    icon: { type: String, required: true },
    color: { type: String, required: true },
    mode: { type: String, enum: ['counter', 'timer', 'toggle'], required: true },
    defaultValue: { type: Number },
    unit: { type: String },
    dailyGoal: { type: Number },
  },
  { _id: false },
);

const CommunityTemplateSchema = new Schema<ICommunityTemplateDoc>(
  {
    creatorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    creatorDisplayName: { type: String, required: true, default: 'Lumen Community Member' },
    isAnonymous: { type: Boolean, default: true },
    title: { type: String, required: true, maxlength: 100, index: 'text' },
    description: { type: String, required: true, maxlength: 1000 },
    conditionTags: [{ type: String, index: true }],
    icon: { type: String, required: true, default: '📋' },
    color: { type: String, required: true, default: '#4A90E2' },
    categories: [CategorySchema],
    quickActions: [QuickActionSchema],
    installCount: { type: Number, default: 0, index: true },
    likesCount: { type: Number, default: 0 },
    isVerified: { type: Boolean, default: false, index: true },
    flags: [
      {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        reason: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    flagCount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['published', 'hidden_flagged', 'archived'],
      default: 'published',
      index: true,
    },
  },
  { timestamps: true },
);

CommunityTemplateSchema.index({ status: 1, createdAt: -1 });
CommunityTemplateSchema.index({ status: 1, installCount: -1 });

export const CommunityTemplate: Model<ICommunityTemplateDoc> = mongoose.model<ICommunityTemplateDoc>(
  'CommunityTemplate',
  CommunityTemplateSchema,
);
