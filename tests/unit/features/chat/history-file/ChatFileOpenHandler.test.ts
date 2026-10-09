import type { App, WorkspaceLeaf } from 'obsidian';
import { TFile, WorkspaceLeaf as ObsidianWorkspaceLeaf } from 'obsidian';

import type { ChatFileOpenMode } from '@/core/types';
import { VIEW_TYPE_CLAUDIAN } from '@/core/types';
import {
  ChatFileOpenHandler,
  type ChatFileOpenHandlerDeps,
} from '@/features/chat/history-file/ChatFileOpenHandler';

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

const chatFile = createFile('Projects/A/Plan.chat.md');
const note = createFile('Projects/A/x.md');

function markdownState(file: TFile) {
  return { type: 'markdown', state: { file: file.path }, active: true };
}

function setup(mode: ChatFileOpenMode, overrides: Partial<ChatFileOpenHandlerDeps> = {}) {
  const original = jest.fn(async (..._args: unknown[]) => undefined);
  const detach = jest.fn();
  const previous = ObsidianWorkspaceLeaf.prototype.setViewState;
  ObsidianWorkspaceLeaf.prototype.setViewState = original;
  const leaf = Object.create(ObsidianWorkspaceLeaf.prototype) as WorkspaceLeaf;
  Object.assign(leaf, { detach });

  const openInLeaf = jest.fn(async (_id: string) => undefined);
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => (
        path === chatFile.path ? chatFile : path === note.path ? note : null
      ),
    },
    metadataCache: {
      getFileCache: (file: TFile) => (
        file.path === chatFile.path
          ? { frontmatter: { 'claudian-chat': true, id: 'conv-open-1' } }
          : null
      ),
    },
  } as unknown as App;
  const deps: ChatFileOpenHandlerDeps = {
    app,
    getMode: () => mode,
    hasConversation: () => true,
    revealOpenConversation: jest.fn(async () => false),
    openConversationInClaudian: jest.fn(async () => undefined),
    getLeafTabManager: () => ({ openConversation: openInLeaf }),
    ...overrides,
  };
  const handler = new ChatFileOpenHandler(deps);
  handler.install();
  return {
    deps,
    detach,
    handler,
    leaf,
    openInLeaf,
    original,
    restore: () => {
      handler.uninstall();
      ObsidianWorkspaceLeaf.prototype.setViewState = previous;
    },
  };
}

describe('ChatFileOpenHandler', () => {
  describe('in-claudian', () => {
    it('opens the conversation in the placed chat view and closes the file leaf', async () => {
      const { deps, leaf, original, detach, restore } = setup('in-claudian');

      await leaf.setViewState(markdownState(chatFile));

      expect(deps.openConversationInClaudian).toHaveBeenCalledWith('conv-open-1');
      expect(original).not.toHaveBeenCalled();
      expect(detach).toHaveBeenCalledTimes(1);
      restore();
    });

    it('reveals a conversation that is already open instead of opening it again', async () => {
      const { deps, leaf, original, detach, restore } = setup('in-claudian', {
        revealOpenConversation: jest.fn(async () => true),
      });

      await leaf.setViewState(markdownState(chatFile));

      expect(deps.revealOpenConversation).toHaveBeenCalledWith('conv-open-1');
      expect(deps.openConversationInClaudian).not.toHaveBeenCalled();
      expect(original).not.toHaveBeenCalled();
      expect(detach).toHaveBeenCalledTimes(1);
      restore();
    });

    it('keeps the markdown view when opening the conversation fails', async () => {
      const { leaf, original, detach, restore } = setup('in-claudian', {
        openConversationInClaudian: jest.fn(async () => { throw new Error('open failed'); }),
      });

      await leaf.setViewState(markdownState(chatFile));

      expect(original).toHaveBeenCalledTimes(1);
      expect(original).toHaveBeenCalledWith(markdownState(chatFile));
      expect(detach).not.toHaveBeenCalled();
      restore();
    });
  });

  describe('separate-tab', () => {
    it('turns the clicked file leaf into the chat view and opens the conversation there', async () => {
      const { deps, leaf, original, openInLeaf, detach, restore } = setup('separate-tab');

      await leaf.setViewState(markdownState(chatFile));

      expect(original).toHaveBeenCalledTimes(1);
      expect(original).toHaveBeenCalledWith({ type: VIEW_TYPE_CLAUDIAN, active: true });
      expect(original.mock.contexts[0]).toBe(leaf);
      expect(openInLeaf).toHaveBeenCalledWith('conv-open-1');
      expect(deps.openConversationInClaudian).not.toHaveBeenCalled();
      expect(detach).not.toHaveBeenCalled();
      restore();
    });

    it('reveals a conversation that is already open and closes the file leaf', async () => {
      const { leaf, original, openInLeaf, detach, restore } = setup('separate-tab', {
        revealOpenConversation: jest.fn(async () => true),
      });

      await leaf.setViewState(markdownState(chatFile));

      expect(openInLeaf).not.toHaveBeenCalled();
      expect(original).not.toHaveBeenCalled();
      expect(detach).toHaveBeenCalledTimes(1);
      restore();
    });

    it('restores the markdown view when the chat view cannot open the conversation', async () => {
      const { leaf, original, detach, restore } = setup('separate-tab', {
        getLeafTabManager: () => null,
      });

      await leaf.setViewState(markdownState(chatFile));

      expect(original).toHaveBeenCalledTimes(2);
      expect(original).toHaveBeenNthCalledWith(1, { type: VIEW_TYPE_CLAUDIAN, active: true });
      expect(original).toHaveBeenNthCalledWith(2, markdownState(chatFile));
      expect(detach).not.toHaveBeenCalled();
      restore();
    });
  });

  it.each([
    ['note mode', 'note' as const, {}],
    ['an unknown conversation', 'in-claudian' as const, { hasConversation: (): boolean => false }],
    ['an unknown conversation in a separate tab', 'separate-tab' as const, { hasConversation: (): boolean => false }],
  ])('keeps the markdown view for %s', async (_label, mode, overrides) => {
    const { deps, leaf, original, openInLeaf, detach, restore } = setup(mode, overrides);

    await leaf.setViewState(markdownState(chatFile));

    expect(original).toHaveBeenCalledTimes(1);
    expect(original).toHaveBeenCalledWith(markdownState(chatFile));
    expect(openInLeaf).not.toHaveBeenCalled();
    expect(deps.openConversationInClaudian).not.toHaveBeenCalled();
    expect(detach).not.toHaveBeenCalled();
    restore();
  });

  it('forwards ordinary setViewState with the calling leaf as this', async () => {
    const { leaf, original, openInLeaf, restore } = setup('separate-tab');

    await leaf.setViewState(markdownState(note));

    expect(original).toHaveBeenCalledWith(markdownState(note));
    expect(original.mock.contexts[0]).toBe(leaf);
    expect(openInLeaf).not.toHaveBeenCalled();
    restore();
  });

  it('restores the original setViewState on uninstall', () => {
    const { handler, original, restore } = setup('in-claudian');
    expect(ObsidianWorkspaceLeaf.prototype.setViewState).not.toBe(original);
    handler.uninstall();
    expect(ObsidianWorkspaceLeaf.prototype.setViewState).toBe(original);
    restore();
  });
});
