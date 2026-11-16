import mongoose from 'mongoose';
import { runAssistant } from '../services/llm/assistant/assistant';
import { getProvider } from '../services/llm/assistant/providers';
import { runWriteTool } from '../services/llm/assistant/writeTools';

jest.mock('../services/llm/assistant/providers', () => ({ getProvider: jest.fn() }));
jest.mock('../services/llm/assistant/dataTools', () => ({ runTool: jest.fn(async () => ({ response: {} })), TOOL_DECLARATIONS: [{ name: 'get_notes', description: 'x' }] }));
jest.mock('../services/llm/assistant/writeTools', () => {
  const actual = jest.requireActual('../services/llm/assistant/writeTools');
  return { ...actual, runWriteTool: jest.fn() };
});
jest.mock('../services/llm/assistant/mediaBytes', () => ({ getPhotoForAi: jest.fn() }));
jest.mock('../models/User', () => ({
  User: { findById: jest.fn(() => ({ select: () => ({ lean: async () => ({ name: 'S', conditions: ['RA'], preferences: { timezone: 'Asia/Kolkata' } }) }) })) },
}));

const ME = new mongoose.Types.ObjectId().toString();

function fakeProvider(steps: unknown[]) {
  const session = { next: jest.fn(), addToolResults: jest.fn(), addUserText: jest.fn() };
  for (const s of steps) session.next.mockResolvedValueOnce(s);
  const startSession = jest.fn((_opts: { tools: { name: string }[]; system: string }) => session);
  (getProvider as jest.Mock).mockReturnValue({ startSession });
  return { session, startSession };
}

beforeEach(() => jest.clearAllMocks());

describe('Lumen AI writing tools', () => {
  it('chat gets the note and template tools, and collects what they made as cards', async () => {
    (runWriteTool as jest.Mock).mockResolvedValue({ response: { ok: true }, artifact: { type: 'note', id: 'n1', title: 'RA plan' } });
    const { startSession } = fakeProvider([
      { ok: true, text: '', calls: [{ id: 't1', name: 'create_note', args: { title: 'RA plan', markdown: '- x' } }] },
      { ok: true, text: 'Saved your note.', calls: [] },
    ]);
    const res = await runAssistant({ userId: ME, history: [], message: 'iska note bana do' });
    const opts = startSession.mock.calls[0][0];
    expect(opts.tools.map(t => t.name)).toEqual(expect.arrayContaining(['create_note', 'append_to_note', 'get_tracking_setup', 'propose_log_template']));
    expect(opts.system).toContain('propose_log_template');
    expect(res.artifacts).toEqual([{ type: 'note', id: 'n1', title: 'RA plan' }]);
  });

  it('background runs cannot create anything, even if the model tries', async () => {
    const { startSession, session } = fakeProvider([
      { ok: true, text: '', calls: [{ id: 't1', name: 'create_note', args: { title: 'x', markdown: 'y' } }] },
      { ok: true, text: 'Done.', calls: [] },
    ]);
    const res = await runAssistant({ userId: ME, history: [], message: 'weekly review', allowWrites: false });
    const opts = startSession.mock.calls[0][0];
    expect(opts.tools.map(t => t.name)).not.toContain('create_note');
    expect(opts.tools.map(t => t.name)).toContain('get_tracking_setup');
    expect(opts.system).not.toContain('propose_log_template');
    expect(runWriteTool).not.toHaveBeenCalled();
    expect(session.addToolResults).toHaveBeenCalledWith([expect.objectContaining({ response: { ok: false, error: expect.stringContaining('not available') } })]);
    expect(res.artifacts).toEqual([]);
  });
});
