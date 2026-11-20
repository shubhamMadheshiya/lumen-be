import { cleanGroupAbout, isMutedFor, MAX_GROUP_ABOUT } from '../services/groupExtras';
import { pushText } from '../services/communityPush';

describe('group description and mute', () => {
  it('tidies a description: one line, trimmed, capped', () => {
    expect(cleanGroupAbout('  Care\n\n team   chat ')).toBe('Care team chat');
    expect(cleanGroupAbout('x'.repeat(500))).toHaveLength(MAX_GROUP_ABOUT);
    expect(cleanGroupAbout(undefined)).toBe('');
  });

  it('knows only my own mute choice', () => {
    expect(isMutedFor(['a', 'b'], 'b')).toBe(true);
    expect(isMutedFor(['a'], 'b')).toBe(false);
    expect(isMutedFor(undefined, 'b')).toBe(false);
  });

  it('still titles a group push with the group name', () => {
    expect(pushText('dm', 'Care crew', 'Sam', 'hi', false, false, true).title).toBe('Sam in Care crew');
  });
});
