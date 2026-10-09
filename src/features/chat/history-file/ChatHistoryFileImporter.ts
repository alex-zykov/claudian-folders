import type { App, TAbstractFile, TFile } from 'obsidian';
import { TFile as ObsidianTFile } from 'obsidian';

import {
  DEVICE_SESSIONS_PATH,
  isValidSessionMetadataId,
  SESSIONS_PATH,
} from '@/core/bootstrap/storagePaths';
import type { ProviderId } from '@/core/providers/types';
import type { Conversation } from '@/core/types';
import { readChatFileId } from '@/features/chat/history-file/HistoryFileWriter';

export interface ChatHistoryFileImportRecord {
  id: string;
  providerId: ProviderId;
  title: string;
  createdAt: number;
  lastActivityAt: number;
  sessionId: string | null;
  linkedContentPath?: string;
  forkSessionId?: string;
  forkResumeAt?: string;
}

export interface ChatHistoryFileImporterDeps {
  readonly app: App;
  /** True when any metadata layer (device, flat, other devices) already owns this id. */
  hasAnyMetadata(id: string): Promise<boolean>;
  /** True when a tombstone sidecar exists for this id. */
  hasTombstone(id: string): Promise<boolean>;
  /** Creates device-local metadata for an imported chat file without touching native history. */
  importConversation(record: ChatHistoryFileImportRecord): Promise<Conversation | null>;
}

/**
 * Scans vault markdown for `claudian-chat` frontmatter and creates missing
 * device metadata. Never overwrites existing meta or resurrects tombstones.
 */
export class ChatHistoryFileImporter {
  readonly #deps: ChatHistoryFileImporterDeps;
  #disposed = false;
  #scanTail: Promise<void> = Promise.resolve();

  constructor(deps: ChatHistoryFileImporterDeps) {
    this.#deps = deps;
  }

  scheduleScan(): void {
    if (this.#disposed) return;
    this.#scanTail = this.#scanTail
      .catch(() => undefined)
      .then(() => this.#scan());
  }

  handleFileChanged(file: TAbstractFile): void {
    if (!(file instanceof ObsidianTFile)) return;
    if (file.extension.toLocaleLowerCase() !== 'md') return;
    this.scheduleScan();
  }

  dispose(): void {
    this.#disposed = true;
  }

  async #scan(): Promise<void> {
    if (this.#disposed) return;
    const files = typeof this.#deps.app.vault.getMarkdownFiles === 'function'
      ? this.#deps.app.vault.getMarkdownFiles()
      : [];
    for (const file of files) {
      if (this.#disposed) return;
      await this.#importFile(file);
    }
  }

  async #importFile(file: TFile): Promise<void> {
    const record = readChatFileImportRecord(
      this.#deps.app.metadataCache?.getFileCache?.(file)?.frontmatter,
    );
    if (!record) return;
    if (!isValidSessionMetadataId(record.id)) return;
    if (await this.#deps.hasTombstone(record.id)) return;
    if (await this.#deps.hasAnyMetadata(record.id)) return;
    await this.#deps.importConversation(record);
  }
}

export function readChatFileImportRecord(
  frontmatter: Record<string, unknown> | undefined,
): ChatHistoryFileImportRecord | null {
  if (!frontmatter || frontmatter['claudian-chat'] !== true) return null;
  const id = readChatFileId(frontmatter);
  if (!id) return null;
  if (typeof frontmatter.provider !== 'string' || frontmatter.provider.length === 0) return null;
  if (typeof frontmatter.title !== 'string') return null;

  const createdAt = parseTimestamp(frontmatter.created);
  const lastActivityAt = parseTimestamp(frontmatter.updated) ?? createdAt;
  if (createdAt === undefined || lastActivityAt === undefined) return null;

  return {
    id,
    providerId: frontmatter.provider,
    title: frontmatter.title,
    createdAt,
    lastActivityAt,
    sessionId: typeof frontmatter.sessionId === 'string' ? frontmatter.sessionId : null,
    ...(typeof frontmatter.linked === 'string' ? { linkedContentPath: frontmatter.linked } : {}),
    ...(typeof frontmatter.forkSessionId === 'string'
      ? { forkSessionId: frontmatter.forkSessionId }
      : {}),
    ...(typeof frontmatter.forkResumeAt === 'string'
      ? { forkResumeAt: frontmatter.forkResumeAt }
      : {}),
  };
}

export async function hasSessionTombstone(
  exists: (path: string) => Promise<boolean>,
  listDeviceFolders: () => Promise<readonly string[]>,
  id: string,
): Promise<boolean> {
  if (await exists(`${SESSIONS_PATH}/${id}.deleted.json`)) return true;
  for (const folder of await listDeviceFolders()) {
    if (await exists(`${folder}/${id}.deleted.json`)) return true;
  }
  return false;
}

export async function hasAnySessionMetadata(
  exists: (path: string) => Promise<boolean>,
  listDeviceFolders: () => Promise<readonly string[]>,
  id: string,
): Promise<boolean> {
  if (await exists(`${SESSIONS_PATH}/${id}.meta.json`)) return true;
  for (const folder of await listDeviceFolders()) {
    if (await exists(`${folder}/${id}.meta.json`)) return true;
  }
  return false;
}

export async function listDeviceSessionFolders(
  listFiles: (path: string) => Promise<string[]>,
): Promise<string[]> {
  try {
    const entries = await listFiles(DEVICE_SESSIONS_PATH);
    return entries
      .filter(entry => !entry.includes('.') || !entry.endsWith('.json'))
      .map(entry => (
        entry.startsWith(`${DEVICE_SESSIONS_PATH}/`)
          ? entry
          : `${DEVICE_SESSIONS_PATH}/${entry}`
      ));
  } catch {
    return [];
  }
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
