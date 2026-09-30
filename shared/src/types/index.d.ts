export type DataType = 'time' | 'datetime' | 'duration' | 'temperature' | 'range' | 'number' | 'string' | 'enum' | 'boolean' | 'image' | 'location';
export type DisplayAs = 'slider' | 'stepper' | 'chips' | 'dropdown' | 'text' | 'picker' | 'color-swatch' | 'image-grid' | 'toggle' | 'camera' | 'body-map';
export type SelectionType = 'single' | 'multiple';
export type CaptureTime = 'none' | 'auto_now' | 'user_picks';
export type QuickActionMode = 'counter' | 'timer' | 'toggle';
export type CategoryRole = 'trigger_candidate' | 'symptom' | 'context';
export type QuestionFrequency = 'anytime' | 'once_per_day' | 'per_meal' | 'morning' | 'evening';
export type LogSource = 'quick_action' | 'questionnaire' | 'check_in' | 'reminder' | 'activity';
export type ReminderType = 'time' | 'inactivity';
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
    sensitive?: boolean;
}
export interface ICategory {
    _id: string;
    userId: string;
    name: string;
    icon: string;
    color: string;
    role: CategoryRole;
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
    linkedQuestionId?: string;
    linkedOptionId?: string;
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
export interface IDaySession {
    _id: string;
    userId: string;
    sessionDate: string;
    wakeTime?: string;
    sleepTime?: string;
    wakeEdited: boolean;
    sleepEdited: boolean;
    morningCheckInEntryId?: string;
    eveningCheckInEntryId?: string;
    createdAt: string;
    updatedAt: string;
}
export interface FieldValue {
    fieldKey: string;
    dataType: DataType;
    value: unknown;
    unit?: string;
    canonicalValue?: number;
}
export interface Answer {
    optionId: string;
    optionLabelSnapshot: string;
    values: FieldValue[];
    comment?: string;
    otherText?: string;
}
export interface ILogEntry {
    _id: string;
    userId: string;
    clientId: string;
    daySessionId?: string;
    source: LogSource;
    categoryId?: string;
    questionId?: string;
    questionVersion?: number;
    quickActionId?: string;
    occurredAt: string;
    loggedAt: string;
    timezone: string;
    answers: Answer[];
    mediaIds: string[];
    note?: string;
    deletedAt?: string;
    createdAt: string;
    updatedAt: string;
}
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
export type ReminderCategory = 'SLEEP' | 'HYDRATION' | 'MOVEMENT' | 'FOOD' | 'MEDICATION' | 'EXERCISE' | 'WELLNESS' | 'SYMPTOM_TRACKING' | 'PERSONAL' | 'CUSTOM';
export type ReminderScheduleType = 'ONE_TIME' | 'DAILY' | 'WEEKLY' | 'CUSTOM_DAYS' | 'INTERVAL' | 'INACTIVITY' | 'MISSED_TRACKING' | 'GOAL_BASED' | 'CUSTOM';
export type WeekDay = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';
export interface IReminder {
    _id: string;
    userId: string;
    clientId?: string;
    name: string;
    description?: string;
    icon: string;
    category: ReminderCategory;
    scheduleType: ReminderScheduleType;
    targetTime?: string;
    targetDate?: string;
    daysOfWeek?: WeekDay[];
    intervalMinutes?: number;
    windowStartTime?: string;
    windowEndTime?: string;
    inactivityThresholdMinutes?: number;
    notificationTitle?: string;
    notificationMessage: string;
    snoozeDurationMinutes: number;
    linkedQuickActionId?: string;
    linkedQuestionId?: string;
    type?: ReminderType;
    schedule?: string;
    inactivityMinutes?: number;
    message?: string;
    isActive?: boolean;
    enabled: boolean;
    archivedAt?: string;
    createdAt: string;
    updatedAt: string;
}
export type NotificationStatus = 'TRIGGERED' | 'COMPLETED' | 'SNOOZED' | 'DISMISSED' | 'MISSED';
export interface INotificationEvent {
    _id: string;
    userId: string;
    reminderId: string;
    clientId: string;
    scheduledFor: string;
    triggeredAt?: string;
    status: NotificationStatus;
    respondedAt?: string;
    actionTaken?: string;
    linkedLogEntryId?: string;
    createdAt: string;
}
export type ActivityType = 'WALKING' | 'SITTING' | 'SLEEP' | 'EXERCISE' | 'STRETCHING' | 'MEDITATION' | 'CUSTOM';
export type ActivitySessionStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'DISCARDED';
export interface IActivityPoint {
    latitude: number;
    longitude: number;
    altitude?: number;
    accuracy?: number;
    speed?: number;
    timestamp: number;
}
export interface IActivitySession {
    _id: string;
    userId: string;
    clientId: string;
    activityType: ActivityType;
    title: string;
    status: ActivitySessionStatus;
    startTime: string;
    endTime?: string;
    totalDurationSeconds: number;
    activeDurationSeconds: number;
    distanceMeters: number;
    steps?: number;
    averageSpeedKmh?: number;
    averagePaceMinPerKm?: number;
    estimatedCaloriesBurned?: number;
    startLatitude?: number;
    startLongitude?: number;
    endLatitude?: number;
    endLongitude?: number;
    routePoints?: IActivityPoint[];
    hasRouteData: boolean;
    daySessionId?: string;
    linkedReminderId?: string;
    linkedLogEntryId?: string;
    notes?: string;
    createdAt: string;
    updatedAt: string;
}
export interface IWalkingGoal {
    _id: string;
    userId: string;
    dailyDistanceMeters?: number;
    dailyDurationSeconds?: number;
    dailySteps?: number;
    weeklyDistanceMeters?: number;
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
    createdAt: string;
    updatedAt: string;
}
export type ConfidenceLevel = 'low' | 'medium' | 'high';
export interface IInsightResult {
    _id: string;
    userId: string;
    triggerId: string;
    triggerLabel: string;
    symptomId: string;
    symptomLabel: string;
    lagWindowHours: [number, number];
    lift: number;
    baselineRate: number;
    triggerRate: number;
    occurrences: number;
    confidence: ConfidenceLevel;
    computedAt: string;
}
export type TempUnit = 'C' | 'F';
export type UnitsSystem = 'metric' | 'imperial';
export type Theme = 'light' | 'dark' | 'system';
export interface UserPreferences {
    units: UnitsSystem;
    tempUnit: TempUnit;
    timezone: string;
    theme: Theme;
    dayBoundaryHour: number;
}
export interface IUser {
    _id: string;
    email: string;
    name: string;
    conditions: string[];
    preferences: UserPreferences;
    consentAcceptedAt?: string;
    configVersion: number;
    createdAt: string;
    updatedAt: string;
}
export interface UserConfig {
    configVersion: number;
    categories: ICategory[];
    questions: IQuestion[];
    options: IOption[];
    quickActions: IQuickAction[];
    customUnits: ICustomUnit[];
}
