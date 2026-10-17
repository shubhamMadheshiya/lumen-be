import mongoose from 'mongoose';
import { CommunityTemplate } from '../models/CommunityTemplate';
import { CreateCommunityTemplateSchema } from '../shared';

describe('Community Templates: Validation & Sanitization Schema', () => {
  it('successfully validates a well-formed Community Template payload', () => {
    const validPayload = {
      title: 'Long COVID & POTS Protocol',
      description: 'Comprehensive pacing protocol tracking orthostatic intolerance and brain fog.',
      conditionTags: ['Long COVID', 'POTS', 'Dysautonomia'],
      icon: '🫀',
      color: '#4F46E5',
      isAnonymous: true,
      categories: [
        {
          name: 'Dysautonomia Symptoms',
          icon: '⚡',
          color: '#4F46E5',
          role: 'symptom' as const,
          questions: [
            {
              title: 'What symptoms flared up?',
              helpText: 'Select all that apply',
              selectionType: 'multiple' as const,
              allowOther: true,
              required: true,
              frequency: 'anytime' as const,
              options: [
                {
                  label: 'Brain Fog',
                  icon: '🌫️',
                  allowComment: true,
                  captureTime: 'auto_now' as const,
                  fields: [
                    {
                      key: 'severity',
                      label: 'Severity (0-10)',
                      dataType: 'range',
                      min: 0,
                      max: 10,
                      step: 1,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      quickActions: [
        {
          label: 'Electrolyte Intake',
          icon: '💧',
          color: '#0284C7',
          mode: 'counter' as const,
          defaultValue: 500,
          unit: 'ml',
          dailyGoal: 2500,
        },
      ],
    };

    const parseResult = CreateCommunityTemplateSchema.safeParse(validPayload);
    expect(parseResult.success).toBe(true);
  });

  it('rejects a template missing title or having empty categories', () => {
    const invalidPayload = {
      title: 'Hi', // too short (< 3)
      description: 'Short',
      conditionTags: [], // needs at least 1 tag
      categories: [], // needs at least 1 category
    };

    const parseResult = CreateCommunityTemplateSchema.safeParse(invalidPayload);
    expect(parseResult.success).toBe(false);
  });

  it('validates a Mongoose CommunityTemplate model instance', () => {
    const userId = new mongoose.Types.ObjectId();
    const templateDoc = new CommunityTemplate({
      creatorId: userId,
      creatorDisplayName: 'Lumen Community Member',
      isAnonymous: true,
      title: 'Migraine Protocol',
      description: 'Track sensory triggers and headache intensity.',
      conditionTags: ['Migraine', 'Headache'],
      icon: '⚡',
      color: '#DC2626',
      categories: [
        {
          name: 'Headache',
          icon: '⚡',
          color: '#DC2626',
          role: 'symptom',
          questions: [
            {
              title: 'Pain level',
              selectionType: 'single',
              options: [{ label: 'Mild' }, { label: 'Severe' }],
            },
          ],
        },
      ],
      installCount: 15,
      likesCount: 4,
      isVerified: true,
      status: 'published',
    });

    const err = templateDoc.validateSync();
    expect(err).toBeUndefined();
    expect(templateDoc.title).toBe('Migraine Protocol');
    expect(templateDoc.installCount).toBe(15);
    expect(templateDoc.isVerified).toBe(true);
  });
});
