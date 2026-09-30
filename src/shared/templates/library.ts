/**
 * Starter template library.
 * These are BUNDLED in both server and mobile — they are never stored in the DB globally.
 * When a user applies a template, its data is copied into their own collections.
 */

import { BRISTOL_SCALE } from './bristolScale';
import { URINE_COLOR } from './urineColor';

// ─────────────────────────────────────────────
//  Template shapes (minimal — enough to seed user collections)
// ─────────────────────────────────────────────

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
    enumValues?: Array<{ value: string; label: string; icon?: string; color?: string; description?: string }>;
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

// ─────────────────────────────────────────────
//  Severity field helper
// ─────────────────────────────────────────────

const severityField = {
  key: 'severity',
  label: 'Severity',
  dataType: 'range',
  min: 0,
  max: 10,
  step: 1,
  displayAs: 'slider',
  helpText: '0 = none, 10 = worst ever',
};

// ─────────────────────────────────────────────
//  CATEGORY: Symptoms
// ─────────────────────────────────────────────

const categorySymptoms: TemplateCategory = {
  templateKey: 'cat_symptoms',
  name: 'Symptoms',
  icon: '🩺',
  color: '#E57373',
  role: 'symptom',
  order: 1,
  questions: [
    {
      templateKey: 'q_symptoms_general',
      title: 'What symptoms are you experiencing?',
      helpText: 'Select all that apply right now',
      icon: '🩺',
      selectionType: 'multiple',
      allowOther: true,
      required: false,
      frequency: 'anytime',
      order: 1,
      options: [
        {
          templateKey: 'opt_fatigue',
          label: 'Fatigue',
          icon: '😴',
          color: '#9E9E9E',
          allowComment: true,
          captureTime: 'user_picks',
          order: 1,
          fields: [severityField],
        },
        {
          templateKey: 'opt_joint_pain',
          label: 'Joint pain',
          icon: '🦴',
          color: '#F44336',
          allowComment: true,
          captureTime: 'user_picks',
          order: 2,
          fields: [
            severityField,
            { key: 'location', label: 'Which joints?', dataType: 'location', displayAs: 'body-map' },
            { key: 'started_at', label: 'Started at', dataType: 'time', displayAs: 'picker' },
            { key: 'duration', label: 'Duration', dataType: 'duration', displayAs: 'picker' },
          ],
        },
        {
          templateKey: 'opt_swelling',
          label: 'Swelling / inflammation',
          icon: '🔴',
          color: '#FF5252',
          allowComment: true,
          captureTime: 'user_picks',
          order: 3,
          fields: [
            severityField,
            { key: 'location', label: 'Where?', dataType: 'location', displayAs: 'body-map' },
          ],
        },
        {
          templateKey: 'opt_stiffness',
          label: 'Morning stiffness',
          icon: '🤸',
          color: '#FF7043',
          allowComment: true,
          captureTime: 'user_picks',
          order: 4,
          fields: [
            severityField,
            { key: 'duration', label: 'Duration', dataType: 'duration', displayAs: 'picker' },
          ],
        },
        {
          templateKey: 'opt_brain_fog',
          label: 'Brain fog',
          icon: '🌫️',
          color: '#78909C',
          allowComment: true,
          captureTime: 'user_picks',
          order: 5,
          fields: [severityField],
        },
        {
          templateKey: 'opt_headache',
          label: 'Headache',
          icon: '🤕',
          color: '#AB47BC',
          allowComment: true,
          captureTime: 'user_picks',
          order: 6,
          fields: [
            severityField,
            { key: 'location', label: 'Where?', dataType: 'enum', displayAs: 'chips',
              enumValues: [
                { value: 'forehead', label: 'Forehead' },
                { value: 'temples', label: 'Temples' },
                { value: 'back', label: 'Back of head' },
                { value: 'whole', label: 'Whole head' },
              ],
            },
          ],
        },
        {
          templateKey: 'opt_rash',
          label: 'Rash / skin flare',
          icon: '🔴',
          color: '#EF5350',
          allowComment: true,
          captureTime: 'user_picks',
          order: 7,
          fields: [
            severityField,
            { key: 'location', label: 'Location', dataType: 'location', displayAs: 'body-map' },
            { key: 'photo', label: 'Photo', dataType: 'image', displayAs: 'camera' },
          ],
        },
        {
          templateKey: 'opt_fever',
          label: 'Fever',
          icon: '🌡️',
          color: '#FF6F00',
          allowComment: true,
          captureTime: 'user_picks',
          order: 8,
          fields: [
            { key: 'temperature', label: 'Temperature', dataType: 'temperature', unit: '°C', allowedUnits: ['°C', '°F'], displayAs: 'stepper', min: 35, max: 42, step: 0.1 },
          ],
        },
        {
          templateKey: 'opt_digestive',
          label: 'Digestive issues',
          icon: '🤢',
          color: '#66BB6A',
          allowComment: true,
          captureTime: 'user_picks',
          order: 9,
          fields: [
            severityField,
            { key: 'type', label: 'Type', dataType: 'enum', displayAs: 'chips',
              enumValues: [
                { value: 'nausea',    label: 'Nausea' },
                { value: 'vomiting',  label: 'Vomiting' },
                { value: 'bloating',  label: 'Bloating' },
                { value: 'cramps',    label: 'Cramps' },
                { value: 'diarrhea',  label: 'Diarrhea' },
                { value: 'constipation', label: 'Constipation' },
              ],
            },
          ],
        },
        {
          templateKey: 'opt_dry_eyes',
          label: 'Dry eyes / dry mouth',
          icon: '👁️',
          color: '#26C6DA',
          allowComment: true,
          captureTime: 'user_picks',
          order: 10,
          fields: [severityField],
        },
      ],
    },
  ],
};

