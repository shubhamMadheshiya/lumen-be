import mongoose, { Schema, Document, Model } from 'mongoose';

/** Cache of narration/Q&A text already produced, keyed by a hash of (facts, promptVersion, model). */
export interface INarrationDoc extends Document {
  userId: mongoose.Types.ObjectId;
  hash: string;
  text: string;
  source: 'ai' | 'template';
  llmModel: string;
  createdAt: Date;
}

const NarrationSchema = new Schema<INarrationDoc>(
  {
    userId:   { type: Schema.Types.ObjectId, ref: 'User', required: true },
    hash:     { type: String, required: true },
    text:     { type: String, required: true },
    source:   { type: String, enum: ['ai', 'template'], required: true },
    llmModel: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

NarrationSchema.index({ userId: 1, hash: 1 }, { unique: true });

export const Narration: Model<INarrationDoc> = mongoose.model<INarrationDoc>('Narration', NarrationSchema);
