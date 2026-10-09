import type { App, EventRef } from 'obsidian';

import type { ConversationService } from '@/app/conversations/ConversationService';
import {
  hasAnySessionMetadata,
  hasSessionTombstone,
  listDeviceSessionFolders,
} from '@/app/storage/ChatHistoryFileAdmission';
import type { SharedStorageService } from '@/app/storage/SharedStorageService';
import type { ClaudianSettings } from '@/core/types';
import { ChatFileOpenHandler } from '@/features/chat/history-file/ChatFileOpenHandler';
import { ChatHistoryFileImporter } from '@/features/chat/history-file/ChatHistoryFileImporter';
import { HistoryFileWriter } from '@/features/chat/history-file/HistoryFileWriter';

import type { ClaudianViews } from './ClaudianViews';

export interface ChatHistoryFileSubsystemDeps {
  readonly app: App;
  readonly storage: SharedStorageService;
  readonly conversations: ConversationService;
  readonly views: ClaudianViews;
  isWriteHistoryFileEnabled(): boolean;
}

/**
 * Main-owned wiring for chat history files: writer projection, import admission,
 * and open-on-click routing. Keeps storage-layout policy and settings/delete
 * side effects out of feature modules and out of inline main lambdas.
 */
export class ChatHistoryFileSubsystem {
  readonly writer: HistoryFileWriter;
  readonly importer: ChatHistoryFileImporter;
  readonly openHandler: ChatFileOpenHandler;

  private constructor(
    writer: HistoryFileWriter,
    importer: ChatHistoryFileImporter,
    openHandler: ChatFileOpenHandler,
  ) {
    this.writer = writer;
    this.importer = importer;
    this.openHandler = openHandler;
  }

  static create(deps: ChatHistoryFileSubsystemDeps): ChatHistoryFileSubsystem {
    const writer = new HistoryFileWriter({
      app: deps.app,
      isEnabled: () => deps.isWriteHistoryFileEnabled(),
      getConversation: id => deps.conversations.getCachedConversation(id)
        ?? deps.conversations.getConversationSync(id),
      hydrateConversation: id => deps.conversations.getConversationById(id),
      listConversationMeta: () => deps.conversations.getConversationList(),
    });
    writer.seedFromMetadataCache();

    const adapter = deps.storage.getAdapter();
    const listDeviceFolders = () => listDeviceSessionFolders(path => adapter.listFolders(path));
    const importer = new ChatHistoryFileImporter({
      app: deps.app,
      hasAnyMetadata: async (id) => {
        if (deps.conversations.hasLiveConversation(id)) return true;
        return hasAnySessionMetadata(
          path => adapter.exists(path),
          listDeviceFolders,
          id,
        );
      },
      hasTombstone: async (id) => {
        if (deps.conversations.wasDeletedInSession(id)) return true;
        return hasSessionTombstone(
          path => adapter.exists(path),
          listDeviceFolders,
          id,
        );
      },
      importConversation: record => deps.conversations.importFromHistoryFile(record),
    });

    const openHandler = new ChatFileOpenHandler({
      app: deps.app,
      activateView: () => deps.views.activateView(),
      openConversation: async (id) => {
        await deps.views.activateView();
        const view = deps.views.getView();
        const manager = view?.getTabManager();
        if (manager) await manager.openConversation(id);
      },
      findConversationAcrossViews: id => deps.views.findConversationAcrossViews(id),
    });

    return new ChatHistoryFileSubsystem(writer, importer, openHandler);
  }

  register(
    app: App,
    registerEvent: (eventRef: EventRef) => void,
  ): void {
    this.openHandler.install();
    this.importer.scheduleScan();
    if (typeof app.vault?.on === 'function') {
      registerEvent(app.vault.on('create', file => {
        this.importer.handleFileChanged(file);
      }));
      registerEvent(app.vault.on('modify', file => {
        this.importer.handleFileChanged(file);
      }));
    }
    if (typeof app.metadataCache?.on === 'function') {
      registerEvent(app.metadataCache.on('changed', file => {
        this.importer.handleFileChanged(file);
      }));
    }
  }

  onSettingsCommitted(
    settings: Readonly<ClaudianSettings>,
    previous: Readonly<ClaudianSettings>,
  ): void {
    if (settings.writeHistoryFile && !previous.writeHistoryFile) {
      this.writer.startBackfill();
    } else if (!settings.writeHistoryFile && previous.writeHistoryFile) {
      this.writer.cancelBackfill();
    }
  }

  async onConversationDeleted(
    conversationId: string,
    resetTabs: () => Promise<void>,
  ): Promise<void> {
    try {
      await this.writer.trashForConversation(conversationId);
    } catch {
      // Trash failure must not skip tab reset.
    }
    await resetTabs();
  }

  dispose(): void {
    this.writer.dispose();
    this.importer.dispose();
    this.openHandler.uninstall();
  }
}