// ─────────────────────────────────────────────
//  CATEGORY: Food & Drink
// ─────────────────────────────────────────────

const categoryFood: TemplateCategory = {
  templateKey: 'cat_food',
  name: 'Food & Drink',
  icon: '🍽️',
  color: '#66BB6A',
  role: 'trigger_candidate',
  order: 2,
  questions: [
    {
      templateKey: 'q_meal_type',
      title: 'What meal / snack is this?',
      icon: '🍽️',
      selectionType: 'single',
      allowOther: false,
      required: false,
      frequency: 'anytime',
      order: 1,
      options: [
        { templateKey: 'opt_breakfast', label: 'Breakfast', icon: '🌅', color: '#FFA726', allowComment: false, captureTime: 'auto_now', order: 1, fields: [] },
        { templateKey: 'opt_lunch',     label: 'Lunch',     icon: '☀️', color: '#FFCA28', allowComment: false, captureTime: 'auto_now', order: 2, fields: [] },
        { templateKey: 'opt_dinner',    label: 'Dinner',    icon: '🌙', color: '#5C6BC0', allowComment: false, captureTime: 'auto_now', order: 3, fields: [] },
        { templateKey: 'opt_snack',     label: 'Snack',     icon: '🍎', color: '#26A69A', allowComment: false, captureTime: 'auto_now', order: 4, fields: [] },
      ],
    },
    {
      templateKey: 'q_trigger_foods',
      title: 'Did you eat any of these?',
      helpText: 'Common autoimmune trigger foods — select all that apply',
      icon: '⚠️',
      selectionType: 'multiple',
      allowOther: true,
      required: false,
      frequency: 'per_meal',
      order: 2,
      options: [
        { templateKey: 'opt_gluten',      label: 'Gluten / wheat',     icon: '🌾', color: '#D7CCC8', allowComment: true, captureTime: 'none', order: 1,
          fields: [{ key: 'amount', label: 'Approx. amount', dataType: 'string', displayAs: 'text' }] },
        { templateKey: 'opt_dairy',       label: 'Dairy',              icon: '🥛', color: '#ECEFF1', allowComment: true, captureTime: 'none', order: 2, fields: [] },
        { templateKey: 'opt_sugar',       label: 'Refined sugar',      icon: '🍬', color: '#F8BBD0', allowComment: true, captureTime: 'none', order: 3, fields: [] },
        { templateKey: 'opt_nightshades', label: 'Nightshades',        icon: '🍅', color: '#EF9A9A', allowComment: true, captureTime: 'none', order: 4,
          fields: [{ key: 'type', label: 'Which?', dataType: 'string', displayAs: 'text', placeholder: 'tomato, pepper, eggplant...' }] },
        { templateKey: 'opt_alcohol',     label: 'Alcohol',            icon: '🍷', color: '#CE93D8', allowComment: true, captureTime: 'none', order: 5,
          fields: [{ key: 'amount', label: 'Amount', dataType: 'number', unit: 'glass', allowedUnits: ['glass', 'ml'], displayAs: 'stepper', min: 0, max: 20, step: 0.5 }] },
        { templateKey: 'opt_caffeine',    label: 'Caffeine',           icon: '☕', color: '#A1887F', allowComment: true, captureTime: 'none', order: 6, fields: [] },
        { templateKey: 'opt_processed',   label: 'Processed / fast food', icon: '🍔', color: '#FFCC80', allowComment: true, captureTime: 'none', order: 7, fields: [] },
        { templateKey: 'opt_legumes',     label: 'Legumes / soy',     icon: '🫘', color: '#A5D6A7', allowComment: true, captureTime: 'none', order: 8, fields: [] },
        { templateKey: 'opt_eggs',        label: 'Eggs',               icon: '🥚', color: '#FFF9C4', allowComment: true, captureTime: 'none', order: 9, fields: [] },
      ],
    },
  ],
};

