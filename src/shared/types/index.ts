// ─────────────────────────────────────────────
//  Core domain types shared between server and mobile
// ─────────────────────────────────────────────

export type DataType =
  | 'time'
  | 'datetime'
  | 'duration'
  | 'temperature'
  | 'range'
  | 'number'
  | 'string'
  | 'enum'
  | 'boolean'
  | 'image'
  | 'location';

export type DisplayAs =
  | 'slider'
  | 'stepper'
  | 'chips'
  | 'dropdown'
  | 'text'
  | 'picker'
  | 'color-swatch'
  | 'image-grid'
  | 'toggle'
  | 'camera'
  | 'body-map'
  | 'joint-map-3d'
  | 'chest-map'
  | 'body-map-3d';

export type SelectionType = 'single' | 'multiple';
export type CaptureTime = 'none' | 'auto_now' | 'user_picks';
export type QuickActionMode = 'counter' | 'timer' | 'toggle';
export type CategoryRole = 'trigger_candidate' | 'symptom' | 'context';
export type QuestionFrequency = 'anytime' | 'once_per_day' | 'per_meal' | 'morning' | 'evening';
export type LogSource = 'quick_action' | 'questionnaire' | 'check_in' | 'reminder' | 'activity';
export type ReminderType = 'time' | 'inactivity';

// ────────── FieldDefinition ──────────

export interface EnumValue {
  value: string;
  label: string;
  icon?: string;
  color?: string;
  description?: string;
}

export interface FieldDefinition {
  key: string;
  label: string;
  dataType: DataType;
  unit?: string;
  allowedUnits?: string[];
  min?: number;
  max?: number;
  step?: number;
  enumValues?: EnumValue[];
  defaultValue?: unknown;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  displayAs?: DisplayAs;
  sensitive?: boolean;  // blur thumbnails by default (stool, urine, skin)
}

// ────────── Config entities ──────────

/** How Insights treats an item; see AnalysisSchema. */
export interface IAnalysis {
  kind: 'exposure' | 'outcome' | 'reactive' | 'context' | 'ignore';
  lagDays?: number;
}

