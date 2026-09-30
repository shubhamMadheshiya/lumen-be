/**
 * Starter template library.
 * These are BUNDLED in both server and mobile — they are never stored in the DB globally.
 * When a user applies a template, its data is copied into their own collections.
 */
export interface TemplateCategory {
    templateKey: string;
    name: string;
    icon: string;
    color: string;
    role: 'trigger_candidate' | 'symptom' | 'context';
    order: number;
    questions: TemplateQuestion[];
}
export interface TemplateQuestion {
    templateKey: string;
    title: string;
    helpText?: string;
    icon?: string;
    selectionType: 'single' | 'multiple';
    allowOther: boolean;
    required: boolean;
    frequency: 'anytime' | 'once_per_day' | 'per_meal' | 'morning' | 'evening';
    order: number;
    options: TemplateOption[];
}
export interface TemplateOption {
    templateKey: string;
    label: string;
    icon?: string;
    color?: string;
    allowComment: boolean;
    captureTime: 'none' | 'auto_now' | 'user_picks';
    order: number;
    fields: Array<{
        key: string;
        label: string;
        dataType: string;
        unit?: string;
        allowedUnits?: string[];
        min?: number;
        max?: number;
        step?: number;
        enumValues?: Array<{
            value: string;
            label: string;
            icon?: string;
            color?: string;
            description?: string;
        }>;
        required?: boolean;
        placeholder?: string;
        displayAs?: string;
        helpText?: string;
    }>;
}
export interface TemplateQuickAction {
    templateKey: string;
    label: string;
    icon: string;
    color: string;
    mode: 'counter' | 'timer' | 'toggle';
    defaultValue?: number;
    unit?: string;
    dailyGoal?: number;
    order: number;
}
export declare const QUICK_ACTION_TEMPLATES: TemplateQuickAction[];
export interface ConditionBundle {
    key: string;
    label: string;
    icon: string;
    description: string;
    categoryKeys: string[];
    quickActionKeys: string[];
}
export declare const CONDITION_BUNDLES: ConditionBundle[];
export declare const ALL_CATEGORY_TEMPLATES: TemplateCategory[];
export declare function getCategoryTemplate(key: string): TemplateCategory | undefined;
export declare function getBundleCategories(bundleKey: string): TemplateCategory[];
export declare function getBundleQuickActions(bundleKey: string): TemplateQuickAction[];
