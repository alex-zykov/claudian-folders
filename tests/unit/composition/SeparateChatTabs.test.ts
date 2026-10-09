import type { Workspace, WorkspaceLeaf } from 'obsidian';

import { SeparateChatTabs } from '@/composition/SeparateChatTabs';
import type { ChatFileOpenMode } from '@/core/types';
import { VIEW_TYPE_CLAUDIAN } from '@/core/types';

function setup(mode: ChatFileOpenMode) {
  const focusActiveInput = jest.fn();
  const leaf = {
    view: { getTabManager: () => ({}), focusActiveInput },
    setViewState: jest.fn(async () => undefined),
  } as unknown as WorkspaceLeaf;
  const workspace = {
    getLeaf: jest.fn(() => leaf),
    revealLeaf: jest.fn(async () => undefined),
  } as unknown as Workspace;
  return {
    focusActiveInput,
    leaf,
    tabs: new SeparateChatTabs({ workspace, getMode: () => mode }),
    workspace,
  };
}

describe('SeparateChatTabs', () => {
  it('opens a new chat in its own active tab when chats open in separate tabs', async () => {
    const { tabs, workspace, leaf, focusActiveInput } = setup('separate-tab');

    await expect(tabs.openNewChat()).resolves.toBe(true);

    expect(workspace.getLeaf).toHaveBeenCalledWith('tab');
    expect(leaf.setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE_CLAUDIAN, active: true });
    expect(workspace.revealLeaf).toHaveBeenCalledWith(leaf);
    expect(focusActiveInput).toHaveBeenCalledTimes(1);
  });

  it.each(['in-claudian', 'note'] as const)('leaves new chats to the chat view in %s mode', async (mode) => {
    const { tabs, workspace, leaf } = setup(mode);

    await expect(tabs.openNewChat()).resolves.toBe(false);

    expect(workspace.getLeaf).not.toHaveBeenCalled();
    expect(leaf.setViewState).not.toHaveBeenCalled();
  });
});
