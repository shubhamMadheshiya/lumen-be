import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * A log template Lumen AI proposed: library items expanded, custom items already turned into valid
 * fields, each with `include` (the member can untick it) and `exists` (already tracked). Nothing
 * reaches the member's config until they apply it, and an applied draft can be undone.
 */
export interface DraftField {
  key: string; label: string; dataType: string; unit?: string; allowedUnits?: string[];
  min?: number; max?: number; step?: number; displayAs?: string; helpText?: string; placeholder?: string;
}
export interface DraftOption {
  id: string; templateKey?: string; label: string; icon?: string; allowComment: boolean;
  captureTime: 'none' | 'user_picks'; fields: DraftField[]; measure: string; include: boolean; existingId?: string;
}
export interface DraftQuestion {
  id: string; templateKey?: string; title: string; helpText?: string; selectionType: 'single' | 'multiple';
  allowOther: boolean; frequency: 'anytime' | 'once_per_day' | 'morning' | 'evening';
  options: DraftOption[]; include: boolean; existingId?: string;
}
export interface DraftCategory {
  id: string; templateKey?: string; name: string; icon: string; color: string;
  role: 'trigger_candidate' | 'symptom' | 'context'; fromLibrary: boolean;
  questions: DraftQuestion[]; include: boolean; existingId?: string;
}
export interface DraftAddOptions { id: string; questionId: string; questionTitle: string; options: DraftOption[] }
export interface DraftQuickAction {
  id: string; templateKey?: string; label: string; icon: string; color: string; mode: 'counter' | 'timer' | 'toggle';
  unit?: string; dailyGoal?: number; fromLibrary: boolean; include: boolean; existingId?: string;
}
export interface DraftArchive { id: string; kind: 'category' | 'question' | 'option'; targetId: string; label: string; reason: string; include: boolean }
export interface AppliedRef { kind: 'category' | 'question' | 'option' | 'quickAction'; id: string }

export interface IAiTemplateDraftDoc extends Document {
  userId: mongoose.Types.ObjectId;
  title: string;
  summary: string;
  request?: string;
  categories: DraftCategory[];
  addOptions: DraftAddOptions[];
  quickActions: DraftQuickAction[];
  archive: DraftArchive[];
  status: 'draft' | 'applied' | 'undone' | 'discarded';
  applied: { created: AppliedRef[]; archived: AppliedRef[]; at?: Date };
  conversationId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AiTemplateDraftSchema = new Schema<IAiTemplateDraftDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, maxlength: 120 },
    summary: { type: String, default: '', maxlength: 1000 },
    request: { type: String, maxlength: 1000 },
    categories: { type: Schema.Types.Mixed, default: () => [] },
    addOptions: { type: Schema.Types.Mixed, default: () => [] },
    quickActions: { type: Schema.Types.Mixed, default: () => [] },
    archive: { type: Schema.Types.Mixed, default: () => [] },
    status: { type: String, enum: ['draft', 'applied', 'undone', 'discarded'], default: 'draft' },
    applied: {
      created: { type: Schema.Types.Mixed, default: () => [] },
      archived: { type: Schema.Types.Mixed, default: () => [] },
      at: { type: Date },
    },
    conversationId: { type: String },
  },
  { timestamps: true },
);

export const AiTemplateDraft: Model<IAiTemplateDraftDoc> =
  mongoose.model<IAiTemplateDraftDoc>('AiTemplateDraft', AiTemplateDraftSchema);
