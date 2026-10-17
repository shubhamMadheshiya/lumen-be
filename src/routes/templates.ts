import { Router, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  ApplyTemplatesSchema,
  ALL_CATEGORY_TEMPLATES,
  QUICK_ACTION_TEMPLATES,
  CONDITION_BUNDLES,
  CreateCommunityTemplateSchema,
  CreateCommunityTemplateDto,
} from '../shared';
import {
  applyConditionBundle,
  applyTemplateKeys,
  installCommunityTemplate,
} from '../services/templateService';
import { CommunityTemplate } from '../models/CommunityTemplate';
import { User } from '../models/User';

export const templatesRouter = Router();
templatesRouter.use(authenticate);

// ─────────────────────────────────────────────
//  Official Built-in Templates
// ─────────────────────────────────────────────

// GET /templates — browse the full library
templatesRouter.get('/', (_req: AuthRequest, res: Response) => {
  res.json({
    success: true,
    data: {
      categories: ALL_CATEGORY_TEMPLATES,
      quickActions: QUICK_ACTION_TEMPLATES,
      conditionBundles: CONDITION_BUNDLES,
    },
  });
});

// POST /templates/apply — copy selected templateKeys into the user's config
templatesRouter.post(
  '/apply',
  validate(ApplyTemplatesSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { templateKeys } = req.body as { templateKeys: string[] };
      const result = await applyTemplateKeys(req.userId!, templateKeys);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

// POST /templates/apply-bundle/:bundleKey
templatesRouter.post('/apply-bundle/:bundleKey', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await applyConditionBundle(req.userId!, req.params.bundleKey);
    res.json({ success: true, message: `Bundle '${req.params.bundleKey}' applied` });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────
//  Community Templates
// ─────────────────────────────────────────────

async function ensureSeedCommunityTemplates(defaultUserId: string) {
  const count = await CommunityTemplate.countDocuments();
  if (count > 0) return;

  const uid = new mongoose.Types.ObjectId(defaultUserId);
  await CommunityTemplate.create([
    {
      creatorId: uid,
      creatorDisplayName: 'Dr. Sarah Lin (POTS Specialist)',
      isAnonymous: false,
      title: 'Long COVID & Dysautonomia Protocol',
      description: 'Comprehensive pacing protocol tracking orthostatic intolerance, brain fog, PEM, and heart rate spikes.',
      conditionTags: ['Long COVID', 'POTS', 'Dysautonomia', 'Fatigue'],
      icon: '🫀',
      color: '#4F46E5',
      installCount: 1420,
      likesCount: 389,
      isVerified: true,
      categories: [
        {
          name: 'Dysautonomia Symptoms',
          icon: '⚡',
          color: '#4F46E5',
          role: 'symptom',
          questions: [
            {
              title: 'What symptoms flared up?',
              helpText: 'Select all symptoms experienced during this episode',
              selectionType: 'multiple',
              allowOther: true,
              required: true,
              frequency: 'anytime',
              options: [
                {
                  label: 'Brain Fog',
                  icon: '🌫️',
                  allowComment: true,
                  captureTime: 'auto_now',
                  fields: [
                    {
                      key: 'severity',
                      label: 'Cognitive Severity',
                      dataType: 'range',
                      min: 0,
                      max: 10,
                      step: 1,
                      displayAs: 'slider',
                      helpText: '0 = clear, 10 = unable to converse or read',
                    },
                  ],
                },
                {
                  label: 'Lightheadedness / Dizziness',
                  icon: '💫',
                  allowComment: true,
                  captureTime: 'auto_now',
                  fields: [
                    {
                      key: 'severity',
                      label: 'Severity (0-10)',
                      dataType: 'range',
                      min: 0,
                      max: 10,
                      step: 1,
                      displayAs: 'slider',
                    },
                  ],
                },
                {
                  label: 'Heart Palpitations / Tachycardia',
                  icon: '💓',
                  allowComment: true,
                  captureTime: 'auto_now',
                  fields: [
                    {
                      key: 'bpm',
                      label: 'Heart Rate (BPM)',
                      dataType: 'number',
                      unit: 'bpm',
                      min: 40,
                      max: 220,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      quickActions: [
        {
          label: 'Electrolyte Intake',
          icon: '💧',
          color: '#0284C7',
          mode: 'counter',
          defaultValue: 500,
          unit: 'ml',
          dailyGoal: 2500,
        },
        {
          label: 'Pacing Rest Break',
          icon: '🧘',
          color: '#059669',
          mode: 'timer',
          defaultValue: 20,
          unit: 'min',
        },
      ],
      status: 'published',
    },
    {
      creatorId: uid,
      creatorDisplayName: 'Elena R. (Migraine Advocate)',
      isAnonymous: false,
      title: 'Migraine & Sensory Aura Journal',
      description: 'Track prodrome warning signs, sensory triggers (bright lights, screen glare, barometric drops), and triptan response times.',
      conditionTags: ['Migraine', 'Headache', 'Sensory Sensitivity', 'Chronic Pain'],
      icon: '⚡',
      color: '#DC2626',
      installCount: 980,
      likesCount: 245,
      isVerified: true,
      categories: [
        {
          name: 'Migraine Attack',
          icon: '⚡',
          color: '#DC2626',
          role: 'symptom',
          questions: [
            {
              title: 'Migraine Phase & Characteristics',
              helpText: 'Identify aura and pain localization',
              selectionType: 'multiple',
              allowOther: true,
              required: true,
              frequency: 'anytime',
              options: [
                {
                  label: 'Throbbing Headache',
                  icon: '🤕',
                  allowComment: true,
                  captureTime: 'auto_now',
                  fields: [
                    {
                      key: 'severity',
                      label: 'Pain Level (0-10)',
                      dataType: 'range',
                      min: 0,
                      max: 10,
                      step: 1,
                      displayAs: 'slider',
                    },
                  ],
                },
                {
                  label: 'Visual Aura / Scintillating Scotoma',
                  icon: '👁️',
                  allowComment: true,
                  captureTime: 'auto_now',
                },
                {
                  label: 'Photophobia / Light Sensitivity',
                  icon: '💡',
                  allowComment: true,
                },
              ],
            },
          ],
        },
      ],
      quickActions: [
        {
          label: 'Cold Compress',
          icon: '❄️',
          color: '#3B82F6',
          mode: 'timer',
          defaultValue: 15,
          unit: 'min',
        },
      ],
      status: 'published',
    },
    {
      creatorId: uid,
      creatorDisplayName: 'Gut Health Network',
      isAnonymous: false,
      title: 'IBS & Low-FODMAP Flare Tracker',
      description: 'Map abdominal cramps, bloating, stool Bristol scale, and food triggers with zero guesswork.',
      conditionTags: ['IBS', 'Gut Health', 'Diet', 'Bloating'],
      icon: '🥗',
      color: '#D97706',
      installCount: 1650,
      likesCount: 412,
      isVerified: true,
      categories: [
        {
          name: 'Digestive Flare',
          icon: '🫄',
          color: '#D97706',
          role: 'symptom',
          questions: [
            {
              title: 'Abdominal Symptoms',
              helpText: 'Select primary digestive discomfort',
              selectionType: 'single',
              allowOther: true,
              required: true,
              frequency: 'anytime',
              options: [
                {
                  label: 'Bloating & Distension',
                  icon: '🎈',
                  allowComment: true,
                  fields: [
                    {
                      key: 'severity',
                      label: 'Bloating Severity',
                      dataType: 'range',
                      min: 0,
                      max: 10,
                      step: 1,
                      displayAs: 'slider',
                    },
                  ],
                },
                {
                  label: 'Abdominal Cramping',
                  icon: '⚡',
                  allowComment: true,
                  fields: [
                    {
                      key: 'severity',
                      label: 'Cramp Intensity',
                      dataType: 'range',
                      min: 0,
                      max: 10,
                      step: 1,
                      displayAs: 'slider',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      quickActions: [
        {
          label: 'Peppermint Tea',
          icon: '🍵',
          color: '#10B981',
          mode: 'counter',
          defaultValue: 1,
          unit: 'cup',
        },
      ],
      status: 'published',
    },
  ]);
}

// GET /templates/community — browse and search community templates
templatesRouter.get('/community', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await ensureSeedCommunityTemplates(req.userId!);

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const condition = typeof req.query.condition === 'string' ? req.query.condition.trim() : '';
    const sort = typeof req.query.sort === 'string' ? req.query.sort : 'popular';
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 50);
    const skip = parseInt(req.query.skip as string, 10) || 0;

    const filter: Record<string, any> = { status: 'published' };

    if (condition && condition.toLowerCase() !== 'all') {
      filter.conditionTags = { $regex: new RegExp(`^${condition}$`, 'i') };
    }

    if (q) {
      filter.$or = [
        { title: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } },
        { conditionTags: { $elemMatch: { $regex: q, $options: 'i' } } },
      ];
    }

    let sortQuery: Record<string, 1 | -1> = { installCount: -1, createdAt: -1 };
    if (sort === 'recent') {
      sortQuery = { createdAt: -1 };
    } else if (sort === 'likes') {
      sortQuery = { likesCount: -1, installCount: -1 };
    }

    const [templates, total] = await Promise.all([
      CommunityTemplate.find(filter)
        .sort(sortQuery)
        .skip(skip)
        .limit(limit)
        .lean(),
      CommunityTemplate.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: {
        templates,
        total,
        page: Math.floor(skip / limit) + 1,
        hasMore: skip + templates.length < total,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /templates/community/:id — get single community template schema for preview
templatesRouter.get('/community/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      res.status(400).json({ success: false, message: 'Invalid template ID' });
      return;
    }
    const template = await CommunityTemplate.findById(req.params.id).lean();
    if (!template || template.status === 'hidden_flagged') {
      res.status(404).json({ success: false, message: 'Template not found or has been flagged' });
      return;
    }
    res.json({ success: true, data: template });
  } catch (err) {
    next(err);
  }
});

// POST /templates/community — publish a new community template
templatesRouter.post(
  '/community',
  validate(CreateCommunityTemplateSchema),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const body = req.body as CreateCommunityTemplateDto;
      const user = await User.findById(req.userId).lean();

      let creatorDisplayName = 'Lumen Community Member';
      if (!body.isAnonymous && user?.name) {
        creatorDisplayName = user.name;
      }

      const template = await CommunityTemplate.create({
        creatorId: new mongoose.Types.ObjectId(req.userId),
        creatorDisplayName,
        isAnonymous: body.isAnonymous ?? true,
        title: body.title,
        description: body.description,
        conditionTags: body.conditionTags,
        icon: body.icon || '📋',
        color: body.color || '#4A90E2',
        categories: body.categories,
        quickActions: body.quickActions || [],
        installCount: 0,
        likesCount: 0,
        isVerified: false,
        status: 'published',
      });

      res.status(201).json({ success: true, data: template });
    } catch (err) {
      next(err);
    }
  },
);

// POST /templates/community/:id/install — clone community template into user's config
templatesRouter.post('/community/:id/install', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      res.status(400).json({ success: false, message: 'Invalid template ID' });
      return;
    }
    const result = await installCommunityTemplate(req.userId!, req.params.id);
    res.json({ success: true, data: result, message: `Successfully installed "${result.templateTitle}"` });
  } catch (err) {
    next(err);
  }
});

// POST /templates/community/:id/like — upvote a template
templatesRouter.post('/community/:id/like', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      res.status(400).json({ success: false, message: 'Invalid template ID' });
      return;
    }
    const updated = await CommunityTemplate.findByIdAndUpdate(
      req.params.id,
      { $inc: { likesCount: 1 } },
      { new: true },
    );
    if (!updated) {
      res.status(404).json({ success: false, message: 'Template not found' });
      return;
    }
    res.json({ success: true, data: { likesCount: updated.likesCount } });
  } catch (err) {
    next(err);
  }
});

// POST /templates/community/:id/report — report an inappropriate or unsafe template
templatesRouter.post('/community/:id/report', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      res.status(400).json({ success: false, message: 'Invalid template ID' });
      return;
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 300) : 'Inappropriate content';
    const template = await CommunityTemplate.findById(req.params.id);
    if (!template) {
      res.status(404).json({ success: false, message: 'Template not found' });
      return;
    }

    template.flags.push({
      userId: new mongoose.Types.ObjectId(req.userId),
      reason,
      createdAt: new Date(),
    });
    template.flagCount = (template.flagCount || 0) + 1;
    if (template.flagCount >= 3) {
      template.status = 'hidden_flagged';
    }
    await template.save();

    res.json({
      success: true,
      message: 'Thank you for your report. Our community moderation team has received it.',
    });
  } catch (err) {
    next(err);
  }
});
