import type { App, TFile } from 'obsidian';

import type { ConversationMeta } from '@/core/types';
import { findBestChat } from '@/features/chat/history-file/ChatFolderIndex';
import { createVaultLinkedContentIsFolder } from '@/features/chat/linked-content/LinkedContentPresentation';

export interface ChatContextAutoSwitchDeps {
  readonly app: App;
  isEnabled: () => boolean;
  isActiveTabStreaming: () => boolean;
  getConversationList: () => readonly ConversationMeta[];
  getActiveConversationId: () => string | null;
  openConversation: (id: string) => Promise<void>;
}

/**
 * Opens the best folder-bound chat when the active note changes, without
 * creating chats. Manual conversation switches suppress the next file change.
 */
export class ChatContextAutoSwitch {
  readonly #deps: ChatContextAutoSwitchDeps;
  readonly #isFolder: (path: string) => boolean | undefined;
  #manualSwitchSinceFileChange = false;

  constructor(deps: ChatContextAutoSwitchDeps) {
    this.#deps = deps;
    this.#isFolder = createVaultLinkedContentIsFolder(deps.app);
  }

  /** Call when the user explicitly opens/switches a conversation. */
  noteManualConversationSwitch(): void {
    this.#manualSwitchSinceFileChange = true;
  }

  handleActiveFileChanged(file: TFile | null): void {
    const suppressed = this.#manualSwitchSinceFileChange;
    this.#manualSwitchSinceFileChange = false;
    if (!file || !this.#deps.isEnabled()) return;
    if (suppressed) return;
    if (this.#deps.isActiveTabStreaming()) return;
    if (file.extension.toLocaleLowerCase() !== 'md') return;
    if (this.#deps.app.metadataCache?.getFileCache?.(file)?.frontmatter?.['claudian-chat'] === true) {
      return;
    }

    const match = findBestChat(
      file.path,
      this.#deps.getConversationList(),
      this.#isFolder,
    );
    if (!match) return;
    if (match.id === this.#deps.getActiveConversationId()) return;
    void this.#deps.openConversation(match.id);
  }
}
