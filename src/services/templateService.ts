/**
 * Copies bundled template data into a user's own MongoDB collections.
 * Each item gets the user's userId and its templateKey for de-duplication.
 */
import mongoose from 'mongoose';
import {
  ALL_CATEGORY_TEMPLATES,
  QUICK_ACTION_TEMPLATES,
  CONDITION_BUNDLES,
  TemplateCategory,
  TemplateQuickAction,
} from '@lumen/shared';
import { Category } from '../models/Category';
import { Question } from '../models/Question';
import { Option } from '../models/Option';
import { QuickAction } from '../models/QuickAction';

async function applyCategory(
  userId: string,
  tmpl: TemplateCategory,
  baseOrder: number,
): Promise<void> {
  const uid = new mongoose.Types.ObjectId(userId);

  // Skip if already applied
  const existing = await Category.findOne({ userId: uid, templateKey: tmpl.templateKey });
  if (existing) return;

  const category = await Category.create({
    userId: uid,
    name: tmpl.name,
    icon: tmpl.icon,
    color: tmpl.color,
    role: tmpl.role,
    order: baseOrder,
    isActive: true,
    templateKey: tmpl.templateKey,
  });

  for (const qTmpl of tmpl.questions) {
    const existingQ = await Question.findOne({ userId: uid, templateKey: qTmpl.templateKey });
    if (existingQ) continue;

    const question = await Question.create({
      userId: uid,
      categoryId: category._id,
      title: qTmpl.title,
      helpText: qTmpl.helpText,
      icon: qTmpl.icon,
      selectionType: qTmpl.selectionType,
      allowOther: qTmpl.allowOther,
      required: qTmpl.required,
      frequency: qTmpl.frequency,
      order: qTmpl.order,
      version: 1,
      isActive: true,
      templateKey: qTmpl.templateKey,
    });

    for (const oTmpl of qTmpl.options) {
      const existingO = await Option.findOne({ userId: uid, templateKey: oTmpl.templateKey });
      if (existingO) continue;

      await Option.create({
        userId: uid,
        questionId: question._id,
        label: oTmpl.label,
        icon: oTmpl.icon,
        color: oTmpl.color,
        allowComment: oTmpl.allowComment,
        captureTime: oTmpl.captureTime,
        fields: oTmpl.fields,
        order: oTmpl.order,
        isActive: true,
        templateKey: oTmpl.templateKey,
      });
    }
  }
}

async function applyQuickAction(userId: string, tmpl: TemplateQuickAction, existingCount: number): Promise<void> {
  const uid = new mongoose.Types.ObjectId(userId);
  const existing = await QuickAction.findOne({ userId: uid, templateKey: tmpl.templateKey });
  if (existing) return;

  await QuickAction.create({
    userId: uid,
    label: tmpl.label,
    icon: tmpl.icon,
    color: tmpl.color,
    mode: tmpl.mode,
    defaultValue: tmpl.defaultValue,
    unit: tmpl.unit,
    dailyGoal: tmpl.dailyGoal,
    order: existingCount + tmpl.order,
    isVisible: true,
    templateKey: tmpl.templateKey,
  });
}

/** Apply all templates from a condition bundle to a user. Safe to call multiple times (idempotent). */
export async function applyConditionBundle(userId: string, bundleKey: string): Promise<void> {
  const bundle = CONDITION_BUNDLES.find(b => b.key === bundleKey);
  if (!bundle) throw new Error(`Unknown bundle: ${bundleKey}`);

  const existingCategoryCount = await Category.countDocuments({ userId: new mongoose.Types.ObjectId(userId) });

  for (let i = 0; i < bundle.categoryKeys.length; i++) {
    const tmpl = ALL_CATEGORY_TEMPLATES.find(c => c.templateKey === bundle.categoryKeys[i]);
    if (tmpl) await applyCategory(userId, tmpl, existingCategoryCount + i);
  }

  const existingQACount = await QuickAction.countDocuments({ userId: new mongoose.Types.ObjectId(userId) });
  for (let i = 0; i < bundle.quickActionKeys.length; i++) {
    const tmpl = QUICK_ACTION_TEMPLATES.find(qa => qa.templateKey === bundle.quickActionKeys[i]);
    if (tmpl) await applyQuickAction(userId, tmpl, existingQACount);
  }
}

/** Apply a list of templateKeys (mixed — can be categories or quick actions). */
export async function applyTemplateKeys(userId: string, templateKeys: string[]): Promise<{ applied: string[]; skipped: string[] }> {
  const applied: string[] = [];
  const skipped: string[] = [];

  const existingCategoryCount = await Category.countDocuments({ userId: new mongoose.Types.ObjectId(userId) });
  const existingQACount = await QuickAction.countDocuments({ userId: new mongoose.Types.ObjectId(userId) });

  for (const key of templateKeys) {
    const catTmpl = ALL_CATEGORY_TEMPLATES.find(c => c.templateKey === key);
    if (catTmpl) {
      await applyCategory(userId, catTmpl, existingCategoryCount);
      applied.push(key);
      continue;
    }

    const qaTmpl = QUICK_ACTION_TEMPLATES.find(qa => qa.templateKey === key);
    if (qaTmpl) {
      await applyQuickAction(userId, qaTmpl, existingQACount);
      applied.push(key);
      continue;
    }

    skipped.push(key);
  }

  return { applied, skipped };
}
