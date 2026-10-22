import mongoose, { Schema, Document, Model } from 'mongoose';
import { NoteBlockType } from '../shared/types';

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
  blocks: INoteBlockDoc[];
  parentNoteId?: mongoose.Types.ObjectId;
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

const NoteSchema = new Schema<INoteDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, maxlength: 300, default: 'Untitled', index: true },
    icon: { type: String, default: '📝', maxlength: 30 },
    coverGradient: { type: String, default: 'linear-gradient(135deg, #1E1B4B 0%, #312E81 100%)' },
    blocks: { type: [NoteBlockSubSchema], default: [] },
    parentNoteId: { type: Schema.Types.ObjectId, ref: 'Note', index: true },
    isPinned: { type: Boolean, default: false, index: true },
    isArchived: { type: Boolean, default: false, index: true },
    tags: [{ type: String, maxlength: 50, index: true }],
    linkedSymptomIds: [{ type: String }],
    linkedMedicationIds: [{ type: String }],
    linkedLogEntryIds: [{ type: String }],
  },
  { timestamps: true }
);

export const Note: Model<INoteDoc> = mongoose.model<INoteDoc>('Note', NoteSchema);
