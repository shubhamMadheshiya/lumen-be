import mongoose, { Schema, Document, Model } from 'mongoose';

/** The early-warning engine's latest result for one member, plus their feedback on it. */
export interface IEarlyWarningStateDoc extends Document {
  userId: mongoose.Types.ObjectId;
  enabledLevel: 0 | 1;
  alert: boolean;
  alertLevel: 0 | 1 | null;
  suppressedByFlare: boolean;
  level1Enabled: boolean;
  level1GateReason?: 'too_few_episodes' | 'too_few_logged_days';
  episodeCount: number;
  loggedDays: number;
  backtest: unknown;
  trackRecordFollowed: number | null;
  trackRecordOf: number | null;
  /** "Not this time" raises this toward 0.99 so the bar gets harder to clear; unset uses the engine default. */
  percentileOverride?: number;
  /** Two "Stop these" taps turn the feature off for this member. */
  stopTaps: number;
  disabledByMember: boolean;
  computedAt: Date;
}

const EarlyWarningStateSchema = new Schema<IEarlyWarningStateDoc>(
  {
    userId:               { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    enabledLevel:          { type: Number, enum: [0, 1], required: true },
    alert:                 { type: Boolean, required: true },
    alertLevel:            { type: Number, enum: [0, 1, null], default: null },
    suppressedByFlare:     { type: Boolean, default: false },
    level1Enabled:         { type: Boolean, default: false },
    level1GateReason:      { type: String, enum: ['too_few_episodes', 'too_few_logged_days', null] },
    episodeCount:          { type: Number, default: 0 },
    loggedDays:            { type: Number, default: 0 },
    backtest:              { type: Schema.Types.Mixed },
    trackRecordFollowed:   { type: Number, default: null },
    trackRecordOf:         { type: Number, default: null },
    percentileOverride:    { type: Number },
    stopTaps:              { type: Number, default: 0 },
    disabledByMember:      { type: Boolean, default: false },
    computedAt:            { type: Date, required: true },
  },
  { timestamps: false },
);

export const EarlyWarningState: Model<IEarlyWarningStateDoc> =
  mongoose.model<IEarlyWarningStateDoc>('EarlyWarningState', EarlyWarningStateSchema);
