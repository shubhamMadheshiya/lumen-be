import mongoose, { Schema, Document, Model } from 'mongoose';

/** Daily weather where the member was (rounded location), always stored in °C / hPa / mm. */
export interface IWeatherDayDoc extends Document {
  userId: mongoose.Types.ObjectId;
  dayKey: string;
  lat: number;
  lon: number;
  tMaxC: number | null;
  tMinC: number | null;
  humidity: number | null;
  pressureHpa: number | null;
  /** Change in mean pressure from the day before (hPa). */
  pressureDelta: number | null;
  uvMax: number | null;
  precipMm: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const WeatherDaySchema = new Schema<IWeatherDayDoc>(
  {
    userId:   { type: Schema.Types.ObjectId, ref: 'User', required: true },
    dayKey:   { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    lat:      { type: Number, required: true },
    lon:      { type: Number, required: true },
    tMaxC:    { type: Number, default: null },
    tMinC:    { type: Number, default: null },
    humidity: { type: Number, default: null },
    pressureHpa:   { type: Number, default: null },
    pressureDelta: { type: Number, default: null },
    uvMax:    { type: Number, default: null },
    precipMm: { type: Number, default: null },
  },
  { timestamps: true },
);

WeatherDaySchema.index({ userId: 1, dayKey: 1 }, { unique: true });
WeatherDaySchema.index({ userId: 1, updatedAt: 1 });

export const WeatherDay: Model<IWeatherDayDoc> = mongoose.model<IWeatherDayDoc>('WeatherDay', WeatherDaySchema);
