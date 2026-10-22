import mongoose from 'mongoose';
import { Note } from '../models/Note';
import { CreateNoteSchema, UpdateNoteSchema, NoteBlockSchema } from '../shared/schemas';
import { HEALTH_NOTE_TEMPLATES } from '../routes/notes';

describe('Server Models & Schemas: Notion-Style Health Notes', () => {
  it('validates a complete block structure with headings, checklists, callouts, and toggles', () => {
    const validBlockPayload = {
      id: 'b1',
      type: 'callout' as const,
      content: 'Critical pacing reminder',
      calloutIcon: '⚠️',
      calloutColor: '#EF4444',
    };

    const parsed = NoteBlockSchema.safeParse(validBlockPayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.type).toBe('callout');
      expect(parsed.data.calloutIcon).toBe('⚠️');
    }
  });

  it('validates a full CreateNoteSchema payload with health linkages', () => {
    const validNote = {
      title: 'Neurologist Consultation & Tilt Table Review',
      icon: '🩺',
      coverGradient: 'linear-gradient(135deg, #0F172A 0%, #0369A1 100%)',
      isPinned: true,
      tags: ['Neurology', 'Dysautonomia', 'POTS'],
      linkedSymptomIds: ['symptom_dizziness', 'symptom_tachycardia'],
      linkedMedicationIds: ['med_fludrocortisone'],
      blocks: [
        {
          id: 'b1',
          type: 'heading_1' as const,
          content: 'Chief Concerns',
        },
        {
          id: 'b2',
          type: 'bullet_list' as const,
          content: 'Sustained heart rate spike > 35 bpm on standing',
        },
        {
          id: 'b3',
          type: 'todo' as const,
          content: 'Request autonomic reflex screening referral',
          completed: false,
        },
      ],
    };

    const parsed = CreateNoteSchema.safeParse(validNote);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.title).toBe(validNote.title);
      expect(parsed.data.linkedSymptomIds).toHaveLength(2);
      expect(parsed.data.blocks).toHaveLength(3);
    }
  });

  it('validates a complete Note Mongoose model instance with nested sub-page parent ID', () => {
    const userId = new mongoose.Types.ObjectId();
    const parentId = new mongoose.Types.ObjectId();

    const note = new Note({
      userId,
      parentNoteId: parentId,
      title: 'Sub-page: Blood Pressure Logs',
      icon: '📊',
      blocks: [
        { id: 'sb_1', type: 'paragraph', content: 'Morning resting: 105/68, HR 64' },
        { id: 'sb_2', type: 'paragraph', content: 'Standing 3 min: 98/62, HR 108' },
      ],
      isPinned: false,
      isArchived: false,
      tags: ['Vitals', 'Telemetry'],
    });

    const err = note.validateSync();
    expect(err).toBeUndefined();
    expect(note.title).toBe('Sub-page: Blood Pressure Logs');
    expect(note.parentNoteId?.toString()).toBe(parentId.toString());
  });

  it('provides well-formed clinical templates (Doctor Visit, Flare, Medication)', () => {
    expect(HEALTH_NOTE_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    const doctorTemplate = HEALTH_NOTE_TEMPLATES.find((t) => t.key === 'doctor_visit_prep');
    expect(doctorTemplate).toBeDefined();
    expect(doctorTemplate?.blocks.length).toBeGreaterThan(5);
    expect(doctorTemplate?.tags).toContain('Doctor Visit');
  });
});
