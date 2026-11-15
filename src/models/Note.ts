import mongoose, { Schema, Document, Model } from 'mongoose';
import { NoteBlockType, IDatabaseConfig } from '../shared/types';

export interface INoteBlockDoc {
  id: string;
  type: NoteBlockType;
  content: string;
  completed?: boolean;
  calloutIcon?: string;
  calloutColor?: string;
  isCollapsed?: boolean;
  children?: INoteBlockDoc[];
  imageUrl?: string;
}

export interface INoteDoc extends Document {
  userId: mongoose.Types.ObjectId;
  title: string;
  icon?: string;
  coverGradient?: string;
  coverMediaId?: string;
  doc?: Record<string, unknown>;
  plainText?: string;
  kind: 'page' | 'database';
  sortOrder: number;
  isFavorite: boolean;
  deletedAt?: Date | null;
  trashRootId?: mongoose.Types.ObjectId | null;
  linkedNoteIds: string[];
  mediaIds: string[];
  database?: IDatabaseConfig;
  rowProps?: Record<string, unknown>;
  blocks: INoteBlockDoc[];
  parentNoteId?: mongoose.Types.ObjectId | null;
  isPinned: boolean;
  isArchived: boolean;
  tags: string[];
  linkedSymptomIds?: string[];
  linkedMedicationIds?: string[];
  linkedLogEntryIds?: string[];
  createdAt: Date;
  updatedAt: Date;
}

const NoteBlockSubSchema: Schema = new Schema(
  {
    id: { type: String, required: true },
    type: {
      type: String,
      enum: [
        'paragraph',
        'heading_1',
        'heading_2',
        'heading_3',
        'todo',
        'bullet_list',
        'numbered_list',
        'toggle',
        'callout',
        'quote',
        'divider',
        'image',
      ],
      required: true,
    },
    content: { type: String, default: '' },
    completed: { type: Boolean },
    calloutIcon: { type: String },
    calloutColor: { type: String },
    isCollapsed: { type: Boolean },
    imageUrl: { type: String },
  },
  { _id: false }
);

// Enable recursive child blocks for toggle/nested blocks
NoteBlockSubSchema.add({
  children: [NoteBlockSubSchema],
});

const DatabasePropertySubSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    type: {
      type: String,
      enum: ['text', 'number', 'date', 'select', 'multi_select', 'checkbox', 'url'],
      required: true,
    },
    options: [
      {
        id: { type: String, required: true },
        name: { type: String, required: true },
        color: { type: String },
        _id: false,
      },
    ],
  },
  { _id: false }
);

const DatabaseViewSubSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    type: { type: String, enum: ['table', 'board'], required: true },
    sortPropId: { type: String },
    sortDirection: { type: String, enum: ['asc', 'desc'] },
    filterPropId: { type: String },
    filterValue: { type: Schema.Types.Mixed },
    groupByPropId: { type: String },
  },
  { _id: false }
);

const DatabaseConfigSubSchema = new Schema(
  {
    properties: { type: [DatabasePropertySubSchema], default: [] },
    views: { type: [DatabaseViewSubSchema], default: [] },
  },
  { _id: false }
);

const NoteSchema = new Schema<INoteDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, maxlength: 300, default: 'Untitled Note', index: true },
    icon: { type: String, default: '📝', maxlength: 30 },
    coverGradient: { type: String, default: 'linear-gradient(135deg, #1E1B4B 0%, #312E81 100%)' },
    coverMediaId: { type: String },
    doc: { type: Schema.Types.Mixed, default: null },
    plainText: { type: String, default: '' },
    kind: { type: String, enum: ['page', 'database'], default: 'page', index: true },
    sortOrder: { type: Number, default: 0, index: true },
    isFavorite: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null, index: true },
    trashRootId: { type: Schema.Types.ObjectId, ref: 'Note', default: null, index: true },
    linkedNoteIds: { type: [String], default: [], index: true },
    mediaIds: { type: [String], default: [] },
    database: { type: DatabaseConfigSubSchema, default: undefined },
    rowProps: { type: Map, of: Schema.Types.Mixed, default: undefined },
    blocks: { type: [NoteBlockSubSchema], default: [] },
    parentNoteId: { type: Schema.Types.ObjectId, ref: 'Note', index: true, default: null },
    isPinned: { type: Boolean, default: false, index: true },
    isArchived: { type: Boolean, default: false, index: true },
    tags: [{ type: String, maxlength: 50, index: true }],
    linkedSymptomIds: [{ type: String }],
    linkedMedicationIds: [{ type: String }],
    linkedLogEntryIds: [{ type: String }],
  },
  { timestamps: true }
);

// Indexes
NoteSchema.index({ userId: 1, parentNoteId: 1, sortOrder: 1 });
NoteSchema.index({ userId: 1, deletedAt: 1 });
NoteSchema.index({ userId: 1, linkedNoteIds: 1 });
NoteSchema.index({ title: 'text', plainText: 'text' });

export const Note: Model<INoteDoc> = mongoose.model<INoteDoc>('Note', NoteSchema);
