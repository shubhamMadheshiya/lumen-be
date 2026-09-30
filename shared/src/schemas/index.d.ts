import { z } from 'zod';
export declare const DataTypeEnum: z.ZodEnum<["time", "datetime", "duration", "temperature", "range", "number", "string", "enum", "boolean", "image", "location"]>;
export declare const DisplayAsEnum: z.ZodEnum<["slider", "stepper", "chips", "dropdown", "text", "picker", "color-swatch", "image-grid", "toggle", "camera", "body-map"]>;
export declare const EnumValueSchema: z.ZodObject<{
    value: z.ZodString;
    label: z.ZodString;
    icon: z.ZodOptional<z.ZodString>;
    color: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    value: string;
    label: string;
    description?: string | undefined;
    icon?: string | undefined;
    color?: string | undefined;
}, {
    value: string;
    label: string;
    description?: string | undefined;
    icon?: string | undefined;
    color?: string | undefined;
}>;
export declare const FieldDefinitionSchema: z.ZodObject<{
    key: z.ZodString;
    label: z.ZodString;
    dataType: z.ZodEnum<["time", "datetime", "duration", "temperature", "range", "number", "string", "enum", "boolean", "image", "location"]>;
    unit: z.ZodOptional<z.ZodString>;
    allowedUnits: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    min: z.ZodOptional<z.ZodNumber>;
    max: z.ZodOptional<z.ZodNumber>;
    step: z.ZodOptional<z.ZodNumber>;
    enumValues: z.ZodOptional<z.ZodArray<z.ZodObject<{
        value: z.ZodString;
        label: z.ZodString;
        icon: z.ZodOptional<z.ZodString>;
        color: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        value: string;
        label: string;
        description?: string | undefined;
        icon?: string | undefined;
        color?: string | undefined;
    }, {
        value: string;
        label: string;
        description?: string | undefined;
        icon?: string | undefined;
        color?: string | undefined;
    }>, "many">>;
    defaultValue: z.ZodOptional<z.ZodUnknown>;
    required: z.ZodOptional<z.ZodBoolean>;
    placeholder: z.ZodOptional<z.ZodString>;
    helpText: z.ZodOptional<z.ZodString>;
    displayAs: z.ZodOptional<z.ZodEnum<["slider", "stepper", "chips", "dropdown", "text", "picker", "color-swatch", "image-grid", "toggle", "camera", "body-map"]>>;
}, "strip", z.ZodTypeAny, {
    key: string;
    label: string;
    dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
    unit?: string | undefined;
    max?: number | undefined;
    min?: number | undefined;
    required?: boolean | undefined;
    helpText?: string | undefined;
    allowedUnits?: string[] | undefined;
    step?: number | undefined;
    enumValues?: {
        value: string;
        label: string;
        description?: string | undefined;
        icon?: string | undefined;
        color?: string | undefined;
    }[] | undefined;
    defaultValue?: unknown;
    placeholder?: string | undefined;
    displayAs?: "text" | "slider" | "stepper" | "chips" | "dropdown" | "picker" | "color-swatch" | "image-grid" | "toggle" | "camera" | "body-map" | undefined;
}, {
    key: string;
    label: string;
    dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
    unit?: string | undefined;
    max?: number | undefined;
    min?: number | undefined;
    required?: boolean | undefined;
    helpText?: string | undefined;
    allowedUnits?: string[] | undefined;
    step?: number | undefined;
    enumValues?: {
        value: string;
        label: string;
        description?: string | undefined;
        icon?: string | undefined;
        color?: string | undefined;
    }[] | undefined;
    defaultValue?: unknown;
    placeholder?: string | undefined;
    displayAs?: "text" | "slider" | "stepper" | "chips" | "dropdown" | "picker" | "color-swatch" | "image-grid" | "toggle" | "camera" | "body-map" | undefined;
}>;
export declare const CreateCategorySchema: z.ZodObject<{
    name: z.ZodString;
    icon: z.ZodString;
    color: z.ZodString;
    role: z.ZodEnum<["trigger_candidate", "symptom", "context"]>;
    order: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    name: string;
    icon: string;
    color: string;
    role: "context" | "trigger_candidate" | "symptom";
    order?: number | undefined;
}, {
    name: string;
    icon: string;
    color: string;
    role: "context" | "trigger_candidate" | "symptom";
    order?: number | undefined;
}>;
export declare const UpdateCategorySchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    icon: z.ZodOptional<z.ZodString>;
    color: z.ZodOptional<z.ZodString>;
    role: z.ZodOptional<z.ZodEnum<["trigger_candidate", "symptom", "context"]>>;
    order: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
} & {
    isActive: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
    order?: number | undefined;
    icon?: string | undefined;
    color?: string | undefined;
    role?: "context" | "trigger_candidate" | "symptom" | undefined;
    isActive?: boolean | undefined;
}, {
    name?: string | undefined;
    order?: number | undefined;
    icon?: string | undefined;
    color?: string | undefined;
    role?: "context" | "trigger_candidate" | "symptom" | undefined;
    isActive?: boolean | undefined;
}>;
export declare const ConditionalDisplaySchema: z.ZodObject<{
    questionId: z.ZodString;
    optionId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    questionId: string;
    optionId: string;
}, {
    questionId: string;
    optionId: string;
}>;
export declare const CreateQuestionSchema: z.ZodObject<{
    categoryId: z.ZodString;
    title: z.ZodString;
    helpText: z.ZodOptional<z.ZodString>;
    icon: z.ZodOptional<z.ZodString>;
    color: z.ZodOptional<z.ZodString>;
    selectionType: z.ZodEnum<["single", "multiple"]>;
    allowOther: z.ZodDefault<z.ZodBoolean>;
    required: z.ZodDefault<z.ZodBoolean>;
    frequency: z.ZodDefault<z.ZodEnum<["anytime", "once_per_day", "per_meal", "morning", "evening"]>>;
    conditionalDisplay: z.ZodOptional<z.ZodObject<{
        questionId: z.ZodString;
        optionId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        questionId: string;
        optionId: string;
    }, {
        questionId: string;
        optionId: string;
    }>>;
    order: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    required: boolean;
    categoryId: string;
    title: string;
    selectionType: "multiple" | "single";
    allowOther: boolean;
    frequency: "anytime" | "once_per_day" | "per_meal" | "morning" | "evening";
    order?: number | undefined;
    icon?: string | undefined;
    color?: string | undefined;
    helpText?: string | undefined;
    conditionalDisplay?: {
        questionId: string;
        optionId: string;
    } | undefined;
}, {
    categoryId: string;
    title: string;
    selectionType: "multiple" | "single";
    order?: number | undefined;
    required?: boolean | undefined;
    icon?: string | undefined;
    color?: string | undefined;
    helpText?: string | undefined;
    allowOther?: boolean | undefined;
    frequency?: "anytime" | "once_per_day" | "per_meal" | "morning" | "evening" | undefined;
    conditionalDisplay?: {
        questionId: string;
        optionId: string;
    } | undefined;
}>;
export declare const UpdateQuestionSchema: z.ZodObject<{
    categoryId: z.ZodOptional<z.ZodString>;
    title: z.ZodOptional<z.ZodString>;
    helpText: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    icon: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    color: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    selectionType: z.ZodOptional<z.ZodEnum<["single", "multiple"]>>;
    allowOther: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
    required: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
    frequency: z.ZodOptional<z.ZodDefault<z.ZodEnum<["anytime", "once_per_day", "per_meal", "morning", "evening"]>>>;
    conditionalDisplay: z.ZodOptional<z.ZodOptional<z.ZodObject<{
        questionId: z.ZodString;
        optionId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        questionId: string;
        optionId: string;
    }, {
        questionId: string;
        optionId: string;
    }>>>;
    order: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
} & {
    isActive: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    order?: number | undefined;
    required?: boolean | undefined;
    icon?: string | undefined;
    color?: string | undefined;
    isActive?: boolean | undefined;
    categoryId?: string | undefined;
    title?: string | undefined;
    helpText?: string | undefined;
    selectionType?: "multiple" | "single" | undefined;
    allowOther?: boolean | undefined;
    frequency?: "anytime" | "once_per_day" | "per_meal" | "morning" | "evening" | undefined;
    conditionalDisplay?: {
        questionId: string;
        optionId: string;
    } | undefined;
}, {
    order?: number | undefined;
    required?: boolean | undefined;
    icon?: string | undefined;
    color?: string | undefined;
    isActive?: boolean | undefined;
    categoryId?: string | undefined;
    title?: string | undefined;
    helpText?: string | undefined;
    selectionType?: "multiple" | "single" | undefined;
    allowOther?: boolean | undefined;
    frequency?: "anytime" | "once_per_day" | "per_meal" | "morning" | "evening" | undefined;
    conditionalDisplay?: {
        questionId: string;
        optionId: string;
    } | undefined;
}>;
export declare const CreateOptionSchema: z.ZodObject<{
    questionId: z.ZodString;
    label: z.ZodString;
    icon: z.ZodOptional<z.ZodString>;
    color: z.ZodOptional<z.ZodString>;
    allowComment: z.ZodDefault<z.ZodBoolean>;
    captureTime: z.ZodDefault<z.ZodEnum<["none", "auto_now", "user_picks"]>>;
    fields: z.ZodDefault<z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        label: z.ZodString;
        dataType: z.ZodEnum<["time", "datetime", "duration", "temperature", "range", "number", "string", "enum", "boolean", "image", "location"]>;
        unit: z.ZodOptional<z.ZodString>;
        allowedUnits: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        min: z.ZodOptional<z.ZodNumber>;
        max: z.ZodOptional<z.ZodNumber>;
        step: z.ZodOptional<z.ZodNumber>;
        enumValues: z.ZodOptional<z.ZodArray<z.ZodObject<{
            value: z.ZodString;
            label: z.ZodString;
            icon: z.ZodOptional<z.ZodString>;
            color: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            value: string;
            label: string;
            description?: string | undefined;
            icon?: string | undefined;
            color?: string | undefined;
        }, {
            value: string;
            label: string;
            description?: string | undefined;
            icon?: string | undefined;
            color?: string | undefined;
        }>, "many">>;
        defaultValue: z.ZodOptional<z.ZodUnknown>;
        required: z.ZodOptional<z.ZodBoolean>;
        placeholder: z.ZodOptional<z.ZodString>;
        helpText: z.ZodOptional<z.ZodString>;
        displayAs: z.ZodOptional<z.ZodEnum<["slider", "stepper", "chips", "dropdown", "text", "picker", "color-swatch", "image-grid", "toggle", "camera", "body-map"]>>;
    }, "strip", z.ZodTypeAny, {
        key: string;
        label: string;
        dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
        unit?: string | undefined;
        max?: number | undefined;
        min?: number | undefined;
        required?: boolean | undefined;
        helpText?: string | undefined;
        allowedUnits?: string[] | undefined;
        step?: number | undefined;
        enumValues?: {
            value: string;
            label: string;
            description?: string | undefined;
            icon?: string | undefined;
            color?: string | undefined;
        }[] | undefined;
        defaultValue?: unknown;
        placeholder?: string | undefined;
        displayAs?: "text" | "slider" | "stepper" | "chips" | "dropdown" | "picker" | "color-swatch" | "image-grid" | "toggle" | "camera" | "body-map" | undefined;
    }, {
        key: string;
        label: string;
        dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
        unit?: string | undefined;
        max?: number | undefined;
        min?: number | undefined;
        required?: boolean | undefined;
        helpText?: string | undefined;
        allowedUnits?: string[] | undefined;
        step?: number | undefined;
        enumValues?: {
            value: string;
            label: string;
            description?: string | undefined;
            icon?: string | undefined;
            color?: string | undefined;
        }[] | undefined;
        defaultValue?: unknown;
        placeholder?: string | undefined;
        displayAs?: "text" | "slider" | "stepper" | "chips" | "dropdown" | "picker" | "color-swatch" | "image-grid" | "toggle" | "camera" | "body-map" | undefined;
    }>, "many">>;
    order: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    fields: {
        key: string;
        label: string;
        dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
        unit?: string | undefined;
        max?: number | undefined;
        min?: number | undefined;
        required?: boolean | undefined;
        helpText?: string | undefined;
        allowedUnits?: string[] | undefined;
        step?: number | undefined;
        enumValues?: {
            value: string;
            label: string;
            description?: string | undefined;
            icon?: string | undefined;
            color?: string | undefined;
        }[] | undefined;
        defaultValue?: unknown;
        placeholder?: string | undefined;
        displayAs?: "text" | "slider" | "stepper" | "chips" | "dropdown" | "picker" | "color-swatch" | "image-grid" | "toggle" | "camera" | "body-map" | undefined;
    }[];
    questionId: string;
    label: string;
    allowComment: boolean;
    captureTime: "none" | "auto_now" | "user_picks";
    order?: number | undefined;
    icon?: string | undefined;
    color?: string | undefined;
}, {
    questionId: string;
    label: string;
    order?: number | undefined;
    fields?: {
        key: string;
        label: string;
        dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
        unit?: string | undefined;
        max?: number | undefined;
        min?: number | undefined;
        required?: boolean | undefined;
        helpText?: string | undefined;
        allowedUnits?: string[] | undefined;
        step?: number | undefined;
        enumValues?: {
            value: string;
            label: string;
            description?: string | undefined;
            icon?: string | undefined;
            color?: string | undefined;
        }[] | undefined;
        defaultValue?: unknown;
        placeholder?: string | undefined;
        displayAs?: "text" | "slider" | "stepper" | "chips" | "dropdown" | "picker" | "color-swatch" | "image-grid" | "toggle" | "camera" | "body-map" | undefined;
    }[] | undefined;
    icon?: string | undefined;
    color?: string | undefined;
    allowComment?: boolean | undefined;
    captureTime?: "none" | "auto_now" | "user_picks" | undefined;
}>;
export declare const UpdateOptionSchema: z.ZodObject<{
    questionId: z.ZodOptional<z.ZodString>;
    label: z.ZodOptional<z.ZodString>;
    icon: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    color: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    allowComment: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
    captureTime: z.ZodOptional<z.ZodDefault<z.ZodEnum<["none", "auto_now", "user_picks"]>>>;
    fields: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        label: z.ZodString;
        dataType: z.ZodEnum<["time", "datetime", "duration", "temperature", "range", "number", "string", "enum", "boolean", "image", "location"]>;
        unit: z.ZodOptional<z.ZodString>;
        allowedUnits: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        min: z.ZodOptional<z.ZodNumber>;
        max: z.ZodOptional<z.ZodNumber>;
        step: z.ZodOptional<z.ZodNumber>;
        enumValues: z.ZodOptional<z.ZodArray<z.ZodObject<{
            value: z.ZodString;
            label: z.ZodString;
            icon: z.ZodOptional<z.ZodString>;
            color: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            value: string;
            label: string;
            description?: string | undefined;
            icon?: string | undefined;
            color?: string | undefined;
        }, {
            value: string;
            label: string;
            description?: string | undefined;
            icon?: string | undefined;
            color?: string | undefined;
        }>, "many">>;
        defaultValue: z.ZodOptional<z.ZodUnknown>;
        required: z.ZodOptional<z.ZodBoolean>;
        placeholder: z.ZodOptional<z.ZodString>;
        helpText: z.ZodOptional<z.ZodString>;
        displayAs: z.ZodOptional<z.ZodEnum<["slider", "stepper", "chips", "dropdown", "text", "picker", "color-swatch", "image-grid", "toggle", "camera", "body-map"]>>;
    }, "strip", z.ZodTypeAny, {
        key: string;
        label: string;
        dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
        unit?: string | undefined;
        max?: number | undefined;
        min?: number | undefined;
        required?: boolean | undefined;
        helpText?: string | undefined;
        allowedUnits?: string[] | undefined;
        step?: number | undefined;
        enumValues?: {
            value: string;
            label: string;
            description?: string | undefined;
            icon?: string | undefined;
            color?: string | undefined;
        }[] | undefined;
        defaultValue?: unknown;
        placeholder?: string | undefined;
        displayAs?: "text" | "slider" | "stepper" | "chips" | "dropdown" | "picker" | "color-swatch" | "image-grid" | "toggle" | "camera" | "body-map" | undefined;
    }, {
        key: string;
        label: string;
        dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
        unit?: string | undefined;
        max?: number | undefined;
        min?: number | undefined;
        required?: boolean | undefined;
        helpText?: string | undefined;
        allowedUnits?: string[] | undefined;
        step?: number | undefined;
        enumValues?: {
            value: string;
            label: string;
            description?: string | undefined;
            icon?: string | undefined;
            color?: string | undefined;
        }[] | undefined;
        defaultValue?: unknown;
        placeholder?: string | undefined;
        displayAs?: "text" | "slider" | "stepper" | "chips" | "dropdown" | "picker" | "color-swatch" | "image-grid" | "toggle" | "camera" | "body-map" | undefined;
    }>, "many">>>;
    order: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
} & {
    isActive: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    order?: number | undefined;
    fields?: {
        key: string;
        label: string;
        dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
        unit?: string | undefined;
        max?: number | undefined;
        min?: number | undefined;
        required?: boolean | undefined;
        helpText?: string | undefined;
        allowedUnits?: string[] | undefined;
        step?: number | undefined;
        enumValues?: {
            value: string;
            label: string;
            description?: string | undefined;
            icon?: string | undefined;
            color?: string | undefined;
        }[] | undefined;
        defaultValue?: unknown;
        placeholder?: string | undefined;
        displayAs?: "text" | "slider" | "stepper" | "chips" | "dropdown" | "picker" | "color-swatch" | "image-grid" | "toggle" | "camera" | "body-map" | undefined;
    }[] | undefined;
    icon?: string | undefined;
    color?: string | undefined;
    isActive?: boolean | undefined;
    questionId?: string | undefined;
    label?: string | undefined;
    allowComment?: boolean | undefined;
    captureTime?: "none" | "auto_now" | "user_picks" | undefined;
}, {
    order?: number | undefined;
    fields?: {
        key: string;
        label: string;
        dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
        unit?: string | undefined;
        max?: number | undefined;
        min?: number | undefined;
        required?: boolean | undefined;
        helpText?: string | undefined;
        allowedUnits?: string[] | undefined;
        step?: number | undefined;
        enumValues?: {
            value: string;
            label: string;
            description?: string | undefined;
            icon?: string | undefined;
            color?: string | undefined;
        }[] | undefined;
        defaultValue?: unknown;
        placeholder?: string | undefined;
        displayAs?: "text" | "slider" | "stepper" | "chips" | "dropdown" | "picker" | "color-swatch" | "image-grid" | "toggle" | "camera" | "body-map" | undefined;
    }[] | undefined;
    icon?: string | undefined;
    color?: string | undefined;
    isActive?: boolean | undefined;
    questionId?: string | undefined;
    label?: string | undefined;
    allowComment?: boolean | undefined;
    captureTime?: "none" | "auto_now" | "user_picks" | undefined;
}>;
export declare const CreateQuickActionSchema: z.ZodObject<{
    label: z.ZodString;
    icon: z.ZodString;
    color: z.ZodString;
    mode: z.ZodEnum<["counter", "timer", "toggle"]>;
    defaultValue: z.ZodOptional<z.ZodNumber>;
    unit: z.ZodOptional<z.ZodString>;
    dailyGoal: z.ZodOptional<z.ZodNumber>;
    linkedQuestionId: z.ZodOptional<z.ZodString>;
    linkedOptionId: z.ZodOptional<z.ZodString>;
    order: z.ZodOptional<z.ZodNumber>;
    isVisible: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    mode: "toggle" | "counter" | "timer";
    icon: string;
    color: string;
    label: string;
    isVisible: boolean;
    unit?: string | undefined;
    order?: number | undefined;
    defaultValue?: number | undefined;
    dailyGoal?: number | undefined;
    linkedQuestionId?: string | undefined;
    linkedOptionId?: string | undefined;
}, {
    mode: "toggle" | "counter" | "timer";
    icon: string;
    color: string;
    label: string;
    unit?: string | undefined;
    order?: number | undefined;
    defaultValue?: number | undefined;
    dailyGoal?: number | undefined;
    linkedQuestionId?: string | undefined;
    linkedOptionId?: string | undefined;
    isVisible?: boolean | undefined;
}>;
export declare const UpdateQuickActionSchema: z.ZodObject<{
    label: z.ZodOptional<z.ZodString>;
    icon: z.ZodOptional<z.ZodString>;
    color: z.ZodOptional<z.ZodString>;
    mode: z.ZodOptional<z.ZodEnum<["counter", "timer", "toggle"]>>;
    defaultValue: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
    unit: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    dailyGoal: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
    linkedQuestionId: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    linkedOptionId: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    order: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
    isVisible: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
}, "strip", z.ZodTypeAny, {
    unit?: string | undefined;
    order?: number | undefined;
    mode?: "toggle" | "counter" | "timer" | undefined;
    icon?: string | undefined;
    color?: string | undefined;
    label?: string | undefined;
    defaultValue?: number | undefined;
    dailyGoal?: number | undefined;
    linkedQuestionId?: string | undefined;
    linkedOptionId?: string | undefined;
    isVisible?: boolean | undefined;
}, {
    unit?: string | undefined;
    order?: number | undefined;
    mode?: "toggle" | "counter" | "timer" | undefined;
    icon?: string | undefined;
    color?: string | undefined;
    label?: string | undefined;
    defaultValue?: number | undefined;
    dailyGoal?: number | undefined;
    linkedQuestionId?: string | undefined;
    linkedOptionId?: string | undefined;
    isVisible?: boolean | undefined;
}>;
export declare const CreateCustomUnitSchema: z.ZodObject<{
    symbol: z.ZodString;
    name: z.ZodString;
    dimension: z.ZodOptional<z.ZodString>;
    factorToBase: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    symbol: string;
    name: string;
    dimension?: string | undefined;
    factorToBase?: number | undefined;
}, {
    symbol: string;
    name: string;
    dimension?: string | undefined;
    factorToBase?: number | undefined;
}>;
export declare const WakeUpSchema: z.ZodObject<{
    wakeTime: z.ZodOptional<z.ZodString>;
    edited: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    wakeTime?: string | undefined;
    edited?: boolean | undefined;
}, {
    wakeTime?: string | undefined;
    edited?: boolean | undefined;
}>;
export declare const GoToSleepSchema: z.ZodObject<{
    sleepTime: z.ZodOptional<z.ZodString>;
    edited: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    sleepTime?: string | undefined;
    edited?: boolean | undefined;
}, {
    sleepTime?: string | undefined;
    edited?: boolean | undefined;
}>;
export declare const UpdateDaySessionSchema: z.ZodObject<{
    wakeTime: z.ZodOptional<z.ZodString>;
    sleepTime: z.ZodOptional<z.ZodString>;
    wakeEdited: z.ZodOptional<z.ZodBoolean>;
    sleepEdited: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    wakeTime?: string | undefined;
    sleepTime?: string | undefined;
    wakeEdited?: boolean | undefined;
    sleepEdited?: boolean | undefined;
}, {
    wakeTime?: string | undefined;
    sleepTime?: string | undefined;
    wakeEdited?: boolean | undefined;
    sleepEdited?: boolean | undefined;
}>;
export declare const FieldValueSchema: z.ZodObject<{
    fieldKey: z.ZodString;
    dataType: z.ZodEnum<["time", "datetime", "duration", "temperature", "range", "number", "string", "enum", "boolean", "image", "location"]>;
    value: z.ZodUnknown;
    unit: z.ZodOptional<z.ZodString>;
    canonicalValue: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
    fieldKey: string;
    unit?: string | undefined;
    value?: unknown;
    canonicalValue?: number | undefined;
}, {
    dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
    fieldKey: string;
    unit?: string | undefined;
    value?: unknown;
    canonicalValue?: number | undefined;
}>;
export declare const AnswerSchema: z.ZodObject<{
    optionId: z.ZodString;
    optionLabelSnapshot: z.ZodString;
    values: z.ZodDefault<z.ZodArray<z.ZodObject<{
        fieldKey: z.ZodString;
        dataType: z.ZodEnum<["time", "datetime", "duration", "temperature", "range", "number", "string", "enum", "boolean", "image", "location"]>;
        value: z.ZodUnknown;
        unit: z.ZodOptional<z.ZodString>;
        canonicalValue: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
        fieldKey: string;
        unit?: string | undefined;
        value?: unknown;
        canonicalValue?: number | undefined;
    }, {
        dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
        fieldKey: string;
        unit?: string | undefined;
        value?: unknown;
        canonicalValue?: number | undefined;
    }>, "many">>;
    comment: z.ZodOptional<z.ZodString>;
    otherText: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    values: {
        dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
        fieldKey: string;
        unit?: string | undefined;
        value?: unknown;
        canonicalValue?: number | undefined;
    }[];
    optionId: string;
    optionLabelSnapshot: string;
    comment?: string | undefined;
    otherText?: string | undefined;
}, {
    optionId: string;
    optionLabelSnapshot: string;
    values?: {
        dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
        fieldKey: string;
        unit?: string | undefined;
        value?: unknown;
        canonicalValue?: number | undefined;
    }[] | undefined;
    comment?: string | undefined;
    otherText?: string | undefined;
}>;
export declare const CreateLogEntrySchema: z.ZodObject<{
    clientId: z.ZodString;
    source: z.ZodEnum<["quick_action", "questionnaire", "check_in"]>;
    daySessionId: z.ZodOptional<z.ZodString>;
    categoryId: z.ZodOptional<z.ZodString>;
    questionId: z.ZodOptional<z.ZodString>;
    questionVersion: z.ZodOptional<z.ZodNumber>;
    quickActionId: z.ZodOptional<z.ZodString>;
    occurredAt: z.ZodString;
    timezone: z.ZodString;
    answers: z.ZodDefault<z.ZodArray<z.ZodObject<{
        optionId: z.ZodString;
        optionLabelSnapshot: z.ZodString;
        values: z.ZodDefault<z.ZodArray<z.ZodObject<{
            fieldKey: z.ZodString;
            dataType: z.ZodEnum<["time", "datetime", "duration", "temperature", "range", "number", "string", "enum", "boolean", "image", "location"]>;
            value: z.ZodUnknown;
            unit: z.ZodOptional<z.ZodString>;
            canonicalValue: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
            fieldKey: string;
            unit?: string | undefined;
            value?: unknown;
            canonicalValue?: number | undefined;
        }, {
            dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
            fieldKey: string;
            unit?: string | undefined;
            value?: unknown;
            canonicalValue?: number | undefined;
        }>, "many">>;
        comment: z.ZodOptional<z.ZodString>;
        otherText: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        values: {
            dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
            fieldKey: string;
            unit?: string | undefined;
            value?: unknown;
            canonicalValue?: number | undefined;
        }[];
        optionId: string;
        optionLabelSnapshot: string;
        comment?: string | undefined;
        otherText?: string | undefined;
    }, {
        optionId: string;
        optionLabelSnapshot: string;
        values?: {
            dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
            fieldKey: string;
            unit?: string | undefined;
            value?: unknown;
            canonicalValue?: number | undefined;
        }[] | undefined;
        comment?: string | undefined;
        otherText?: string | undefined;
    }>, "many">>;
    mediaIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    note: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    source: "quick_action" | "questionnaire" | "check_in";
    clientId: string;
    timezone: string;
    occurredAt: string;
    answers: {
        values: {
            dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
            fieldKey: string;
            unit?: string | undefined;
            value?: unknown;
            canonicalValue?: number | undefined;
        }[];
        optionId: string;
        optionLabelSnapshot: string;
        comment?: string | undefined;
        otherText?: string | undefined;
    }[];
    mediaIds: string[];
    categoryId?: string | undefined;
    questionId?: string | undefined;
    daySessionId?: string | undefined;
    questionVersion?: number | undefined;
    quickActionId?: string | undefined;
    note?: string | undefined;
}, {
    source: "quick_action" | "questionnaire" | "check_in";
    clientId: string;
    timezone: string;
    occurredAt: string;
    categoryId?: string | undefined;
    questionId?: string | undefined;
    daySessionId?: string | undefined;
    questionVersion?: number | undefined;
    quickActionId?: string | undefined;
    answers?: {
        optionId: string;
        optionLabelSnapshot: string;
        values?: {
            dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
            fieldKey: string;
            unit?: string | undefined;
            value?: unknown;
            canonicalValue?: number | undefined;
        }[] | undefined;
        comment?: string | undefined;
        otherText?: string | undefined;
    }[] | undefined;
    mediaIds?: string[] | undefined;
    note?: string | undefined;
}>;
export declare const BatchLogEntrySchema: z.ZodObject<{
    entries: z.ZodArray<z.ZodObject<{
        clientId: z.ZodString;
        source: z.ZodEnum<["quick_action", "questionnaire", "check_in"]>;
        daySessionId: z.ZodOptional<z.ZodString>;
        categoryId: z.ZodOptional<z.ZodString>;
        questionId: z.ZodOptional<z.ZodString>;
        questionVersion: z.ZodOptional<z.ZodNumber>;
        quickActionId: z.ZodOptional<z.ZodString>;
        occurredAt: z.ZodString;
        timezone: z.ZodString;
        answers: z.ZodDefault<z.ZodArray<z.ZodObject<{
            optionId: z.ZodString;
            optionLabelSnapshot: z.ZodString;
            values: z.ZodDefault<z.ZodArray<z.ZodObject<{
                fieldKey: z.ZodString;
                dataType: z.ZodEnum<["time", "datetime", "duration", "temperature", "range", "number", "string", "enum", "boolean", "image", "location"]>;
                value: z.ZodUnknown;
                unit: z.ZodOptional<z.ZodString>;
                canonicalValue: z.ZodOptional<z.ZodNumber>;
            }, "strip", z.ZodTypeAny, {
                dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
                fieldKey: string;
                unit?: string | undefined;
                value?: unknown;
                canonicalValue?: number | undefined;
            }, {
                dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
                fieldKey: string;
                unit?: string | undefined;
                value?: unknown;
                canonicalValue?: number | undefined;
            }>, "many">>;
            comment: z.ZodOptional<z.ZodString>;
            otherText: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            values: {
                dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
                fieldKey: string;
                unit?: string | undefined;
                value?: unknown;
                canonicalValue?: number | undefined;
            }[];
            optionId: string;
            optionLabelSnapshot: string;
            comment?: string | undefined;
            otherText?: string | undefined;
        }, {
            optionId: string;
            optionLabelSnapshot: string;
            values?: {
                dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
                fieldKey: string;
                unit?: string | undefined;
                value?: unknown;
                canonicalValue?: number | undefined;
            }[] | undefined;
            comment?: string | undefined;
            otherText?: string | undefined;
        }>, "many">>;
        mediaIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        note: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        source: "quick_action" | "questionnaire" | "check_in";
        clientId: string;
        timezone: string;
        occurredAt: string;
        answers: {
            values: {
                dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
                fieldKey: string;
                unit?: string | undefined;
                value?: unknown;
                canonicalValue?: number | undefined;
            }[];
            optionId: string;
            optionLabelSnapshot: string;
            comment?: string | undefined;
            otherText?: string | undefined;
        }[];
        mediaIds: string[];
        categoryId?: string | undefined;
        questionId?: string | undefined;
        daySessionId?: string | undefined;
        questionVersion?: number | undefined;
        quickActionId?: string | undefined;
        note?: string | undefined;
    }, {
        source: "quick_action" | "questionnaire" | "check_in";
        clientId: string;
        timezone: string;
        occurredAt: string;
        categoryId?: string | undefined;
        questionId?: string | undefined;
        daySessionId?: string | undefined;
        questionVersion?: number | undefined;
        quickActionId?: string | undefined;
        answers?: {
            optionId: string;
            optionLabelSnapshot: string;
            values?: {
                dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
                fieldKey: string;
                unit?: string | undefined;
                value?: unknown;
                canonicalValue?: number | undefined;
            }[] | undefined;
            comment?: string | undefined;
            otherText?: string | undefined;
        }[] | undefined;
        mediaIds?: string[] | undefined;
        note?: string | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    entries: {
        source: "quick_action" | "questionnaire" | "check_in";
        clientId: string;
        timezone: string;
        occurredAt: string;
        answers: {
            values: {
                dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
                fieldKey: string;
                unit?: string | undefined;
                value?: unknown;
                canonicalValue?: number | undefined;
            }[];
            optionId: string;
            optionLabelSnapshot: string;
            comment?: string | undefined;
            otherText?: string | undefined;
        }[];
        mediaIds: string[];
        categoryId?: string | undefined;
        questionId?: string | undefined;
        daySessionId?: string | undefined;
        questionVersion?: number | undefined;
        quickActionId?: string | undefined;
        note?: string | undefined;
    }[];
}, {
    entries: {
        source: "quick_action" | "questionnaire" | "check_in";
        clientId: string;
        timezone: string;
        occurredAt: string;
        categoryId?: string | undefined;
        questionId?: string | undefined;
        daySessionId?: string | undefined;
        questionVersion?: number | undefined;
        quickActionId?: string | undefined;
        answers?: {
            optionId: string;
            optionLabelSnapshot: string;
            values?: {
                dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
                fieldKey: string;
                unit?: string | undefined;
                value?: unknown;
                canonicalValue?: number | undefined;
            }[] | undefined;
            comment?: string | undefined;
            otherText?: string | undefined;
        }[] | undefined;
        mediaIds?: string[] | undefined;
        note?: string | undefined;
    }[];
}>;
export declare const SyncPushSchema: z.ZodObject<{
    logs: z.ZodOptional<z.ZodArray<z.ZodObject<{
        clientId: z.ZodString;
        source: z.ZodEnum<["quick_action", "questionnaire", "check_in"]>;
        daySessionId: z.ZodOptional<z.ZodString>;
        categoryId: z.ZodOptional<z.ZodString>;
        questionId: z.ZodOptional<z.ZodString>;
        questionVersion: z.ZodOptional<z.ZodNumber>;
        quickActionId: z.ZodOptional<z.ZodString>;
        occurredAt: z.ZodString;
        timezone: z.ZodString;
        answers: z.ZodDefault<z.ZodArray<z.ZodObject<{
            optionId: z.ZodString;
            optionLabelSnapshot: z.ZodString;
            values: z.ZodDefault<z.ZodArray<z.ZodObject<{
                fieldKey: z.ZodString;
                dataType: z.ZodEnum<["time", "datetime", "duration", "temperature", "range", "number", "string", "enum", "boolean", "image", "location"]>;
                value: z.ZodUnknown;
                unit: z.ZodOptional<z.ZodString>;
                canonicalValue: z.ZodOptional<z.ZodNumber>;
            }, "strip", z.ZodTypeAny, {
                dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
                fieldKey: string;
                unit?: string | undefined;
                value?: unknown;
                canonicalValue?: number | undefined;
            }, {
                dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
                fieldKey: string;
                unit?: string | undefined;
                value?: unknown;
                canonicalValue?: number | undefined;
            }>, "many">>;
            comment: z.ZodOptional<z.ZodString>;
            otherText: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            values: {
                dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
                fieldKey: string;
                unit?: string | undefined;
                value?: unknown;
                canonicalValue?: number | undefined;
            }[];
            optionId: string;
            optionLabelSnapshot: string;
            comment?: string | undefined;
            otherText?: string | undefined;
        }, {
            optionId: string;
            optionLabelSnapshot: string;
            values?: {
                dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
                fieldKey: string;
                unit?: string | undefined;
                value?: unknown;
                canonicalValue?: number | undefined;
            }[] | undefined;
            comment?: string | undefined;
            otherText?: string | undefined;
        }>, "many">>;
        mediaIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        note: z.ZodOptional<z.ZodString>;
    } & {
        updatedAt: z.ZodString;
        deletedAt: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        source: "quick_action" | "questionnaire" | "check_in";
        clientId: string;
        updatedAt: string;
        timezone: string;
        occurredAt: string;
        answers: {
            values: {
                dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
                fieldKey: string;
                unit?: string | undefined;
                value?: unknown;
                canonicalValue?: number | undefined;
            }[];
            optionId: string;
            optionLabelSnapshot: string;
            comment?: string | undefined;
            otherText?: string | undefined;
        }[];
        mediaIds: string[];
        categoryId?: string | undefined;
        questionId?: string | undefined;
        daySessionId?: string | undefined;
        questionVersion?: number | undefined;
        quickActionId?: string | undefined;
        note?: string | undefined;
        deletedAt?: string | undefined;
    }, {
        source: "quick_action" | "questionnaire" | "check_in";
        clientId: string;
        updatedAt: string;
        timezone: string;
        occurredAt: string;
        categoryId?: string | undefined;
        questionId?: string | undefined;
        daySessionId?: string | undefined;
        questionVersion?: number | undefined;
        quickActionId?: string | undefined;
        answers?: {
            optionId: string;
            optionLabelSnapshot: string;
            values?: {
                dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
                fieldKey: string;
                unit?: string | undefined;
                value?: unknown;
                canonicalValue?: number | undefined;
            }[] | undefined;
            comment?: string | undefined;
            otherText?: string | undefined;
        }[] | undefined;
        mediaIds?: string[] | undefined;
        note?: string | undefined;
        deletedAt?: string | undefined;
    }>, "many">>;
    configChanges: z.ZodOptional<z.ZodObject<{
        categories: z.ZodOptional<z.ZodArray<z.ZodUnknown, "many">>;
        questions: z.ZodOptional<z.ZodArray<z.ZodUnknown, "many">>;
        options: z.ZodOptional<z.ZodArray<z.ZodUnknown, "many">>;
        quickActions: z.ZodOptional<z.ZodArray<z.ZodUnknown, "many">>;
        customUnits: z.ZodOptional<z.ZodArray<z.ZodUnknown, "many">>;
    }, "strip", z.ZodTypeAny, {
        options?: unknown[] | undefined;
        categories?: unknown[] | undefined;
        questions?: unknown[] | undefined;
        quickActions?: unknown[] | undefined;
        customUnits?: unknown[] | undefined;
    }, {
        options?: unknown[] | undefined;
        categories?: unknown[] | undefined;
        questions?: unknown[] | undefined;
        quickActions?: unknown[] | undefined;
        customUnits?: unknown[] | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    logs?: {
        source: "quick_action" | "questionnaire" | "check_in";
        clientId: string;
        updatedAt: string;
        timezone: string;
        occurredAt: string;
        answers: {
            values: {
                dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
                fieldKey: string;
                unit?: string | undefined;
                value?: unknown;
                canonicalValue?: number | undefined;
            }[];
            optionId: string;
            optionLabelSnapshot: string;
            comment?: string | undefined;
            otherText?: string | undefined;
        }[];
        mediaIds: string[];
        categoryId?: string | undefined;
        questionId?: string | undefined;
        daySessionId?: string | undefined;
        questionVersion?: number | undefined;
        quickActionId?: string | undefined;
        note?: string | undefined;
        deletedAt?: string | undefined;
    }[] | undefined;
    configChanges?: {
        options?: unknown[] | undefined;
        categories?: unknown[] | undefined;
        questions?: unknown[] | undefined;
        quickActions?: unknown[] | undefined;
        customUnits?: unknown[] | undefined;
    } | undefined;
}, {
    logs?: {
        source: "quick_action" | "questionnaire" | "check_in";
        clientId: string;
        updatedAt: string;
        timezone: string;
        occurredAt: string;
        categoryId?: string | undefined;
        questionId?: string | undefined;
        daySessionId?: string | undefined;
        questionVersion?: number | undefined;
        quickActionId?: string | undefined;
        answers?: {
            optionId: string;
            optionLabelSnapshot: string;
            values?: {
                dataType: "string" | "number" | "boolean" | "image" | "location" | "range" | "enum" | "time" | "datetime" | "duration" | "temperature";
                fieldKey: string;
                unit?: string | undefined;
                value?: unknown;
                canonicalValue?: number | undefined;
            }[] | undefined;
            comment?: string | undefined;
            otherText?: string | undefined;
        }[] | undefined;
        mediaIds?: string[] | undefined;
        note?: string | undefined;
        deletedAt?: string | undefined;
    }[] | undefined;
    configChanges?: {
        options?: unknown[] | undefined;
        categories?: unknown[] | undefined;
        questions?: unknown[] | undefined;
        quickActions?: unknown[] | undefined;
        customUnits?: unknown[] | undefined;
    } | undefined;
}>;
export declare const RegisterSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
    name: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
    email: string;
    password: string;
}, {
    name: string;
    email: string;
    password: string;
}>;
export declare const LoginSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
    password: string;
}, {
    email: string;
    password: string;
}>;
export declare const CreateReminderSchema: z.ZodObject<{
    type: z.ZodEnum<["time", "inactivity"]>;
    schedule: z.ZodOptional<z.ZodString>;
    inactivityMinutes: z.ZodOptional<z.ZodNumber>;
    quickActionId: z.ZodOptional<z.ZodString>;
    message: z.ZodString;
    isActive: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    message: string;
    type: "time" | "inactivity";
    isActive: boolean;
    quickActionId?: string | undefined;
    schedule?: string | undefined;
    inactivityMinutes?: number | undefined;
}, {
    message: string;
    type: "time" | "inactivity";
    isActive?: boolean | undefined;
    quickActionId?: string | undefined;
    schedule?: string | undefined;
    inactivityMinutes?: number | undefined;
}>;
export declare const CreateMedicationSchema: z.ZodObject<{
    name: z.ZodString;
    dose: z.ZodOptional<z.ZodString>;
    unit: z.ZodOptional<z.ZodString>;
    schedule: z.ZodOptional<z.ZodString>;
    active: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    name: string;
    active: boolean;
    unit?: string | undefined;
    schedule?: string | undefined;
    dose?: string | undefined;
}, {
    name: string;
    unit?: string | undefined;
    schedule?: string | undefined;
    dose?: string | undefined;
    active?: boolean | undefined;
}>;
export declare const ApplyTemplatesSchema: z.ZodObject<{
    templateKeys: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    templateKeys: string[];
}, {
    templateKeys: string[];
}>;
export declare const ReportRequestSchema: z.ZodObject<{
    from: z.ZodString;
    to: z.ZodString;
    format: z.ZodDefault<z.ZodEnum<["pdf", "csv", "json"]>>;
    categoryIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    includeImages: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    format: "json" | "pdf" | "csv";
    from: string;
    to: string;
    includeImages: boolean;
    categoryIds?: string[] | undefined;
}, {
    from: string;
    to: string;
    format?: "json" | "pdf" | "csv" | undefined;
    categoryIds?: string[] | undefined;
    includeImages?: boolean | undefined;
}>;
export declare const ReorderSchema: z.ZodObject<{
    ids: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    ids: string[];
}, {
    ids: string[];
}>;
