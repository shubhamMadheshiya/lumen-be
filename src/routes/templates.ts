import { Router, Response, NextFunction } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { ApplyTemplatesSchema, ALL_CATEGORY_TEMPLATES, QUICK_ACTION_TEMPLATES, CONDITION_BUNDLES } from '../shared';
import { applyConditionBundle, applyTemplateKeys } from '../services/templateService';

export const templatesRouter = Router();
templatesRouter.use(authenticate);

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
templatesRouter.post('/apply', validate(ApplyTemplatesSchema), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { templateKeys } = req.body as { templateKeys: string[] };
    const result = await applyTemplateKeys(req.userId!, templateKeys);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// POST /templates/apply-bundle/:bundleKey
templatesRouter.post('/apply-bundle/:bundleKey', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await applyConditionBundle(req.userId!, req.params.bundleKey);
    res.json({ success: true, message: `Bundle '${req.params.bundleKey}' applied` });
  } catch (err) { next(err); }
});
