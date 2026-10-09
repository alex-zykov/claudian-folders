import { testDate } from '@test/helpers/testClock';
import type { App } from 'obsidian';
import { TFile, TFolder } from 'obsidian';

import type { ConversationMeta } from '@/core/types';
import { ChatContextAutoSwitch } from '@/features/chat/history-file/ChatContextAutoSwitch';

function createFile(path: string): TFile {
  const file = new TFile();
  Object.assign(file, {
    path,
    name: path.split('/').pop() ?? path,
    basename: (path.split('/').pop() ?? '').replace(/\.md$/i, ''),
    extension: 'md',
  });
  return file;
}

function createFolder(path: string): TFolder {
  const folder = new TFolder();
  Object.assign(folder, { path, name: path.split('/').pop() ?? path });
  return folder;
}

function meta(id: string, linkedContentPath: string, lastActivityAt: number): ConversationMeta {
  return {
    id,
    providerId: 'claude',
    title: id,
    createdAt: testDate({ days: -1 }).getTime(),
    lastActivityAt,
    messageCount: 1,
    preview: '',
    linkedContentPath,
  };
}

describe('ChatContextAutoSwitch', () => {
  it('opens the best chat on file change and suppresses after a manual switch', async () => {
    const entries = new Map<string, TFile | TFolder>([
      ['Projects/A', createFolder('Projects/A')],
      ['Projects/A/x.md', createFile('Projects/A/x.md')],
      ['Projects/B', createFolder('Projects/B')],
      ['Projects/B/y.md', createFile('Projects/B/y.md')],
    ]);
    const openConversation = jest.fn(async () => undefined);
    let streaming = false;
    let enabled = true;
    const activeId: string | null = null;
    const conversations = [
      meta('chat-a', 'Projects/A/x.md', 20),
      meta('chat-b', 'Projects/B/y.md', 10),
    ];
    const app = {
      vault: {
        getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
      },
      metadataCache: { getFileCache: () => null },
    } as unknown as App;

    const controller = new ChatContextAutoSwitch({
      app,
      isEnabled: () => enabled,
      isActiveTabStreaming: () => streaming,
      getConversationList: () => conversations,
      getActiveConversationId: () => activeId,
      openConversation,
    });

    controller.handleActiveFileChanged(createFile('Projects/A/x.md'));
    expect(openConversation).toHaveBeenCalledWith('chat-a');

    openConversation.mockClear();
    controller.noteManualConversationSwitch();
    controller.handleActiveFileChanged(createFile('Projects/B/y.md'));
    expect(openConversation).not.toHaveBeenCalled();

    controller.handleActiveFileChanged(createFile('Projects/B/y.md'));
    expect(openConversation).toHaveBeenCalledWith('chat-b');

    openConversation.mockClear();
    streaming = true;
    controller.handleActiveFileChanged(createFile('Projects/A/x.md'));
    expect(openConversation).not.toHaveBeenCalled();

    streaming = false;
    enabled = false;
    controller.handleActiveFileChanged(createFile('Projects/A/x.md'));
    expect(openConversation).not.toHaveBeenCalled();
  });
});
