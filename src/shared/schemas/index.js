"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReorderSchema = exports.ReportRequestSchema = exports.ApplyTemplatesSchema = exports.CreateMedicationSchema = exports.CreateReminderSchema = exports.LoginSchema = exports.RegisterSchema = exports.SyncPushSchema = exports.BatchLogEntrySchema = exports.CreateLogEntrySchema = exports.AnswerSchema = exports.FieldValueSchema = exports.UpdateDaySessionSchema = exports.GoToSleepSchema = exports.WakeUpSchema = exports.CreateCustomUnitSchema = exports.UpdateQuickActionSchema = exports.CreateQuickActionSchema = exports.UpdateOptionSchema = exports.CreateOptionSchema = exports.UpdateQuestionSchema = exports.CreateQuestionSchema = exports.ConditionalDisplaySchema = exports.UpdateCategorySchema = exports.CreateCategorySchema = exports.FieldDefinitionSchema = exports.EnumValueSchema = exports.DisplayAsEnum = exports.DataTypeEnum = void 0;
const zod_1 = require("zod");
// ────────── Primitives ──────────
exports.DataTypeEnum = zod_1.z.enum([
    'time', 'datetime', 'duration', 'temperature',
    'range', 'number', 'string', 'enum', 'boolean', 'image', 'location',
]);
exports.DisplayAsEnum = zod_1.z.enum([
    'slider', 'stepper', 'chips', 'dropdown', 'text',
    'picker', 'color-swatch', 'image-grid', 'toggle', 'camera', 'body-map',
]);
exports.EnumValueSchema = zod_1.z.object({
    value: zod_1.z.string().min(1),
    label: zod_1.z.string().min(1),
    icon: zod_1.z.string().optional(),
    color: zod_1.z.string().optional(),
    description: zod_1.z.string().optional(),
});
exports.FieldDefinitionSchema = zod_1.z.object({
    key: zod_1.z.string().min(1).max(50),
    label: zod_1.z.string().min(1).max(100),
    dataType: exports.DataTypeEnum,
    unit: zod_1.z.string().optional(),
    allowedUnits: zod_1.z.array(zod_1.z.string()).optional(),
    min: zod_1.z.number().optional(),
    max: zod_1.z.number().optional(),
    step: zod_1.z.number().optional(),
    enumValues: zod_1.z.array(exports.EnumValueSchema).optional(),
    defaultValue: zod_1.z.unknown().optional(),
    required: zod_1.z.boolean().optional(),
    placeholder: zod_1.z.string().optional(),
    helpText: zod_1.z.string().optional(),
    displayAs: exports.DisplayAsEnum.optional(),
});
// ────────── Category ──────────
exports.CreateCategorySchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(60),
    icon: zod_1.z.string().min(1).max(100),
    color: zod_1.z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    role: zod_1.z.enum(['trigger_candidate', 'symptom', 'context']),
    order: zod_1.z.number().int().min(0).optional(),
});
exports.UpdateCategorySchema = exports.CreateCategorySchema.partial().extend({
    isActive: zod_1.z.boolean().optional(),
});
// ────────── Question ──────────
exports.ConditionalDisplaySchema = zod_1.z.object({
    questionId: zod_1.z.string(),
    optionId: zod_1.z.string(),
});
exports.CreateQuestionSchema = zod_1.z.object({
    categoryId: zod_1.z.string(),
    title: zod_1.z.string().min(1).max(200),
    helpText: zod_1.z.string().max(500).optional(),
    icon: zod_1.z.string().max(100).optional(),
    color: zod_1.z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    selectionType: zod_1.z.enum(['single', 'multiple']),
    allowOther: zod_1.z.boolean().default(false),
    required: zod_1.z.boolean().default(false),
    frequency: zod_1.z.enum(['anytime', 'once_per_day', 'per_meal', 'morning', 'evening']).default('anytime'),
    conditionalDisplay: exports.ConditionalDisplaySchema.optional(),
    order: zod_1.z.number().int().min(0).optional(),
});
exports.UpdateQuestionSchema = exports.CreateQuestionSchema.partial().extend({
    isActive: zod_1.z.boolean().optional(),
});
// ────────── Option ──────────
exports.CreateOptionSchema = zod_1.z.object({
    questionId: zod_1.z.string(),
    label: zod_1.z.string().min(1).max(100),
    icon: zod_1.z.string().max(100).optional(),
    color: zod_1.z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    allowComment: zod_1.z.boolean().default(false),
    captureTime: zod_1.z.enum(['none', 'auto_now', 'user_picks']).default('none'),
    fields: zod_1.z.array(exports.FieldDefinitionSchema).default([]),
    order: zod_1.z.number().int().min(0).optional(),
});
exports.UpdateOptionSchema = exports.CreateOptionSchema.partial().extend({
    isActive: zod_1.z.boolean().optional(),
});
// ────────── QuickAction ──────────
exports.CreateQuickActionSchema = zod_1.z.object({
    label: zod_1.z.string().min(1).max(60),
    icon: zod_1.z.string().min(1).max(100),
    color: zod_1.z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    mode: zod_1.z.enum(['counter', 'timer', 'toggle']),
    defaultValue: zod_1.z.number().optional(),
    unit: zod_1.z.string().optional(),
    dailyGoal: zod_1.z.number().positive().optional(),
    linkedQuestionId: zod_1.z.string().optional(),
    linkedOptionId: zod_1.z.string().optional(),
    order: zod_1.z.number().int().min(0).optional(),
    isVisible: zod_1.z.boolean().default(true),
});
exports.UpdateQuickActionSchema = exports.CreateQuickActionSchema.partial();
// ────────── CustomUnit ──────────
exports.CreateCustomUnitSchema = zod_1.z.object({
    symbol: zod_1.z.string().min(1).max(20),
    name: zod_1.z.string().min(1).max(60),
    dimension: zod_1.z.string().optional(),
    factorToBase: zod_1.z.number().positive().optional(),
});
// ────────── DaySession ──────────
exports.WakeUpSchema = zod_1.z.object({
    wakeTime: zod_1.z.string().datetime().optional(), // allow backfill
    edited: zod_1.z.boolean().optional(),
});
exports.GoToSleepSchema = zod_1.z.object({
    sleepTime: zod_1.z.string().datetime().optional(),
    edited: zod_1.z.boolean().optional(),
});
exports.UpdateDaySessionSchema = zod_1.z.object({
    wakeTime: zod_1.z.string().datetime().optional(),
    sleepTime: zod_1.z.string().datetime().optional(),
    wakeEdited: zod_1.z.boolean().optional(),
    sleepEdited: zod_1.z.boolean().optional(),
});
// ────────── LogEntry ──────────
exports.FieldValueSchema = zod_1.z.object({
    fieldKey: zod_1.z.string().min(1),
    dataType: exports.DataTypeEnum,
    value: zod_1.z.unknown(),
    unit: zod_1.z.string().optional(),
    canonicalValue: zod_1.z.number().optional(),
});
exports.AnswerSchema = zod_1.z.object({
    optionId: zod_1.z.string(),
    optionLabelSnapshot: zod_1.z.string(),
    values: zod_1.z.array(exports.FieldValueSchema).default([]),
    comment: zod_1.z.string().max(1000).optional(),
    otherText: zod_1.z.string().max(500).optional(),
});
exports.CreateLogEntrySchema = zod_1.z.object({
    clientId: zod_1.z.string().uuid(),
    source: zod_1.z.enum(['quick_action', 'questionnaire', 'check_in']),
    daySessionId: zod_1.z.string().optional(),
    categoryId: zod_1.z.string().optional(),
    questionId: zod_1.z.string().optional(),
    questionVersion: zod_1.z.number().int().optional(),
    quickActionId: zod_1.z.string().optional(),
    occurredAt: zod_1.z.string().datetime(),
    timezone: zod_1.z.string(),
    answers: zod_1.z.array(exports.AnswerSchema).default([]),
    mediaIds: zod_1.z.array(zod_1.z.string()).default([]),
    note: zod_1.z.string().max(2000).optional(),
});
exports.BatchLogEntrySchema = zod_1.z.object({
    entries: zod_1.z.array(exports.CreateLogEntrySchema).min(1).max(100),
});
// ────────── Sync ──────────
exports.SyncPushSchema = zod_1.z.object({
    logs: zod_1.z.array(exports.CreateLogEntrySchema.extend({
        updatedAt: zod_1.z.string().datetime(),
        deletedAt: zod_1.z.string().datetime().optional(),
    })).optional(),
    configChanges: zod_1.z.object({
        categories: zod_1.z.array(zod_1.z.unknown()).optional(),
        questions: zod_1.z.array(zod_1.z.unknown()).optional(),
        options: zod_1.z.array(zod_1.z.unknown()).optional(),
        quickActions: zod_1.z.array(zod_1.z.unknown()).optional(),
        customUnits: zod_1.z.array(zod_1.z.unknown()).optional(),
    }).optional(),
});
// ────────── Auth ──────────
exports.RegisterSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(8).max(100),
    name: zod_1.z.string().min(1).max(80),
});
exports.LoginSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string(),
});
// ────────── Reminder ──────────
exports.CreateReminderSchema = zod_1.z.object({
    type: zod_1.z.enum(['time', 'inactivity']),
    schedule: zod_1.z.string().optional(), // cron for time type
    inactivityMinutes: zod_1.z.number().int().positive().optional(),
    quickActionId: zod_1.z.string().optional(),
    message: zod_1.z.string().min(1).max(200),
    isActive: zod_1.z.boolean().default(true),
});
// ────────── Medication ──────────
exports.CreateMedicationSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(100),
    dose: zod_1.z.string().max(50).optional(),
    unit: zod_1.z.string().max(20).optional(),
    schedule: zod_1.z.string().max(200).optional(),
    active: zod_1.z.boolean().default(true),
});
// ────────── Templates ──────────
exports.ApplyTemplatesSchema = zod_1.z.object({
    templateKeys: zod_1.z.array(zod_1.z.string()).min(1),
});
// ────────── Reports ──────────
exports.ReportRequestSchema = zod_1.z.object({
    from: zod_1.z.string().datetime(),
    to: zod_1.z.string().datetime(),
    format: zod_1.z.enum(['pdf', 'csv', 'json']).default('pdf'),
    categoryIds: zod_1.z.array(zod_1.z.string()).optional(),
    includeImages: zod_1.z.boolean().default(false),
});
// ────────── Reorder ──────────
exports.ReorderSchema = zod_1.z.object({
    ids: zod_1.z.array(zod_1.z.string()).min(1),
});
//# sourceMappingURL=index.js.map