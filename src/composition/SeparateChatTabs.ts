import type { Workspace } from 'obsidian';

import type { ChatFileOpenMode } from '@/core/types';
import { VIEW_TYPE_CLAUDIAN } from '@/core/types';
import { revealWorkspaceLeaf } from '@/utils/obsidianCompat';

import { isClaudianView } from './ClaudianViews';

export interface SeparateChatTabsDeps {
  readonly workspace: Pick<Workspace, 'getLeaf' | 'revealLeaf'>;
  getMode(): ChatFileOpenMode;
}

/** Gives each chat its own workspace tab when chat files open in separate tabs. */
export class SeparateChatTabs {
  constructor(private readonly deps: SeparateChatTabsDeps) {}

  /** Opens a new chat in an active tab of its own; false when chats do not use separate tabs. */
  async openNewChat(): Promise<boolean> {
    if (this.deps.getMode() !== 'separate-tab') return false;
    const { workspace } = this.deps;
    const leaf = workspace.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE_CLAUDIAN, active: true });
    await revealWorkspaceLeaf(workspace as Workspace, leaf);
    if (isClaudianView(leaf.view)) leaf.view.focusActiveInput();
    return true;
  }
}
