import type { Command, Workspace } from 'obsidian';

import type { ChatViewHost } from '@/features/chat/ChatFeatureHost';
import { createChatTabCommands } from '@/features/chat/workspace/ChatTabCommands';

function setup(openedInSeparateTab: boolean) {
  const view = {
    getTabManager: () => ({}),
    handleNewConversationCommand: jest.fn(async () => false),
    createNewTab: jest.fn(async () => null),
  } as unknown as ChatViewHost;
  const openNewChatInSeparateTab = jest.fn(async () => openedInSeparateTab);
  const commands = createChatTabCommands({
    workspace: { getLeavesOfType: () => [] } as unknown as Pick<Workspace, 'getLeavesOfType'>,
    views: { getView: () => view, activateView: jest.fn(async () => undefined) },
    openNewChatInSeparateTab,
  });
  const newTab = commands.find(command => command.id === 'new-tab') as Required<Pick<Command, 'checkCallback'>>;
  return { newTab, openNewChatInSeparateTab, view };
}

const flush = () => new Promise(resolve => window.setTimeout(resolve, 0));

describe('createChatTabCommands new chat', () => {
  it('opens the new chat in its own tab and skips the view tab when chats use separate tabs', async () => {
    const { newTab, openNewChatInSeparateTab, view } = setup(true);

    expect(newTab.checkCallback(false)).toBe(true);
    await flush();

    expect(openNewChatInSeparateTab).toHaveBeenCalledTimes(1);
    expect(view.createNewTab).not.toHaveBeenCalled();
  });

  it('falls back to a tab inside the chat view otherwise', async () => {
    const { newTab, openNewChatInSeparateTab, view } = setup(false);

    expect(newTab.checkCallback(false)).toBe(true);
    await flush();

    expect(openNewChatInSeparateTab).toHaveBeenCalledTimes(1);
    expect(view.createNewTab).toHaveBeenCalledTimes(1);
  });
});