// ─────────────────────────────────────────────
//  CATEGORY: Daily Habits / Activities
// ─────────────────────────────────────────────

const categoryHabits: TemplateCategory = {
  templateKey: 'cat_habits',
  name: 'Daily Habits',
  icon: '🌿',
  color: '#42A5F5',
  role: 'trigger_candidate',
  order: 3,
  questions: [
    {
      templateKey: 'q_sleep_quality',
      title: 'How did you sleep?',
      icon: '😴',
      selectionType: 'single',
      allowOther: false,
      required: false,
      frequency: 'morning',
      order: 1,
      options: [
        { templateKey: 'opt_sleep_poor',    label: 'Poor',      icon: '😩', color: '#EF5350', allowComment: true, captureTime: 'none', order: 1,
          fields: [{ key: 'hours', label: 'Hours slept', dataType: 'number', unit: 'h', displayAs: 'stepper', min: 0, max: 24, step: 0.5 }] },
        { templateKey: 'opt_sleep_fair',    label: 'Fair',      icon: '😐', color: '#FFA726', allowComment: true, captureTime: 'none', order: 2,
          fields: [{ key: 'hours', label: 'Hours slept', dataType: 'number', unit: 'h', displayAs: 'stepper', min: 0, max: 24, step: 0.5 }] },
        { templateKey: 'opt_sleep_good',    label: 'Good',      icon: '😊', color: '#66BB6A', allowComment: false, captureTime: 'none', order: 3,
          fields: [{ key: 'hours', label: 'Hours slept', dataType: 'number', unit: 'h', displayAs: 'stepper', min: 0, max: 24, step: 0.5 }] },
        { templateKey: 'opt_sleep_great',   label: 'Great',     icon: '😄', color: '#26C6DA', allowComment: false, captureTime: 'none', order: 4,
          fields: [{ key: 'hours', label: 'Hours slept', dataType: 'number', unit: 'h', displayAs: 'stepper', min: 0, max: 24, step: 0.5 }] },
      ],
    },
    {
      templateKey: 'q_exercise',
      title: 'Did you exercise today?',
      icon: '🏃',
      selectionType: 'single',
      allowOther: false,
      required: false,
      frequency: 'once_per_day',
      order: 2,
      options: [
        { templateKey: 'opt_no_exercise', label: 'No', icon: '🛋️', color: '#9E9E9E', allowComment: false, captureTime: 'none', order: 1, fields: [] },
        { templateKey: 'opt_light_exercise', label: 'Light (walk / stretch)', icon: '🚶', color: '#A5D6A7', allowComment: true, captureTime: 'user_picks', order: 2,
          fields: [{ key: 'duration', label: 'Duration', dataType: 'duration', displayAs: 'picker' }] },
        { templateKey: 'opt_moderate_exercise', label: 'Moderate', icon: '🚴', color: '#FFCC02', allowComment: true, captureTime: 'user_picks', order: 3,
          fields: [{ key: 'duration', label: 'Duration', dataType: 'duration', displayAs: 'picker' }] },
        { templateKey: 'opt_intense_exercise', label: 'Intense', icon: '🏋️', color: '#FF7043', allowComment: true, captureTime: 'user_picks', order: 4,
          fields: [{ key: 'duration', label: 'Duration', dataType: 'duration', displayAs: 'picker' }] },
      ],
    },
    {
      templateKey: 'q_stress',
      title: 'Stress level today',
      icon: '😰',
      selectionType: 'single',
      allowOther: false,
      required: false,
      frequency: 'once_per_day',
      order: 3,
      options: [
        { templateKey: 'opt_stress_low',    label: 'Low',      icon: '😌', color: '#66BB6A', allowComment: false, captureTime: 'none', order: 1, fields: [] },
        { templateKey: 'opt_stress_medium', label: 'Medium',   icon: '😐', color: '#FFA726', allowComment: true,  captureTime: 'none', order: 2, fields: [] },
        { templateKey: 'opt_stress_high',   label: 'High',     icon: '😰', color: '#EF5350', allowComment: true,  captureTime: 'none', order: 3, fields: [] },
      ],
    },
    {
      templateKey: 'q_sun_exposure',
      title: 'Sun exposure',
      helpText: 'Important for lupus / photosensitivity tracking',
      icon: '☀️',
      selectionType: 'single',
      allowOther: false,
      required: false,
      frequency: 'once_per_day',
      order: 4,
      options: [
        { templateKey: 'opt_sun_none',     label: 'None',          icon: '🌚', color: '#9E9E9E', allowComment: false, captureTime: 'none', order: 1, fields: [] },
        { templateKey: 'opt_sun_brief',    label: 'Brief (<15 min)', icon: '🌤️', color: '#FFD54F', allowComment: false, captureTime: 'none', order: 2,
          fields: [{ key: 'spf', label: 'SPF used?', dataType: 'boolean', displayAs: 'toggle' }] },
        { templateKey: 'opt_sun_moderate', label: 'Moderate (15–60 min)', icon: '🌞', color: '#FFA726', allowComment: true, captureTime: 'user_picks', order: 3,
          fields: [{ key: 'spf', label: 'SPF used?', dataType: 'boolean', displayAs: 'toggle' }] },
        { templateKey: 'opt_sun_extended', label: 'Extended (>60 min)', icon: '☀️', color: '#FF7043', allowComment: true, captureTime: 'user_picks', order: 4,
          fields: [{ key: 'duration', label: 'Duration', dataType: 'duration', displayAs: 'picker' }, { key: 'spf', label: 'SPF used?', dataType: 'boolean', displayAs: 'toggle' }] },
      ],
    },
  ],
};