export interface ICategory {
  _id: string;
  userId: string;
  name: string;
  icon: string;
  color: string;
  role: CategoryRole;
  analysis?: IAnalysis;
  order: number;
  isActive: boolean;
  archivedAt?: string;
  templateKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConditionalDisplay {
  questionId: string;
  optionId: string;
}

export interface IQuestion {
  _id: string;
  userId: string;
  categoryId: string;
  title: string;
  helpText?: string;
  icon?: string;
  color?: string;
  selectionType: SelectionType;
  allowOther: boolean;
  required: boolean;
  frequency: QuestionFrequency;
  conditionalDisplay?: ConditionalDisplay;
  order: number;
  version: number;
  isActive: boolean;
  archivedAt?: string;
  templateKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IOption {
  _id: string;
  userId: string;
  questionId: string;
  label: string;
  icon?: string;
  color?: string;
  allowComment: boolean;
  captureTime: CaptureTime;
  fields: FieldDefinition[];
  order: number;
  isActive: boolean;
  archivedAt?: string;
  templateKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IQuickAction {
  _id: string;
  userId: string;
  label: string;
  icon: string;
  color: string;
  mode: QuickActionMode;
  defaultValue?: number;
  unit?: string;
  dailyGoal?: number;
  linkedQuestionId?: string | null;
  linkedOptionId?: string | null;
  analysis?: IAnalysis;
  order: number;
  isVisible: boolean;
  archivedAt?: string;
  templateKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ICustomUnit {
  _id: string;
  userId: string;
  symbol: string;
  name: string;
  dimension?: string;
  factorToBase?: number;
  createdAt: string;
  updatedAt: string;
}

// ────────── Day session ──────────

export interface IDaySession {
  _id: string;
  userId: string;
  sessionDate: string; // YYYY-MM-DD
  wakeTime?: string;   // ISO datetime
  sleepTime?: string;  // ISO datetime
  wakeEdited: boolean;
  sleepEdited: boolean;
  morningCheckInEntryId?: string;
  eveningCheckInEntryId?: string;
  createdAt: string;
  updatedAt: string;
}

// ────────── Log entry ──────────

export interface FieldValue {
  fieldKey: string;
  dataType: DataType;
  value: unknown;
  unit?: string;
  canonicalValue?: number; // converted to base unit
}

export interface Answer {
  optionId: string;
  optionLabelSnapshot: string;
  values: FieldValue[];
  comment?: string;
  otherText?: string;
}

export interface ILogLocation {
  latitude: number;
  longitude: number;
  accuracy?: number;
  name?: string;
  city?: string;
  region?: string;
  country?: string;
  formattedAddress?: string;
}

export interface ILogEntry {
  _id: string;
  userId: string;
  clientId: string; // UUID for offline dedup
  daySessionId?: string;
  source: LogSource;
  categoryId?: string;
  questionId?: string;
  questionVersion?: number;
  quickActionId?: string;
  occurredAt: string;  // ISO, when it happened
  loggedAt: string;    // ISO, when it was entered
  timezone: string;
  answers: Answer[];
  mediaIds: string[];
  location?: ILogLocation;
  note?: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ────────── Media ──────────

export interface IMedia {
  _id: string;
  userId: string;
  storageKey: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  blurhash?: string;
  sensitive: boolean;
  createdAt: string;
}

// ────────── Supporting models ──────────

// ────────── Supporting models ──────────

export type ReminderCategory =
  | 'SLEEP'
  | 'HYDRATION'
  | 'MOVEMENT'
  | 'FOOD'
  | 'MEDICATION'
  | 'EXERCISE'
  | 'WELLNESS'
  | 'SYMPTOM_TRACKING'
  | 'PERSONAL'
  | 'CUSTOM';

export type ReminderScheduleType =
  | 'ONE_TIME'
  | 'DAILY'
  | 'WEEKLY'
  | 'CUSTOM_DAYS'
  | 'INTERVAL'
  | 'INACTIVITY'
  | 'MISSED_TRACKING'
  | 'GOAL_BASED'
  | 'CUSTOM';

export type WeekDay = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

export interface IReminder {
  _id: string;
  userId: string;
  clientId?: string;              // UUID for offline creation & sync dedup
  name: string;                   // e.g., "Drink Water", "Stand Up"
  description?: string;
  icon: string;                   // Emoji or icon token
  category: ReminderCategory;
  scheduleType: ReminderScheduleType;
  
  // Specific scheduling parameters
  targetTime?: string;            // 'HH:mm' 24-hr format (for ONE_TIME, DAILY, WEEKLY)
  targetDate?: string;            // 'YYYY-MM-DD' (for ONE_TIME)
  daysOfWeek?: WeekDay[];         // e.g. ['MON', 'WED', 'FRI']
  
  // Interval & Window parameters (e.g. 08:00 to 22:00 every 60 min)
  intervalMinutes?: number;       // e.g., 45, 60
  windowStartTime?: string;       // '08:00'
  windowEndTime?: string;         // '22:00'
  
  // Inactivity / Contextual trigger parameters
  inactivityThresholdMinutes?: number; // e.g. 45 min continuous sitting
  
  // Content & Actions
  notificationTitle?: string;
  notificationMessage: string;    // e.g., "Time to hydrate"
  snoozeDurationMinutes: number;  // 5, 10, 15, 30
  sound?: string;                 // 'default' | 'chime' | 'gentle_bell' | 'digital_alarm' | 'zen_gong' | 'radar'
  
  // Linkages to Tracking Engine
  linkedQuickActionId?: string;   // QuickAction ID to trigger on action
  linkedQuestionId?: string;      // Questionnaire ID for deep logging
  
  // Backwards compatibility with legacy fields
  type?: ReminderType;
  schedule?: string;
  inactivityMinutes?: number;
  message?: string;
  isActive?: boolean;

  // Status & Lifecycle
  enabled: boolean;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type NotificationStatus = 
  | 'TRIGGERED'
  | 'COMPLETED'
  | 'SNOOZED'
  | 'DISMISSED'
  | 'MISSED';

export interface INotificationEvent {
  _id: string;
  userId: string;
  reminderId: string;
  clientId: string;
  scheduledFor: string;           // ISO datetime
  triggeredAt?: string;           // ISO datetime
  status: NotificationStatus;
  respondedAt?: string;
  actionTaken?: string;           // e.g., 'LOGGED_WATER', 'START_WALKING', 'SNOOZE'
  linkedLogEntryId?: string;      // LogEntry created if user acted
  createdAt: string;
}

// ────────── Activity Session Models ──────────

export type ActivityType =
  | 'WALKING'
  | 'SITTING'
  | 'SLEEP'
  | 'EXERCISE'
  | 'STRETCHING'
  | 'MEDITATION'
  | 'CUSTOM';

export type ActivitySessionStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'DISCARDED';

export interface IActivityPoint {
  latitude: number;
  longitude: number;
  altitude?: number;
  accuracy?: number;             // in meters
  speed?: number;                // m/s
  timestamp: number;             // epoch milliseconds
}

export interface IActivitySession {
  _id: string;
  userId: string;
  clientId: string;               // UUID for offline dedup
  source?: 'MANUAL' | 'AUTO';     // AUTO: found in the phone's own step history
  activityType: ActivityType;
  title: string;                  // e.g. "Evening Walk", "Desk Sitting"
  status: ActivitySessionStatus;
  
  // Timing
  startTime: string;              // ISO datetime
  endTime?: string;               // ISO datetime
  totalDurationSeconds: number;   // Wall clock duration
  activeDurationSeconds: number;  // Duration excluding pauses
  
  // Physical Metrics (Walking specific)
  distanceMeters: number;         // Accurate accumulated distance
  steps?: number;                 // Hardware pedometer steps
  averageSpeedKmh?: number;       // km/h based on activeDuration
  averagePaceMinPerKm?: number;   // min/km (e.g. 12.35 = 12m 21s)
  estimatedCaloriesBurned?: number;
  
  // Route & Coordinates
  startLatitude?: number;
  startLongitude?: number;
  endLatitude?: number;
  endLongitude?: number;
  routePoints?: IActivityPoint[]; // Stored if user enabled route logging
  hasRouteData: boolean;
  
  // Linkages
  daySessionId?: string;          // DayClockCard association
  linkedReminderId?: string;      // If triggered by a reminder
  linkedLogEntryId?: string;      // Associated LogEntry for timeline display
  
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IWalkingGoal {
  _id: string;
  userId: string;
  dailyDistanceMeters?: number;   // e.g. 5000 (5km)
  dailyDurationSeconds?: number;  // e.g. 2700 (45 mins)
  dailySteps?: number;            // e.g. 8000
  weeklyDistanceMeters?: number;  // e.g. 25000 (25km)
  createdAt: string;
  updatedAt: string;
}


export interface IMedication {
  _id: string;
  userId: string;
  name: string;
  dose?: string;
  unit?: string;
  schedule?: string;
  active: boolean;
  startedOn?: string; // YYYY-MM-DD Lumen day
  stoppedOn?: string;
  changes: Array<{ at: string; kind: 'started' | 'stopped' | 'dose_changed'; note?: string }>;
  createdAt: string;
  updatedAt: string;
}

// ────────── Insights ──────────

export type ConfidenceLevel = 'low' | 'medium' | 'high';

export interface IInsightResult {
  _id: string;
  userId: string;
  triggerId: string;      // categoryId, optionId, or quickActionId
  triggerLabel: string;
  symptomId: string;      // categoryId or optionId
  symptomLabel: string;
  lagWindowHours: [number, number]; // [min, max]
  lift: number;            // relative increase vs baseline
  baselineRate: number;
  triggerRate: number;
  occurrences: number;
  confidence: ConfidenceLevel;
  computedAt: string;
}

// ────────── User ──────────

export type TempUnit = 'C' | 'F';
export type UnitsSystem = 'metric' | 'imperial';
export type Theme = 'light' | 'dark' | 'system';

export interface UserPreferences {
  units: UnitsSystem;
  tempUnit: TempUnit;
  timezone: string;
  theme: Theme;
  dayBoundaryHour: number; // hour at which a new "day" starts (e.g. 4 = 4am)
  aiExplanations?: boolean; // off by default; opt-in plain-language narration via Gemini (Phase 6)
}

export interface IUser {
  _id: string;
  email: string;
  name: string;
  conditions: string[];
  age?: number;
  weight?: number;
  gender?: 'male' | 'female' | 'non-binary' | 'other' | 'prefer_not_to_say';
  preferences: UserPreferences;
  consentAcceptedAt?: string;
  configVersion: number;
  hasPassword?: boolean;
  hasPhotoPin?: boolean;
  authMethod?: 'google' | 'password';
  createdAt: string;
  updatedAt: string;
}

// ────────── Full config payload ──────────

export interface UserConfig {
  configVersion: number;
  categories: ICategory[];
  questions: IQuestion[];
  options: IOption[];
  quickActions: IQuickAction[];
  customUnits: ICustomUnit[];
}

// ────────── Community Templates ──────────

export interface CommunityTemplateField {
  key: string;
  label: string;
  dataType: string;
  unit?: string;
  allowedUnits?: string[];
  min?: number;
  max?: number;
  step?: number;
  enumValues?: Array<{ value: string; label: string; icon?: string; color?: string; description?: string }>;
  required?: boolean;
  placeholder?: string;
  displayAs?: string;
  helpText?: string;
}

export interface CommunityTemplateOption {
  label: string;
  icon?: string;
  color?: string;
  allowComment?: boolean;
  captureTime?: 'none' | 'auto_now' | 'user_picks';
  fields?: CommunityTemplateField[];
}

export interface CommunityTemplateQuestion {
  title: string;
  helpText?: string;
  icon?: string;
  selectionType: 'single' | 'multiple';
  allowOther?: boolean;
  required?: boolean;
  frequency?: 'anytime' | 'once_per_day' | 'per_meal' | 'morning' | 'evening';
  options: CommunityTemplateOption[];
}

export interface CommunityTemplateCategory {
  name: string;
  icon: string;
  color: string;
  role: 'trigger_candidate' | 'symptom' | 'context';
  questions: CommunityTemplateQuestion[];
}

export interface CommunityTemplateQuickAction {
  label: string;
  icon: string;
  color: string;
  mode: 'counter' | 'timer' | 'toggle';
  defaultValue?: number;
  unit?: string;
  dailyGoal?: number;
}

export interface ICommunityTemplate {
  _id: string;
  creatorId: string;
  creatorDisplayName: string;
  isAnonymous: boolean;
  title: string;
  description: string;
  conditionTags: string[];
  icon: string;
  color: string;
  categories: CommunityTemplateCategory[];
  quickActions?: CommunityTemplateQuickAction[];
  installCount: number;
  likesCount: number;
  isVerified: boolean;
  flagCount?: number;
  createdAt: string;
  updatedAt: string;
}

// ────────── Tasks & To-Do (Microsoft To Do style) ──────────

export type TaskEnergyCost = 'gentle' | 'moderate' | 'demanding';

export interface ITaskStep {
  id: string;
  title: string;
  completed: boolean;
  completedAt?: string;
}

export interface ITaskRepeat {
  frequency: 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'custom';
  interval?: number;
  daysOfWeek?: number[];
}

export interface ITask {
  _id: string;
  userId: string;
  title: string;
  notes?: string;
  isCompleted: boolean;
  completedAt?: string;
  isImportant: boolean;
  inMyDay: boolean;
  myDayDate?: string;
  dueDate?: string;
  reminderTime?: string;
  repeat?: ITaskRepeat;
  energyCost?: TaskEnergyCost;
  listId?: string;
  steps: ITaskStep[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ITaskList {
  _id: string;
  userId: string;
  name: string;
  icon: string;
  color: string;
  sortOrder: number;
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ────────── Notes & Knowledge Base (Notion style) ──────────

export type NoteBlockType =
  | 'paragraph'
  | 'heading_1'
  | 'heading_2'
  | 'heading_3'
  | 'todo'
  | 'bullet_list'
  | 'numbered_list'
  | 'toggle'
  | 'callout'
  | 'quote'
  | 'divider'
  | 'image';

export interface INoteBlock {
  id: string;
  type: NoteBlockType;
  content: string;
  completed?: boolean;
  calloutIcon?: string;
  calloutColor?: string;
  isCollapsed?: boolean;
  children?: INoteBlock[];
  imageUrl?: string;
}

export interface INote {
  _id: string;
  userId: string;
  title: string;
  icon?: string;
  coverGradient?: string;
  blocks: INoteBlock[];
  parentNoteId?: string;
  isPinned: boolean;
  isArchived: boolean;
  tags: string[];
  linkedSymptomIds?: string[];
  linkedMedicationIds?: string[];
  linkedLogEntryIds?: string[];
  createdAt: string;
  updatedAt: string;
}

// ────────── Community Chat & Health Artifact Exchange ──────────

export type CommunityEmbedType = 'note' | 'todo_list' | 'log_template' | 'photo';

export interface INoteEmbedPayload {
  noteId?: string;
  title: string;
  icon?: string;
  coverGradient?: string;
  tags: string[];
  blocksPreview: Array<{ type: string; content: string }>;
  blocksFull: INoteBlock[];
}

export interface ITodoEmbedPayload {
  listId?: string;
  listName: string;
  energyCost?: 'gentle' | 'moderate' | 'demanding';
  tasks: Array<{
    title: string;
    energyCost?: 'gentle' | 'moderate' | 'demanding';
    steps: Array<{ title: string }>;
  }>;
}

export interface ILogTemplateEmbedPayload {
  templateId?: string;
  title: string;
  conditionTags: string[];
  categories: any[];
  quickActions: any[];
}

export interface ICommunityMessage {
  _id: string;
  channelId: string;
  senderId: string;
  senderDisplayName: string;
  senderAvatarEmoji?: string;
  isAnonymous: boolean;
  content: string;
  senderRoleColor?: string;
  senderRoleBadges?: string[];
  replyTo?: {
    messageId: string;
    senderDisplayName: string;
    snippet: string;
  };
  threadMeta?: {
    replyCount: number;
    lastReplyAt?: string;
  };
  embedType?: CommunityEmbedType;
  embedData?: {
    note?: INoteEmbedPayload;
    todo?: ITodoEmbedPayload;
    logTemplate?: ILogTemplateEmbedPayload;
    photoUrl?: string;
    caption?: string;
  };
  reactions: Record<string, number>;
  userReactions?: string[];
  cloneCount: number;
  createdAt: string;
  updatedAt: string;
}

export type ChannelType = 'text' | 'forum' | 'announcement';

export interface ICommunityServer {
  _id: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
  color: string;
  conditionTags: string[];
  isPrivate: boolean;
  inviteCode?: string;
  ownerId: string;
  membersCount: number;
  isOfficial: boolean;
  isMember?: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface ICommunityChannel {
  _id: string;
  serverId?: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  topic: string;
  category: string;
  type: ChannelType;
  order: number;
  memberCount: number;
  messageCount: number;
  isFeatured: boolean;
  unreadCount?: number;
  createdAt: string;
}

export interface IForumPost {
  _id: string;
  channelId: string;
  title: string;
  tags: string[];
  author: {
    senderId: string;
    senderDisplayName: string;
    senderAvatarEmoji?: string;
    isAnonymous: boolean;
    senderRoleColor?: string;
    senderRoleBadges?: string[];
  };
  content: string;
  embedType?: CommunityEmbedType;
  embedData?: {
    note?: INoteEmbedPayload;
    todo?: ITodoEmbedPayload;
    logTemplate?: ILogTemplateEmbedPayload;
    photoUrl?: string;
  };
  stats: {
    replyCount: number;
    spoonsCount: number;
    cloneCount: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface IDiscordUserProfile {
  userId: string;
  displayName: string;
  avatarEmoji?: string;
  bannerGradient: [string, string];
  bio?: string;
  energyStatus: string; // e.g. "Low Spoons", "Pacing & Resting", "Active"
  conditionTags: string[];
  roleBadges: string[];
  roleColor: string;
  stats: {
    sharedNotesCount: number;
    sharedTodosCount: number;
    totalClones: number;
  };
}


