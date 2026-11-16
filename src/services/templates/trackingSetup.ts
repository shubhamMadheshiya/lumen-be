/**
 * What Lumen AI needs to suggest tracking changes: the member's current setup (categories →
 * questions → options with ids), how much each part was used in the last 90 days, what they keep
 * typing under "Other", and the Lumen template library to reuse first.
 */
import mongoose from 'mongoose';
import { LogEntry } from '../../models/LogEntry';
import { ALL_CATEGORY_TEMPLATES, QUICK_ACTION_TEMPLATES } from '../../shared/templates/library';
import { loadConfig } from './aiTemplateDraft';

const USAGE_DAYS = 90;

export async function getTrackingSetup(userId: string, now = new Date()) {
  const uid = new mongoose.Types.ObjectId(userId);
  const since = new Date(now.getTime() - USAGE_DAYS * 86_400_000);
  const [config, optionUsage, categoryUsage, typed] = await Promise.all([
    loadConfig(userId),
    LogEntry.aggregate<{ _id: string; count: number; last: Date }>([
      { $match: { userId: uid, deletedAt: { $exists: false }, occurredAt: { $gte: since } } },
      { $unwind: '$answers' },
      { $group: { _id: '$answers.optionId', count: { $sum: 1 }, last: { $max: '$occurredAt' } } },
    ]),
    LogEntry.aggregate<{ _id: unknown; count: number; last: Date }>([
      { $match: { userId: uid, deletedAt: { $exists: false }, occurredAt: { $gte: since }, categoryId: { $ne: null } } },
      { $group: { _id: '$categoryId', count: { $sum: 1 }, last: { $max: '$occurredAt' } } },
    ]),
    LogEntry.aggregate<{ _id: { text: string; questionId: unknown }; count: number }>([
      { $match: { userId: uid, deletedAt: { $exists: false }, occurredAt: { $gte: since } } },
      { $unwind: '$answers' },
      { $project: { questionId: 1, text: { $toLower: { $trim: { input: { $ifNull: ['$answers.otherText', ''] } } } } } },
      { $match: { text: { $ne: '' } } },
      { $group: { _id: { text: '$text', questionId: '$questionId' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 15 },
    ]),
  ]);

  const optUse = new Map(optionUsage.map(u => [String(u._id), u]));
  const catUse = new Map(categoryUsage.map(u => [String(u._id), u]));
  const day = (d?: Date) => (d ? new Date(d).toISOString().slice(0, 10) : null);

  const categories = config.categories.slice(0, 40).map(c => {
    const questions = config.questions.filter(q => String(q.categoryId) === String(c._id)).slice(0, 25).map(q => ({
      id: String(q._id),
      title: q.title,
      options: config.options.filter(o => String(o.questionId) === String(q._id)).slice(0, 40).map(o => ({
        id: String(o._id), label: o.label, uses90d: optUse.get(String(o._id))?.count ?? 0, lastUsed: day(optUse.get(String(o._id))?.last),
      })),
    }));
    return {
      id: String(c._id), name: c.name, role: c.role, templateKey: c.templateKey ?? null, addedOn: day(c.createdAt as Date | undefined),
      uses90d: catUse.get(String(c._id))?.count ?? 0, lastUsed: day(catUse.get(String(c._id))?.last), questions,
    };
  });

  const questionTitle = new Map(config.questions.map(q => [String(q._id), q.title]));
  return {
    usageWindowDays: USAGE_DAYS,
    categories,
    quickActions: config.quickActions.map(q => ({ id: String(q._id), label: q.label, templateKey: q.templateKey ?? null })),
    typedUnderOther: typed.map(t => ({
      text: t._id.text, count: t.count, questionId: t._id.questionId ? String(t._id.questionId) : null,
      questionTitle: t._id.questionId ? questionTitle.get(String(t._id.questionId)) ?? null : null,
    })),
    library: {
      categories: ALL_CATEGORY_TEMPLATES.map(c => ({ key: c.templateKey, name: c.name, role: c.role, questions: c.questions.map(q => q.title) })),
      quickActions: QUICK_ACTION_TEMPLATES.map(q => ({ key: q.templateKey, label: q.label })),
    },
  };
}
