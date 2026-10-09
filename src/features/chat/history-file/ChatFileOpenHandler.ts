import type { App, TFile, WorkspaceLeaf } from 'obsidian';
import { TFile as ObsidianTFile, WorkspaceLeaf as ObsidianWorkspaceLeaf } from 'obsidian';

import { readChatFileId } from '@/features/chat/history-file/HistoryFileWriter';

export interface ChatFileOpenHandlerDeps {
  readonly app: App;
  activateView(): Promise<void>;
  openConversation(id: string): Promise<void>;
  findConversationAcrossViews(
    conversationId: string,
  ): { view: { getTabManager(): { openConversation(id: string): Promise<void> } | null } } | null;
}

type SetViewState = WorkspaceLeaf['setViewState'];

interface PatchedLeafPrototype {
  setViewState: SetViewState;
}

/**
 * Routes Obsidian open of `claudian-chat` markdown into the Claudian chat view.
 * Escape hatch: command sets a one-shot flag so markdown opens normally.
 */
export class ChatFileOpenHandler {
  readonly #deps: ChatFileOpenHandlerDeps;
  #originalSetViewState: SetViewState | null = null;
  #patchedProto: PatchedLeafPrototype | null = null;
  #openAsMarkdownOnce = false;
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
      if (handler.#disposed || handler.#openAsMarkdownOnce) {
        handler.#openAsMarkdownOnce = false;
        return original.call(this, state, ...rest);
      }
      if (await handler.#tryRouteChatFile(state)) {
        this.detach();
        return;
      }
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

  /** One-shot escape hatch used by the "Open chat file as markdown" command. */
  allowNextMarkdownOpen(): void {
    this.#openAsMarkdownOnce = true;
  }

  async openActiveChatFileAsMarkdown(): Promise<void> {
    const file = this.#deps.app.workspace.getActiveFile();
    if (!file || !this.#isChatFile(file)) return;
    this.allowNextMarkdownOpen();
    const leaf = this.#deps.app.workspace.getMostRecentLeaf()
      ?? this.#deps.app.workspace.getLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({
      type: 'markdown',
      state: { file: file.path },
      active: true,
    });
  }

  async #tryRouteChatFile(
    state: Parameters<SetViewState>[0],
  ): Promise<boolean> {
    if (!state || typeof state !== 'object') return false;
    const record = state as { type?: string; state?: { file?: string } };
    if (record.type !== 'markdown') return false;
    const path = record.state?.file;
    if (typeof path !== 'string' || path.length === 0) return false;
    const file = this.#deps.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof ObsidianTFile) || !this.#isChatFile(file)) return false;

    const id = readChatFileId(
      this.#deps.app.metadataCache?.getFileCache?.(file)?.frontmatter,
    );
    if (!id) return false;

    await this.#deps.activateView();
    const existing = this.#deps.findConversationAcrossViews(id);
    if (existing) {
      const manager = existing.view.getTabManager();
      if (manager) {
        await manager.openConversation(id);
        return true;
      }
    }
    await this.#deps.openConversation(id);
    return true;
  }

  #isChatFile(file: TFile): boolean {
    if (file.extension.toLocaleLowerCase() !== 'md') return false;
    return this.#deps.app.metadataCache?.getFileCache?.(file)?.frontmatter?.['claudian-chat'] === true;
  }
}