// ─────────────────────────────────────────────
//  CATEGORY: Medications (optional)
// ─────────────────────────────────────────────

const categoryMedications: TemplateCategory = {
  templateKey: 'cat_medications',
  name: 'Medications',
  icon: '💊',
  color: '#AB47BC',
  role: 'context',
  order: 4,
  questions: [
    {
      templateKey: 'q_medications',
      title: 'Medications & supplements taken',
      icon: '💊',
      selectionType: 'multiple',
      allowOther: true,
      required: false,
      frequency: 'anytime',
      order: 1,
      options: [
        { templateKey: 'opt_med_taken', label: 'Taken as prescribed', icon: '✅', color: '#66BB6A', allowComment: false, captureTime: 'auto_now', order: 1,
          fields: [{ key: 'name', label: 'Medication name', dataType: 'string', displayAs: 'text', required: true }] },
        { templateKey: 'opt_med_missed', label: 'Missed dose', icon: '❌', color: '#EF5350', allowComment: true, captureTime: 'auto_now', order: 2,
          fields: [{ key: 'name', label: 'Medication name', dataType: 'string', displayAs: 'text', required: true }] },
        { templateKey: 'opt_med_extra', label: 'Extra / rescue dose', icon: '➕', color: '#FF7043', allowComment: true, captureTime: 'auto_now', order: 3,
          fields: [{ key: 'name', label: 'Medication name', dataType: 'string', displayAs: 'text', required: true }] },
      ],
    },
  ],
};

// ─────────────────────────────────────────────
//  CATEGORY: Body Output (optional, sensitive)
// ─────────────────────────────────────────────

