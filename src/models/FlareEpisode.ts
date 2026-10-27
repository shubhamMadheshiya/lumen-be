import mongoose, { Schema, Document, Model } from 'mongoose';

/** A stretch of days the member was (or probably was) flaring, with the rule that said so. */
export interface IFlareEpisodeDoc extends Document {
  userId: mongoose.Types.ObjectId;
  startDay: string; // YYYY-MM-DD Lumen day
  endDay: string;
  source: 'explicit' | 'inferred';
  rule: string;
  /** The member's answer to "Was this a flare?"; inferred episodes count fully only when 'yes'. */
  confirmed: 'yes' | 'no' | null;
  createdAt: Date;
  updatedAt: Date;
}

const FlareEpisodeSchema = new Schema<IFlareEpisodeDoc>(
  {
    userId:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
    startDay:  { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    endDay:    { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    source:    { type: String, enum: ['explicit', 'inferred'], required: true },
    rule:      { type: String, required: true },
    confirmed: { type: String, enum: ['yes', 'no', null], default: null },
  },
  { timestamps: true },
);

FlareEpisodeSchema.index({ userId: 1, startDay: 1 }, { unique: true });

export const FlareEpisode: Model<IFlareEpisodeDoc> = mongoose.model<IFlareEpisodeDoc>('FlareEpisode', FlareEpisodeSchema);
