import { testDate } from '@test/helpers/testClock';

import type { ConversationMeta } from '@/core/types';
import { findBestChat } from '@/features/chat/history-file/ChatFolderIndex';

function meta(
  id: string,
  linkedContentPath: string | undefined,
  lastActivityAt: number,
  overrides: Partial<ConversationMeta> = {},
): ConversationMeta {
  return {
    id,
    providerId: 'claude',
    title: id,
    createdAt: testDate({ days: -2 }).getTime(),
    lastActivityAt,
    messageCount: 1,
    preview: '',
    linkedContentPath,
    ...overrides,
  };
}

describe('findBestChat', () => {
  const folders = new Set(['Projects/A', 'Projects', 'Projects/B', 'Projects/B/notes']);
  const isFolder = (path: string): boolean | undefined => {
    if (folders.has(path)) return true;
    if (path.endsWith('.md')) return false;
    return undefined;
  };

  it('prefers an exact folder match over an ancestor', () => {
    const exact = meta('exact', 'Projects/A/x.md', 10);
    const ancestor = meta('ancestor', 'Projects', 100);
    expect(findBestChat('Projects/A/note.md', [ancestor, exact], isFolder)?.id).toBe('exact');
  });

  it('breaks ties by most recent activity', () => {
    const older = meta('older', 'Projects/A/a.md', 10);
    const newer = meta('newer', 'Projects/A/b.md', 20);
    expect(findBestChat('Projects/A/c.md', [older, newer], isFolder)?.id).toBe('newer');
  });

  it('ignores archived conversations', () => {
    const archived = meta('archived', 'Projects/A/a.md', 100, { isArchived: true });
    const live = meta('live', 'Projects/A/b.md', 10);
    expect(findBestChat('Projects/A/c.md', [archived, live], isFolder)?.id).toBe('live');
  });

  it('returns null when no chat matches without creating one', () => {
    expect(findBestChat('Other/z.md', [meta('a', 'Projects/A/x.md', 10)], isFolder)).toBeNull();
  });

  it('uses the nearest ancestor when no exact folder exists', () => {
    const rootish = meta('rootish', 'Projects', 10);
    const deeper = meta('deeper', 'Projects/B/notes/y.md', 5);
    expect(findBestChat('Projects/B/notes/extra/z.md', [rootish, deeper], isFolder)?.id)
      .toBe('deeper');
  });
});