const categoryBodyOutput: TemplateCategory = {
  templateKey: 'cat_body_output',
  name: 'Body Output',
  icon: '🚽',
  color: '#8D6E63',
  role: 'context',
  order: 5,
  questions: [
    {
      templateKey: 'q_bowel',
      title: 'Bowel movement',
      icon: '💩',
      selectionType: 'single',
      allowOther: false,
      required: false,
      frequency: 'anytime',
      order: 1,
      options: [
        {
          templateKey: 'opt_bowel_movement',
          label: 'Bowel movement',
          icon: '💩',
          color: '#8D6E63',
          allowComment: true,
          captureTime: 'auto_now',
          order: 1,
          fields: [
            { key: 'bristol', label: 'Bristol scale', dataType: 'enum', displayAs: 'image-grid', enumValues: BRISTOL_SCALE },
            { key: 'urgency', label: 'Urgency', dataType: 'range', min: 0, max: 5, step: 1, displayAs: 'slider', helpText: '0 = none, 5 = urgent' },
            { key: 'pain',    label: 'Pain?', dataType: 'boolean', displayAs: 'toggle' },
            { key: 'photo',   label: 'Photo (optional)', dataType: 'image', displayAs: 'camera' },
          ],
        },
      ],
    },
    {
      templateKey: 'q_urine',
      title: 'Urine',
      icon: '🫧',
      selectionType: 'single',
      allowOther: false,
      required: false,
      frequency: 'anytime',
      order: 2,
      options: [
        {
          templateKey: 'opt_urine',
          label: 'Urination',
          icon: '🫧',
          color: '#FFF9C4',
          allowComment: true,
          captureTime: 'auto_now',
          order: 1,
          fields: [
            { key: 'color', label: 'Colour', dataType: 'enum', displayAs: 'color-swatch', enumValues: URINE_COLOR },
            { key: 'photo', label: 'Photo (optional)', dataType: 'image', displayAs: 'camera' },
          ],
        },
      ],
    },
  ],
};

// ─────────────────────────────────────────────
//  CATEGORY: Mood & Stress (optional)
// ─────────────────────────────────────────────

const categoryMood: TemplateCategory = {
  templateKey: 'cat_mood',
  name: 'Mood & Stress',
  icon: '🧠',
  color: '#7E57C2',
  role: 'context',
  order: 6,
  questions: [
    {
      templateKey: 'q_mood',
      title: 'How are you feeling emotionally?',
      icon: '😊',
      selectionType: 'single',
      allowOther: false,
      required: false,
      frequency: 'anytime',
      order: 1,
      options: [
        { templateKey: 'opt_mood_great',   label: 'Great',    icon: '😄', color: '#26C6DA', allowComment: false, captureTime: 'none', order: 1, fields: [] },
        { templateKey: 'opt_mood_good',    label: 'Good',     icon: '😊', color: '#66BB6A', allowComment: false, captureTime: 'none', order: 2, fields: [] },
        { templateKey: 'opt_mood_okay',    label: 'Okay',     icon: '😐', color: '#FFA726', allowComment: false, captureTime: 'none', order: 3, fields: [] },
        { templateKey: 'opt_mood_low',     label: 'Low',      icon: '😔', color: '#78909C', allowComment: true,  captureTime: 'none', order: 4, fields: [] },
        { templateKey: 'opt_mood_anxious', label: 'Anxious',  icon: '😰', color: '#EF5350', allowComment: true,  captureTime: 'none', order: 5, fields: [] },
      ],
    },
  ],
};

// ─────────────────────────────────────────────
//  CATEGORY: Vitals (optional)
// ─────────────────────────────────────────────

const categoryVitals: TemplateCategory = {
  templateKey: 'cat_vitals',
  name: 'Vitals',
  icon: '❤️',
  color: '#EF5350',
  role: 'context',
  order: 7,
  questions: [
    {
      templateKey: 'q_vitals',
      title: 'Which vital are you recording?',
      icon: '📊',
      selectionType: 'single',
      allowOther: false,
      required: false,
      frequency: 'anytime',
      order: 1,
      options: [
        { templateKey: 'opt_weight', label: 'Weight', icon: '⚖️', color: '#42A5F5', allowComment: false, captureTime: 'auto_now', order: 1,
          fields: [{ key: 'weight', label: 'Weight', dataType: 'number', unit: 'kg', allowedUnits: ['kg', 'lb'], displayAs: 'stepper', min: 20, max: 300, step: 0.1 }] },
        { templateKey: 'opt_temp', label: 'Body temperature', icon: '🌡️', color: '#FF7043', allowComment: false, captureTime: 'auto_now', order: 2,
          fields: [{ key: 'temperature', label: 'Temperature', dataType: 'temperature', unit: '°C', allowedUnits: ['°C', '°F'], displayAs: 'stepper', min: 35, max: 42, step: 0.1 }] },
        { templateKey: 'opt_bp', label: 'Blood pressure', icon: '💓', color: '#EF5350', allowComment: false, captureTime: 'auto_now', order: 3,
          fields: [
            { key: 'systolic', label: 'Systolic', dataType: 'number', unit: 'mmHg', displayAs: 'stepper', min: 60, max: 250, step: 1 },
            { key: 'diastolic', label: 'Diastolic', dataType: 'number', unit: 'mmHg', displayAs: 'stepper', min: 40, max: 150, step: 1 },
          ],
        },
        { templateKey: 'opt_hr', label: 'Heart rate', icon: '💙', color: '#26C6DA', allowComment: false, captureTime: 'auto_now', order: 4,
          fields: [{ key: 'bpm', label: 'BPM', dataType: 'number', unit: 'bpm', displayAs: 'stepper', min: 30, max: 220, step: 1 }] },
        { templateKey: 'opt_glucose', label: 'Blood glucose', icon: '🩸', color: '#FF8A65', allowComment: false, captureTime: 'auto_now', order: 5,
          fields: [{ key: 'glucose', label: 'Glucose', dataType: 'number', unit: 'mg/dL', allowedUnits: ['mg/dL', 'mmol/L'], displayAs: 'stepper', min: 30, max: 600, step: 0.1 }] },
      ],
    },
  ],
};

