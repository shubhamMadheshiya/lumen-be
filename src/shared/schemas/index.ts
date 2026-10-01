import { z } from 'zod';

// ────────── Primitives ──────────

export const DataTypeEnum = z.enum([
  'time', 'datetime', 'duration', 'temperature',
  'range', 'number', 'string', 'enum', 'boolean', 'image', 'location',
]);

export const DisplayAsEnum = z.enum([
  'slider', 'stepper', 'chips', 'dropdown', 'text',
  'picker', 'color-swatch', 'image-grid', 'toggle', 'camera', 'body-map',
]);

export const EnumValueSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  color: z.string().optional(),
  description: z.string().optional(),
});

export const FieldDefinitionSchema = z.object({
  key: z.string().min(1).max(50),
  label: z.string().min(1).max(100),
  dataType: DataTypeEnum,
  unit: z.string().optional(),
  allowedUnits: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  enumValues: z.array(EnumValueSchema).optional(),
  defaultValue: z.unknown().optional(),
  required: z.boolean().optional(),
  placeholder: z.string().optional(),
  helpText: z.string().optional(),
  displayAs: DisplayAsEnum.optional(),
});

// ────────── Category ──────────

export const CreateCategorySchema = z.object({
  name: z.string().min(1).max(60),
  icon: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  role: z.enum(['trigger_candidate', 'symptom', 'context']),
  order: z.number().int().min(0).optional(),
});

export const UpdateCategorySchema = CreateCategorySchema.partial().extend({
  isActive: z.boolean().optional(),
});

// ────────── Question ──────────

export const ConditionalDisplaySchema = z.object({
  questionId: z.string(),
  optionId: z.string(),
});

export const CreateQuestionSchema = z.object({
  categoryId: z.string(),
  title: z.string().min(1).max(200),
  helpText: z.string().max(500).optional(),
  icon: z.string().max(100).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  selectionType: z.enum(['single', 'multiple']),
  allowOther: z.boolean().default(false),
  required: z.boolean().default(false),
  frequency: z.enum(['anytime', 'once_per_day', 'per_meal', 'morning', 'evening']).default('anytime'),
  conditionalDisplay: ConditionalDisplaySchema.optional(),
  order: z.number().int().min(0).optional(),
});

export const UpdateQuestionSchema = CreateQuestionSchema.partial().extend({
  isActive: z.boolean().optional(),
});

// ────────── Option ──────────

export const CreateOptionSchema = z.object({
  questionId: z.string(),
  label: z.string().min(1).max(100),
  icon: z.string().max(100).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  allowComment: z.boolean().default(false),
  captureTime: z.enum(['none', 'auto_now', 'user_picks']).default('none'),
  fields: z.array(FieldDefinitionSchema).default([]),
  order: z.number().int().min(0).optional(),
});

export const UpdateOptionSchema = CreateOptionSchema.partial().extend({
  isActive: z.boolean().optional(),
});

// ────────── QuickAction ──────────

export const CreateQuickActionSchema = z.object({
  label: z.string().min(1).max(60),
  icon: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  mode: z.enum(['counter', 'timer', 'toggle']),
  defaultValue: z.number().optional(),
  unit: z.string().optional(),
  dailyGoal: z.number().positive().optional(),
  linkedQuestionId: z.string().optional(),
  linkedOptionId: z.string().optional(),
  order: z.number().int().min(0).optional(),
  isVisible: z.boolean().default(true),
});

export const UpdateQuickActionSchema = CreateQuickActionSchema.partial();

// ────────── CustomUnit ──────────

export const CreateCustomUnitSchema = z.object({
  symbol: z.string().min(1).max(20),
  name: z.string().min(1).max(60),
  dimension: z.string().optional(),
  factorToBase: z.number().positive().optional(),
});

// ────────── DaySession ──────────

export const WakeUpSchema = z.object({
  wakeTime: z.string().datetime().optional(), // allow backfill
  edited: z.boolean().optional(),
});

export const GoToSleepSchema = z.object({
  sleepTime: z.string().datetime().optional(),
  edited: z.boolean().optional(),
});

