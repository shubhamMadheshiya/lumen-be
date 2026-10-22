import { z } from 'zod';

// ────────── Primitives ──────────

export const DataTypeEnum = z.enum([
  'time', 'datetime', 'duration', 'temperature',
  'range', 'number', 'string', 'enum', 'boolean', 'image', 'location',
]);

export const DisplayAsEnum = z.enum([
  'slider', 'stepper', 'chips', 'dropdown', 'text',
  'picker', 'color-swatch', 'image-grid', 'toggle', 'camera', 'body-map',
  'joint-map-3d', 'chest-map', 'body-map-3d',
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
  linkedQuestionId: z.string().nullable().optional(),
  linkedOptionId: z.string().nullable().optional(),
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
  unit: z.string().optional().nullable(),
  canonicalValue: z.number().optional().nullable(),
});

export const AnswerSchema = z.object({
  optionId: z.string(),
  optionLabelSnapshot: z.string().optional().nullable(),
  values: z.array(FieldValueSchema).default([]),
  comment: z.string().max(1000).optional().nullable(),
  otherText: z.string().max(500).optional().nullable(),
});

export const LogLocationSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  accuracy: z.number().optional().nullable(),
  name: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  region: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  formattedAddress: z.string().optional().nullable(),
});

export const CreateLogEntrySchema = z.object({
  clientId: z.string().uuid(),
  source: z.enum(['quick_action', 'questionnaire', 'check_in', 'quick_log']),
  daySessionId: z.string().optional().nullable(),
  categoryId: z.string().optional().nullable(),
  questionId: z.string().optional().nullable(),
  questionVersion: z.number().int().optional().nullable(),
  quickActionId: z.string().optional().nullable(),
  occurredAt: z.string().datetime(),
  timezone: z.string(),
  answers: z.array(AnswerSchema).default([]),
  mediaIds: z.array(z.string()).default([]),
  location: LogLocationSchema.optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
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
  from: z.string().min(1),
  to: z.string().min(1),
  format: z.enum(['pdf', 'csv', 'json']).default('pdf'),
  categoryIds: z.array(z.string()).optional(),
  includeImages: z.boolean().default(false),
});

// ────────── Reorder ──────────

export const ReorderSchema = z.object({
  ids: z.array(z.string()).min(1),
});

// ────────── Community Templates ──────────

export const CreateCommunityTemplateSchema = z.object({
  title: z.string().min(3).max(100),
  description: z.string().min(5).max(1000),
  conditionTags: z.array(z.string().min(1).max(40)).min(1).max(10),
  icon: z.string().min(1).max(20).default('📋'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#4A90E2'),
  isAnonymous: z.boolean().default(true),
  categories: z.array(
    z.object({
      name: z.string().min(1).max(80),
      icon: z.string().min(1).max(20).default('📝'),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#4A90E2'),
      role: z.enum(['trigger_candidate', 'symptom', 'context']),
      questions: z.array(
        z.object({
          title: z.string().min(1).max(150),
          helpText: z.string().max(300).optional(),
          icon: z.string().max(20).optional(),
          selectionType: z.enum(['single', 'multiple']).default('single'),
          allowOther: z.boolean().default(false),
          required: z.boolean().default(false),
          frequency: z.enum(['anytime', 'once_per_day', 'per_meal', 'morning', 'evening']).default('anytime'),
          options: z.array(
            z.object({
              label: z.string().min(1).max(100),
              icon: z.string().max(20).optional(),
              color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
              allowComment: z.boolean().default(false),
              captureTime: z.enum(['none', 'auto_now', 'user_picks']).default('none'),
              fields: z.array(z.record(z.any())).optional(),
            })
          ).default([]),
        })
      ).default([]),
    })
  ).min(1),
  quickActions: z.array(
    z.object({
      label: z.string().min(1).max(80),
      icon: z.string().min(1).max(20),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      mode: z.enum(['counter', 'timer', 'toggle']),
      defaultValue: z.number().optional(),
      unit: z.string().optional(),
      dailyGoal: z.number().optional(),
    })
  ).optional().default([]),
});

export type CreateCommunityTemplateDto = z.infer<typeof CreateCommunityTemplateSchema>;

// ────────── Tasks & To-Do (Microsoft To Do style) ──────────

export const TaskStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(300),
  completed: z.boolean().default(false),
  completedAt: z.string().optional(),
});

export const TaskRepeatSchema = z.object({
  frequency: z.enum(['daily', 'weekdays', 'weekly', 'monthly', 'custom']),
  interval: z.number().int().positive().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
});

export const CreateTaskSchema = z.object({
  title: z.string().min(1).max(300),
  notes: z.string().max(5000).optional(),
  isCompleted: z.boolean().optional().default(false),
  isImportant: z.boolean().optional().default(false),
  inMyDay: z.boolean().optional().default(false),
  myDayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueDate: z.string().optional(),
  reminderTime: z.string().optional(),
  repeat: TaskRepeatSchema.optional(),
  energyCost: z.enum(['gentle', 'moderate', 'demanding']).optional(),
  listId: z.string().optional(),
  steps: z.array(TaskStepSchema).optional().default([]),
  sortOrder: z.number().int().optional().default(0),
});

