import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IMediaDoc extends Document {
  userId: mongoose.Types.ObjectId;
  storageKey: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  blurhash?: string;
  sensitive: boolean;
  createdAt: Date;
}

const MediaSchema = new Schema<IMediaDoc>(
  {
    userId:     { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    storageKey: { type: String, required: true, unique: true },
    mimeType:   { type: String, required: true },
    size:       { type: Number, required: true },
    width:      { type: Number },
    height:     { type: Number },
    blurhash:   { type: String }, // compact visual preview, safe to store
    sensitive:  { type: Boolean, default: false }, // stool/urine/skin photos
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const Media: Model<IMediaDoc> = mongoose.model<IMediaDoc>('Media', MediaSchema);
