import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ICustomUnitDoc extends Document {
  userId: mongoose.Types.ObjectId;
  symbol: string;
  name: string;
  dimension?: string;
  factorToBase?: number;
  createdAt: Date;
  updatedAt: Date;
}

const CustomUnitSchema = new Schema<ICustomUnitDoc>(
  {
    userId:       { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    symbol:       { type: String, required: true, maxlength: 20 },
    name:         { type: String, required: true, maxlength: 60 },
    dimension:    { type: String },
    factorToBase: { type: Number },
  },
  { timestamps: true },
);

CustomUnitSchema.index({ userId: 1, symbol: 1 }, { unique: true });

export const CustomUnit: Model<ICustomUnitDoc> = mongoose.model<ICustomUnitDoc>('CustomUnit', CustomUnitSchema);