export const UpdateTaskSchema = CreateTaskSchema.partial();

export const CreateTaskListSchema = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().min(1).max(50).default('📋'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#4A90E2'),
  sortOrder: z.number().int().optional().default(0),
});

export const UpdateTaskListSchema = CreateTaskListSchema.partial();

export type CreateTaskDto = z.infer<typeof CreateTaskSchema>;
export type UpdateTaskDto = z.infer<typeof UpdateTaskSchema>;
export type CreateTaskListDto = z.infer<typeof CreateTaskListSchema>;
export type UpdateTaskListDto = z.infer<typeof UpdateTaskListSchema>;

// ────────── Notes & Knowledge Base (Notion style) ──────────

export const NoteBlockTypeEnum = z.enum([
  'paragraph',
  'heading_1',
  'heading_2',
  'heading_3',
  'todo',
  'bullet_list',
  'numbered_list',
  'toggle',
  'callout',
  'quote',
  'divider',
  'image',
]);

export const NoteBlockSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    type: NoteBlockTypeEnum,
    content: z.string().default(''),
    completed: z.boolean().optional(),
    calloutIcon: z.string().optional(),
    calloutColor: z.string().optional(),
    isCollapsed: z.boolean().optional(),
    children: z.array(NoteBlockSchema).optional(),
    imageUrl: z.string().optional(),
  })
);

export const CreateNoteSchema = z.object({
  title: z.string().min(1).max(300).default('Untitled'),
  icon: z.string().max(30).optional(),
  coverGradient: z.string().max(200).optional(),
  blocks: z.array(NoteBlockSchema).default([]),
  parentNoteId: z.string().optional(),
  isPinned: z.boolean().default(false),
  isArchived: z.boolean().default(false),
  tags: z.array(z.string().min(1).max(50)).default([]),
  linkedSymptomIds: z.array(z.string()).optional(),
  linkedMedicationIds: z.array(z.string()).optional(),
  linkedLogEntryIds: z.array(z.string()).optional(),
});

export const UpdateNoteSchema = CreateNoteSchema.partial();

export type CreateNoteDto = z.infer<typeof CreateNoteSchema>;
export type UpdateNoteDto = z.infer<typeof UpdateNoteSchema>;

// ────────── Community Chat & Health Artifact Exchange ──────────

export const CommunityEmbedTypeEnum = z.enum(['note', 'todo_list', 'log_template', 'photo']);

export const NoteEmbedPayloadSchema = z.object({
  noteId: z.string().optional(),
  title: z.string().min(1).max(300),
  icon: z.string().optional(),
  coverGradient: z.string().optional(),
  tags: z.array(z.string()).default([]),
  blocksPreview: z.array(z.object({ type: z.string(), content: z.string() })).default([]),
  blocksFull: z.array(z.any()).default([]),
});

export const TodoEmbedPayloadSchema = z.object({
  listName: z.string().min(1).max(100),
  energyCost: z.enum(['gentle', 'moderate', 'demanding']).optional(),
  tasks: z.array(
    z.object({
      title: z.string().min(1).max(300),
      energyCost: z.enum(['gentle', 'moderate', 'demanding']).optional(),
      steps: z.array(z.object({ title: z.string() })).default([]),
    })
  ).default([]),
});

export const LogTemplateEmbedPayloadSchema = z.object({
  templateId: z.string().optional(),
  title: z.string().min(1).max(100),
  conditionTags: z.array(z.string()).default([]),
  categories: z.array(z.any()).default([]),
  quickActions: z.array(z.any()).default([]),
});

export const CreateCommunityMessageSchema = z.object({
  channelId: z.string().min(1),
  content: z.string().max(3000).default(''),
  isAnonymous: z.boolean().default(false),
  senderAvatarEmoji: z.string().max(30).optional(),
  embedType: CommunityEmbedTypeEnum.optional(),
  embedData: z.object({
    note: NoteEmbedPayloadSchema.optional(),
    todo: TodoEmbedPayloadSchema.optional(),
    logTemplate: LogTemplateEmbedPayloadSchema.optional(),
    photoUrl: z.string().optional(),
    caption: z.string().max(500).optional(),
  }).optional(),
});

export const ReactCommunityMessageSchema = z.object({
  emoji: z.string().min(1).max(10),
});

export const CreateCommunityChannelSchema = z.object({
  slug: z.string().min(1).max(60),
  name: z.string().min(1).max(100),
  description: z.string().max(500),
  icon: z.string().default('💬'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#38BDF8'),
  topic: z.string().max(200).default(''),
});

export type CreateCommunityMessageDto = z.infer<typeof CreateCommunityMessageSchema>;
export type ReactCommunityMessageDto = z.infer<typeof ReactCommunityMessageSchema>;
export type CreateCommunityChannelDto = z.infer<typeof CreateCommunityChannelSchema>;

