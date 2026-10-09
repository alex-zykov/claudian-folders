import type { App, TFile, WorkspaceLeaf } from 'obsidian';
import { TFile as ObsidianTFile, WorkspaceLeaf as ObsidianWorkspaceLeaf } from 'obsidian';

import type { ChatFileOpenMode } from '@/core/types';
import { VIEW_TYPE_CLAUDIAN } from '@/core/types';
import { readChatFileId } from '@/features/chat/history-file/HistoryFileWriter';

export interface ChatFileOpenHandlerDeps {
  readonly app: App;
  getMode(): ChatFileOpenMode;
  hasConversation(id: string): boolean;
  /** Shows a conversation that is already open in a chat view; false when no view has it. */
  revealOpenConversation(id: string): Promise<boolean>;
  /** Opens a conversation in the chat view placed by the view-placement setting. */
  openConversationInClaudian(id: string): Promise<void>;
  /** The tab manager of the chat view mounted in `leaf`, or null when it is not a ready chat view. */
  getLeafTabManager(leaf: WorkspaceLeaf): { openConversation(id: string): Promise<void> } | null;
}

type SetViewState = WorkspaceLeaf['setViewState'];

interface PatchedLeafPrototype {
  setViewState: SetViewState;
}

/**
 * Opens `claudian-chat` markdown as its conversation, following the chat-file open mode:
 * inside the chat view where it lives, in the clicked leaf turned into a chat of its own, or
 * as a plain note. A conversation that is already open in a chat view is revealed there
 * instead of being duplicated.
 */
export class ChatFileOpenHandler {
  readonly #deps: ChatFileOpenHandlerDeps;
  #originalSetViewState: SetViewState | null = null;
  #patchedProto: PatchedLeafPrototype | null = null;
  #disposed = false;

  constructor(deps: ChatFileOpenHandlerDeps) {
    this.#deps = deps;
  }

  install(): void {
    if (this.#originalSetViewState || this.#disposed) return;
    const proto = ObsidianWorkspaceLeaf.prototype as unknown as PatchedLeafPrototype | null;
    if (!proto || typeof proto.setViewState !== 'function') return;

    // Keep the unbound method so call(this) uses the WorkspaceLeaf instance.
    const original = proto.setViewState;
    // Prototype patch: Obsidian has no file-open intercept for markdown→chat routing.
    /* eslint-disable @typescript-eslint/no-this-alias -- leaf.prototype patch */
    const handler = this;
    this.#originalSetViewState = original;
    this.#patchedProto = proto;
    proto.setViewState = async function patchedSetViewState(
      this: WorkspaceLeaf,
      state: Parameters<SetViewState>[0],
      ...rest: []
    ) {
      if (handler.#disposed) return original.call(this, state, ...rest);
      const outcome = await handler.#tryRouteChatFile(this, state, original);
      if (outcome === 'close-file-leaf') {
        this.detach();
        return;
      }
      if (outcome === 'handled') return;
      return original.call(this, state, ...rest);
    };
    /* eslint-enable @typescript-eslint/no-this-alias -- end leaf.prototype patch */
  }

  uninstall(): void {
    this.#disposed = true;
    const original = this.#originalSetViewState;
    const proto = this.#patchedProto;
    this.#originalSetViewState = null;
    this.#patchedProto = null;
    if (original && proto) proto.setViewState = original;
  }

  async #tryRouteChatFile(
    leaf: WorkspaceLeaf,
    state: Parameters<SetViewState>[0],
    setViewState: SetViewState,
  ): Promise<'passthrough' | 'handled' | 'close-file-leaf'> {
    if (!state || typeof state !== 'object') return 'passthrough';
    const mode = this.#deps.getMode();
    const record = state as { type?: string; state?: { file?: string } };
    if (record.type !== 'markdown' || mode === 'note') return 'passthrough';
    const path = record.state?.file;
    if (typeof path !== 'string' || path.length === 0) return 'passthrough';
    const file = this.#deps.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof ObsidianTFile) || !this.#isChatFile(file)) return 'passthrough';

    const id = readChatFileId(
      this.#deps.app.metadataCache?.getFileCache?.(file)?.frontmatter,
    );
    // An unknown chat keeps the markdown view so the file stays reachable.
    if (!id || !this.#deps.hasConversation(id)) return 'passthrough';

    try {
      if (await this.#deps.revealOpenConversation(id)) return 'close-file-leaf';
      if (mode === 'in-claudian') {
        await this.#deps.openConversationInClaudian(id);
        return 'close-file-leaf';
      }
      await setViewState.call(leaf, { type: VIEW_TYPE_CLAUDIAN, active: true });
      const manager = this.#deps.getLeafTabManager(leaf);
      if (!manager) throw new Error('Chat view is not ready');
      await manager.openConversation(id);
      return 'handled';
    } catch {
      // The leaf may already be a chat view; put the file back so it stays reachable.
      await setViewState.call(leaf, state);
      return 'handled';
    }
  }

  #isChatFile(file: TFile): boolean {
    if (file.extension.toLocaleLowerCase() !== 'md') return false;
    return this.#deps.app.metadataCache?.getFileCache?.(file)?.frontmatter?.['claudian-chat'] === true;
  }
}
