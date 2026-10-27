import mongoose from 'mongoose';
import { EarlyWarningState } from '../models/EarlyWarningState';
import { FlareEpisode } from '../models/FlareEpisode';
import { applyEarlyWarningFeedback, runAndStoreEarlyWarning } from '../services/insights/earlyWarningService';
import { DayRow } from '../services/insights/dayTable';
import { shiftDayKey } from '../utils/dayKey';

jest.mock('../models/EarlyWarningState', () => ({
  EarlyWarningState: { findOne: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn() },
}));
jest.mock('../models/FlareEpisode', () => ({ FlareEpisode: { find: jest.fn() } }));

const uid = String(new mongoose.Types.ObjectId());
const row = (dayKey: string): DayRow => ({
  dayKey, symptomObserved: true, observedBasis: 'symptom_entry', exposureObserved: true,
  entryCount: 1, distinctHours: 1, engagement: 0, nonSymptomEntries: 0, symptoms: [], exposures: [], reactiveCount: 0,
  symptomPresent: true, symptomMax: 4, symptomMean: 4, patientGlobal: null, noSymptomsCheckIn: false,
  explicitFlare: false, steps: null, walkMinutes: null, wakeTime: null, sleepTime: null, sleepHours: null,
});

function chain(result: unknown) {
  return { select: () => ({ lean: async () => result }) };
}

describe('runAndStoreEarlyWarning', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (FlareEpisode.find as jest.Mock).mockReturnValue(chain([]));
  });

  it('persists the engine result, including a null track record with no episodes', async () => {
    (EarlyWarningState.findOne as jest.Mock).mockReturnValue({ lean: async () => null });
    const rows = Array.from({ length: 20 }, (_, i) => row(shiftDayKey('2026-01-01', i)));
    await runAndStoreEarlyWarning(uid, rows);

    expect(EarlyWarningState.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update, opts] = (EarlyWarningState.updateOne as jest.Mock).mock.calls[0];
    expect(filter).toMatchObject({ userId: expect.anything() });
    expect(update.$set).toMatchObject({ enabledLevel: 0, trackRecordFollowed: null, trackRecordOf: null });
    expect(opts).toEqual({ upsert: true });
  });

  it('does nothing when the member has asked to stop', async () => {
    (EarlyWarningState.findOne as jest.Mock).mockReturnValue({ lean: async () => ({ disabledByMember: true }) });
    await runAndStoreEarlyWarning(uid, [row('2026-01-01')]);
    expect(EarlyWarningState.updateOne).not.toHaveBeenCalled();
  });

  it('passes the member\'s raised-threshold override into the engine', async () => {
    (EarlyWarningState.findOne as jest.Mock).mockReturnValue({ lean: async () => ({ percentileOverride: 0.97 }) });
    const rows = Array.from({ length: 20 }, (_, i) => row(shiftDayKey('2026-01-01', i)));
    await expect(runAndStoreEarlyWarning(uid, rows)).resolves.toBeUndefined();
    expect(EarlyWarningState.updateOne).toHaveBeenCalledTimes(1);
  });
});

describe('applyEarlyWarningFeedback', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does nothing for "helpful"', async () => {
    await applyEarlyWarningFeedback(uid, 'helpful');
    expect(EarlyWarningState.updateOne).not.toHaveBeenCalled();
    expect(EarlyWarningState.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('raises the percentile threshold on "not this time"', async () => {
    await applyEarlyWarningFeedback(uid, 'not_this_time');
    expect(EarlyWarningState.updateOne).toHaveBeenCalledWith(
      { userId: expect.anything() },
      { $set: { percentileOverride: 0.97 } },
      { upsert: true },
    );
  });

  it('disables the feature only after the second "stop" tap', async () => {
    (EarlyWarningState.findOneAndUpdate as jest.Mock).mockResolvedValueOnce({ stopTaps: 1 });
    await applyEarlyWarningFeedback(uid, 'stop');
    expect(EarlyWarningState.updateOne).not.toHaveBeenCalled();

    (EarlyWarningState.findOneAndUpdate as jest.Mock).mockResolvedValueOnce({ stopTaps: 2 });
    await applyEarlyWarningFeedback(uid, 'stop');
    expect(EarlyWarningState.updateOne).toHaveBeenCalledWith(
      { userId: expect.anything() },
      { $set: { disabledByMember: true, alert: false } },
    );
  });
});