// ─────────────────────────────────────────────
//  Quick actions
// ─────────────────────────────────────────────

export const QUICK_ACTION_TEMPLATES: TemplateQuickAction[] = [
  { templateKey: 'qa_water',    label: 'Water',       icon: '💧', color: '#29B6F6', mode: 'counter', defaultValue: 250, unit: 'ml', dailyGoal: 2000, order: 1 },
  { templateKey: 'qa_stood_up', label: 'Stood up',    icon: '🧍', color: '#66BB6A', mode: 'counter',  order: 2 },
  { templateKey: 'qa_face_wash',label: 'Face wash',   icon: '🧼', color: '#80CBC4', mode: 'counter',  order: 3 },
  { templateKey: 'qa_urination',label: 'Urination',   icon: '🚽', color: '#FFF9C4', mode: 'counter',  order: 4 },
  { templateKey: 'qa_bowel',    label: 'Bowel',       icon: '💩', color: '#8D6E63', mode: 'counter',  order: 5 },
  { templateKey: 'qa_medication',label:'Meds taken',  icon: '💊', color: '#CE93D8', mode: 'counter',  order: 6 },
  { templateKey: 'qa_meal',     label: 'Meal',        icon: '🍽️', color: '#A5D6A7', mode: 'counter',  order: 7 },
  { templateKey: 'qa_snack',    label: 'Snack',       icon: '🍎', color: '#EF9A9A', mode: 'counter',  order: 8 },
  { templateKey: 'qa_coffee',   label: 'Coffee / Tea',icon: '☕', color: '#A1887F', mode: 'counter',  order: 9 },
  { templateKey: 'qa_walk',     label: 'Walk',        icon: '🚶', color: '#81C784', mode: 'timer',    order: 10 },
  { templateKey: 'qa_stretch',  label: 'Stretch',     icon: '🧘', color: '#4DB6AC', mode: 'timer',    order: 11 },
  { templateKey: 'qa_nap',      label: 'Nap',         icon: '😴', color: '#9FA8DA', mode: 'timer',    order: 12 },
  { templateKey: 'qa_rest',     label: 'Rest / Lie down', icon: '🛋️', color: '#B0BEC5', mode: 'timer', order: 13 },
  { templateKey: 'qa_hand_wash',label: 'Hand wash',   icon: '🙌', color: '#80DEEA', mode: 'counter',  order: 14 },
  { templateKey: 'qa_shower',   label: 'Shower',      icon: '🚿', color: '#4FC3F7', mode: 'counter',  order: 15 },
  { templateKey: 'qa_sun',      label: 'Sun exposure',icon: '☀️', color: '#FFD54F', mode: 'timer',    order: 16 },
  { templateKey: 'qa_meditation',label:'Meditation',  icon: '😮‍💨', color: '#B2DFDB', mode: 'timer',   order: 17 },
  { templateKey: 'qa_screen_break',label:'Screen break',icon:'📱',color: '#CFD8DC', mode: 'counter',  order: 18 },
  { templateKey: 'qa_alcohol',  label: 'Alcohol',     icon: '🍷', color: '#CE93D8', mode: 'counter', defaultValue: 1, unit: 'glass', order: 19 },
  { templateKey: 'qa_flare',    label: 'Flare now!',  icon: '🔥', color: '#EF5350', mode: 'counter',  order: 20 },
];

