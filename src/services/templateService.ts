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
} from '../shared';
import { Category } from '../models/Category';
import { Question } from '../models/Question';
import { Option } from '../models/Option';
import { QuickAction } from '../models/QuickAction';
import { User } from '../models/User';
import { CommunityTemplate } from '../models/CommunityTemplate';


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

/**
 * Installs a community template into a user's configuration.
 * Creates brand-new independent Category, Question, and Option records
 * without overriding or modifying any existing user categories or logs.
 */
export async function installCommunityTemplate(
  userId: string,
  templateId: string,
): Promise<{ categoriesInstalled: number; quickActionsInstalled: number; templateTitle: string }> {
  const template = await CommunityTemplate.findById(templateId);
  if (!template) {
    throw new Error('Community template not found');
  }
  if (template.status === 'hidden_flagged') {
    throw new Error('This template is currently flagged and unavailable for installation');
  }

  const uid = new mongoose.Types.ObjectId(userId);
  const baseCategoryOrder = await Category.countDocuments({ userId: uid });
  let categoriesInstalled = 0;
  let quickActionsInstalled = 0;

  for (let catIdx = 0; catIdx < template.categories.length; catIdx++) {
    const catTmpl = template.categories[catIdx];

    const category = await Category.create({
      userId: uid,
      name: catTmpl.name,
      icon: catTmpl.icon || '📝',
      color: catTmpl.color || '#4A90E2',
      role: catTmpl.role,
      order: baseCategoryOrder + catIdx,
      isActive: true,
    });
    categoriesInstalled++;

    for (let qIdx = 0; qIdx < (catTmpl.questions || []).length; qIdx++) {
      const qTmpl = catTmpl.questions[qIdx];
      const question = await Question.create({
        userId: uid,
        categoryId: category._id,
        title: qTmpl.title,
        helpText: qTmpl.helpText,
        icon: qTmpl.icon,
        selectionType: qTmpl.selectionType || 'single',
        allowOther: qTmpl.allowOther ?? false,
        required: qTmpl.required ?? false,
        frequency: qTmpl.frequency || 'anytime',
        order: qIdx,
        version: 1,
        isActive: true,
      });

      for (let oIdx = 0; oIdx < (qTmpl.options || []).length; oIdx++) {
        const oTmpl = qTmpl.options[oIdx];
        await Option.create({
          userId: uid,
          questionId: question._id,
          label: oTmpl.label,
          icon: oTmpl.icon,
          color: oTmpl.color,
          allowComment: oTmpl.allowComment ?? false,
          captureTime: oTmpl.captureTime || 'none',
          fields: oTmpl.fields || [],
          order: oIdx,
          isActive: true,
        });
      }
    }
  }

  if (template.quickActions && template.quickActions.length > 0) {
    const baseQAOrder = await QuickAction.countDocuments({ userId: uid });
    for (let qaIdx = 0; qaIdx < template.quickActions.length; qaIdx++) {
      const qa = template.quickActions[qaIdx];
      await QuickAction.create({
        userId: uid,
        label: qa.label,
        icon: qa.icon,
        color: qa.color,
        mode: qa.mode,
        defaultValue: qa.defaultValue,
        unit: qa.unit,
        dailyGoal: qa.dailyGoal,
        order: baseQAOrder + qaIdx,
        isVisible: true,
      });
      quickActionsInstalled++;
    }
  }

  // Increment install count on template
  await CommunityTemplate.findByIdAndUpdate(templateId, { $inc: { installCount: 1 } });

  // Bump user configVersion so frontend cache refreshes
  await User.findByIdAndUpdate(uid, { $inc: { configVersion: 1 } });

  return {
    categoriesInstalled,
    quickActionsInstalled,
    templateTitle: template.title,
  };
}