export const UpdateDaySessionSchema = z.object({
  wakeTime: z.string().datetime().optional(),
  sleepTime: z.string().datetime().optional(),
  wakeEdited: z.boolean().optional(),
  sleepEdited: z.boolean().optional(),
});

// ────────── LogEntry ──────────

export const FieldValueSchema = z.object({
  fieldKey: z.string().min(1),
  dataType: DataTypeEnum,
  value: z.unknown(),
  unit: z.string().optional(),
  canonicalValue: z.number().optional(),
});

export const AnswerSchema = z.object({
  optionId: z.string(),
  optionLabelSnapshot: z.string(),
  values: z.array(FieldValueSchema).default([]),
  comment: z.string().max(1000).optional(),
  otherText: z.string().max(500).optional(),
});

export const CreateLogEntrySchema = z.object({
  clientId: z.string().uuid(),
  source: z.enum(['quick_action', 'questionnaire', 'check_in']),
  daySessionId: z.string().optional(),
  categoryId: z.string().optional(),
  questionId: z.string().optional(),
  questionVersion: z.number().int().optional(),
  quickActionId: z.string().optional(),
  occurredAt: z.string().datetime(),
  timezone: z.string(),
  answers: z.array(AnswerSchema).default([]),
  mediaIds: z.array(z.string()).default([]),
  note: z.string().max(2000).optional(),
});

export const BatchLogEntrySchema = z.object({
  entries: z.array(CreateLogEntrySchema).min(1).max(100),
});

// ────────── Sync ──────────

export const SyncPushSchema = z.object({
  logs: z.array(CreateLogEntrySchema.extend({
    updatedAt: z.string().datetime(),
    deletedAt: z.string().datetime().optional(),
  })).optional(),
  configChanges: z.object({
    categories: z.array(z.unknown()).optional(),
    questions: z.array(z.unknown()).optional(),
    options: z.array(z.unknown()).optional(),
    quickActions: z.array(z.unknown()).optional(),
    customUnits: z.array(z.unknown()).optional(),
  }).optional(),
});

// ────────── Auth ──────────

export const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(100),
  name: z.string().min(1).max(80),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const UpdateProfileSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  conditions: z.array(z.string().min(1).max(100)).optional(),
  age: z.number().int().min(0).max(130).optional(),
  weight: z.number().positive().max(500).optional(),
  gender: z.enum(['male', 'female', 'non-binary', 'other', 'prefer_not_to_say']).optional(),
  preferences: z.object({
    units: z.enum(['metric', 'imperial']).optional(),
    tempUnit: z.enum(['C', 'F']).optional(),
    timezone: z.string().optional(),
    theme: z.enum(['light', 'dark', 'system']).optional(),
    dayBoundaryHour: z.number().int().min(0).max(12).optional(),
  }).optional(),
});

export type UpdateProfileDto = z.infer<typeof UpdateProfileSchema>;

// ────────── Reminder ──────────

export const CreateReminderSchema = z.object({
  type: z.enum(['time', 'inactivity']),
  schedule: z.string().optional(),          // cron for time type
  inactivityMinutes: z.number().int().positive().optional(),
  quickActionId: z.string().optional(),
  message: z.string().min(1).max(200),
  isActive: z.boolean().default(true),
});

// ────────── Medication ──────────

export const CreateMedicationSchema = z.object({
  name: z.string().min(1).max(100),
  dose: z.string().max(50).optional(),
  unit: z.string().max(20).optional(),
  schedule: z.string().max(200).optional(),
  active: z.boolean().default(true),
});

// ────────── Templates ──────────

export const ApplyTemplatesSchema = z.object({
  templateKeys: z.array(z.string()).min(1),
});

// ────────── Reports ──────────

export const ReportRequestSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  format: z.enum(['pdf', 'csv', 'json']).default('pdf'),
  categoryIds: z.array(z.string()).optional(),
  includeImages: z.boolean().default(false),
});

// ────────── Reorder ──────────

export const ReorderSchema = z.object({
  ids: z.array(z.string()).min(1),
});
