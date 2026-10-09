import type { Workspace, WorkspaceLeaf } from 'obsidian';

import { SeparateChatTabs } from '@/composition/SeparateChatTabs';
import type { ChatFileOpenMode } from '@/core/types';
import { VIEW_TYPE_CLAUDIAN } from '@/core/types';
import type { ChatViewPlacement } from '@/core/types/settings';

interface FakeView {
  leaf: WorkspaceLeaf;
  getTabManager(): object;
  getActiveTab(): { conversationId: string | null } | null;
  focusActiveInput: jest.Mock;
}

function createView(conversationId: string | null): FakeView {
  return {
    leaf: {} as WorkspaceLeaf,
    getTabManager: () => ({}),
    getActiveTab: () => ({ conversationId }),
    focusActiveInput: jest.fn(),
  };
}

function setup(
  mode: ChatFileOpenMode,
  options: { placement?: ChatViewPlacement; views?: FakeView[] } = {},
) {
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
    tabs: new SeparateChatTabs({
      workspace,
      getMode: () => mode,
      getPlacement: () => options.placement ?? 'main-tab',
      getViews: () => (options.views ?? []) as never,
    }),
    workspace,
  };
}

describe('SeparateChatTabs', () => {
  describe('openNewChat', () => {
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

  describe('openHome', () => {
    it('opens a fresh chat tab instead of activating an existing chat', async () => {
      const bound = createView('c1');
      const { tabs, workspace, leaf } = setup('separate-tab', { views: [bound] });

      await expect(tabs.openHome()).resolves.toBe(true);

      expect(workspace.getLeaf).toHaveBeenCalledWith('tab');
      expect(leaf.setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE_CLAUDIAN, active: true });
      expect(workspace.revealLeaf).not.toHaveBeenCalledWith(bound.leaf);
    });

    it('reuses an existing empty chat tab rather than piling up blank ones', async () => {
      const bound = createView('c1');
      const blank = createView(null);
      const { tabs, workspace } = setup('separate-tab', { views: [bound, blank] });

      await expect(tabs.openHome()).resolves.toBe(true);

      expect(workspace.getLeaf).not.toHaveBeenCalled();
      expect(workspace.revealLeaf).toHaveBeenCalledWith(blank.leaf);
      expect(blank.focusActiveInput).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['in-claudian', 'main-tab'],
      ['note', 'main-tab'],
      ['separate-tab', 'right-sidebar'],
      ['separate-tab', 'left-sidebar'],
    ] as const)('leaves the chat view alone in %s mode with %s placement', async (mode, placement) => {
      const { tabs, workspace } = setup(mode, { placement, views: [createView('c1')] });

      await expect(tabs.openHome()).resolves.toBe(false);

      expect(workspace.getLeaf).not.toHaveBeenCalled();
      expect(workspace.revealLeaf).not.toHaveBeenCalled();
    });
  });
});
