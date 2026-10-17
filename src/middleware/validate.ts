import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

type Target = 'body' | 'query' | 'params';

export function validate(schema: ZodSchema, target: Target = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      const errors = (result.error as ZodError).errors.map(e => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      console.error(`[VALIDATION ERROR] ${req.method} ${req.originalUrl}:`, JSON.stringify(errors, null, 2));
      res.status(400).json({ success: false, message: 'Validation error', errors });
      return;
    }
    (req as Request & { parsed: unknown })[target as 'body'] = result.data;
    next();
  };
}