// ─────────────────────────────────────────────
//  Condition bundles
// ─────────────────────────────────────────────

export interface ConditionBundle {
  key: string;
  label: string;
  icon: string;
  description: string;
  categoryKeys: string[];
  quickActionKeys: string[];
}

export const CONDITION_BUNDLES: ConditionBundle[] = [
  {
    key: 'lupus',
    label: 'Lupus (SLE)',
    icon: '🦋',
    description: 'Tracks joint pain, rash, fatigue, sun exposure and medications',
    categoryKeys: ['cat_symptoms', 'cat_food', 'cat_habits', 'cat_medications', 'cat_mood'],
    quickActionKeys: ['qa_water', 'qa_stood_up', 'qa_face_wash', 'qa_medication', 'qa_sun', 'qa_flare'],
  },
  {
    key: 'ra',
    label: 'Rheumatoid Arthritis',
    icon: '🦴',
    description: 'Tracks joint pain, stiffness, fatigue, exercise and diet',
    categoryKeys: ['cat_symptoms', 'cat_food', 'cat_habits', 'cat_medications', 'cat_vitals'],
    quickActionKeys: ['qa_water', 'qa_stood_up', 'qa_medication', 'qa_walk', 'qa_stretch', 'qa_flare'],
  },
  {
    key: 'ibd',
    label: 'IBD / Gut (Crohn\'s / UC)',
    icon: '🫁',
    description: 'Tracks digestion, bowel movements, food triggers and stress',
    categoryKeys: ['cat_symptoms', 'cat_food', 'cat_habits', 'cat_body_output', 'cat_medications', 'cat_mood'],
    quickActionKeys: ['qa_water', 'qa_bowel', 'qa_urination', 'qa_medication', 'qa_meal', 'qa_flare'],
  },
  {
    key: 'psoriasis',
    label: 'Psoriasis / Skin',
    icon: '🩹',
    description: 'Tracks skin flares, diet, stress, sun exposure and shower temperature',
    categoryKeys: ['cat_symptoms', 'cat_food', 'cat_habits', 'cat_medications', 'cat_mood'],
    quickActionKeys: ['qa_water', 'qa_shower', 'qa_medication', 'qa_sun', 'qa_flare'],
  },
  {
    key: 'hashimotos',
    label: 'Hashimoto\'s / Thyroid',
    icon: '🦋',
    description: 'Tracks fatigue, temperature, weight, brain fog and diet',
    categoryKeys: ['cat_symptoms', 'cat_food', 'cat_habits', 'cat_medications', 'cat_vitals'],
    quickActionKeys: ['qa_water', 'qa_medication', 'qa_walk', 'qa_coffee', 'qa_flare'],
  },
  {
    key: 'general',
    label: 'General / Other',
    icon: '🌿',
    description: 'A balanced starter for any autoimmune condition',
    categoryKeys: ['cat_symptoms', 'cat_food', 'cat_habits', 'cat_medications'],
    quickActionKeys: ['qa_water', 'qa_stood_up', 'qa_face_wash', 'qa_medication', 'qa_flare'],
  },
];

// ─────────────────────────────────────────────
//  All categories
// ─────────────────────────────────────────────

export const ALL_CATEGORY_TEMPLATES: TemplateCategory[] = [
  categorySymptoms,
  categoryFood,
  categoryHabits,
  categoryMedications,
  categoryBodyOutput,
  categoryMood,
  categoryVitals,
];

export function getCategoryTemplate(key: string): TemplateCategory | undefined {
  return ALL_CATEGORY_TEMPLATES.find(c => c.templateKey === key);
}

export function getBundleCategories(bundleKey: string): TemplateCategory[] {
  const bundle = CONDITION_BUNDLES.find(b => b.key === bundleKey);
  if (!bundle) return [];
  return bundle.categoryKeys.map(k => getCategoryTemplate(k)).filter(Boolean) as TemplateCategory[];
}

export function getBundleQuickActions(bundleKey: string): TemplateQuickAction[] {
  const bundle = CONDITION_BUNDLES.find(b => b.key === bundleKey);
  if (!bundle) return [];
  return bundle.quickActionKeys.map(k => QUICK_ACTION_TEMPLATES.find(qa => qa.templateKey === k)).filter(Boolean) as TemplateQuickAction[];
}
