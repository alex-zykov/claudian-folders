import '@/providers';

import { testDate } from '@test/helpers/testClock';
import type { App } from 'obsidian';
import { TFile, TFolder } from 'obsidian';

import type { ChatMessage, Conversation, ConversationMeta } from '@/core/types';
import { HistoryFileWriter } from '@/features/chat/history-file/HistoryFileWriter';

const CREATED_AT = testDate({ hours: -2 }).getTime();
const UPDATED_AT = testDate({ hours: -1 }).getTime();

function createFile(path: string, content = ''): TFile {
  const file = new TFile();
  const name = path.split('/').pop() ?? path;
  Object.assign(file, {
    path,
    name,
    basename: name.replace(/\.md$/i, ''),
    extension: 'md',
  });
  (file as TFile & { __content?: string }).__content = content;
  return file;
}

function createFolder(path: string): TFolder {
  const folder = new TFolder();
  Object.assign(folder, { path, name: path.split('/').pop() ?? path });
  return folder;
}

function user(content: string): ChatMessage {
  return {
    id: `u-${content}`,
    role: 'user',
    content,
    timestamp: CREATED_AT,
  };
}

function assistant(content: string): ChatMessage {
  return {
    id: `a-${content}`,
    role: 'assistant',
    content,
    contentBlocks: [{ type: 'text', content }],
    timestamp: CREATED_AT,
    completedAt: UPDATED_AT,
  };
}

function createConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    providerId: 'claude',
    title: 'Plan review',
    createdAt: CREATED_AT,
    lastActivityAt: UPDATED_AT,
    sessionId: 'session-1',
    linkedContentPath: 'Projects/A/x.md',
    messages: [user('hello'), assistant('world')],
    ...overrides,
  };
}

function createVaultHarness(initial: Array<TFile | TFolder> = []) {
  const entries = new Map<string, TFile | TFolder>(initial.map(entry => [entry.path, entry]));
  const frontmatterByPath = new Map<string, Record<string, unknown>>();
  const contents = new Map<string, string>();
  for (const entry of initial) {
    if (entry instanceof TFile) {
      contents.set(entry.path, (entry as TFile & { __content?: string }).__content ?? '');
    }
  }

  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
      getMarkdownFiles: () => [...entries.values()].filter((entry): entry is TFile => entry instanceof TFile),
      create: jest.fn(async (path: string, data: string) => {
        const file = createFile(path, data);
        entries.set(path, file);
        contents.set(path, data);
        const idMatch = data.match(/^id:\s*["']?([^"'\n]+)/m)
          ?? data.match(/\nid:\s*["']?([^"'\n]+)/);
        // Prefer YAML id from frontmatter block.
        const fmMatch = data.match(/^---\n([\s\S]*?)\n---/);
        if (fmMatch) {
          const idLine = fmMatch[1].match(/^id:\s*(.+)$/m);
          if (idLine) {
            const id = JSON.parse(idLine[1].startsWith('"') ? idLine[1] : `"${idLine[1]}"`) as string;
            frontmatterByPath.set(path, { 'claudian-chat': true, id });
          }
        } else if (idMatch) {
          frontmatterByPath.set(path, { 'claudian-chat': true, id: idMatch[1] });
        }
        return file;
      }),
      createFolder: jest.fn(async (path: string) => {
        const folder = createFolder(path);
        entries.set(path, folder);
        return folder;
      }),
      process: jest.fn(async (file: TFile, fn: (data: string) => string) => {
        const next = fn(contents.get(file.path) ?? '');
        contents.set(file.path, next);
      }),
    },
    fileManager: {
      processFrontMatter: jest.fn(async (file: TFile, fn: (fm: Record<string, unknown>) => void) => {
        const fm = { ...(frontmatterByPath.get(file.path) ?? {}) };
        fn(fm);
        frontmatterByPath.set(file.path, fm);
        const body = (contents.get(file.path) ?? '').replace(/^---\n[\s\S]*?\n---\n?/, '');
        const yaml = Object.entries(fm)
          .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
          .join('\n');
        contents.set(file.path, `---\n${yaml}\n---\n${body}`);
      }),
      renameFile: jest.fn(async (file: TFile, newPath: string) => {
        entries.delete(file.path);
        contents.set(newPath, contents.get(file.path) ?? '');
        contents.delete(file.path);
        const fm = frontmatterByPath.get(file.path);
        frontmatterByPath.delete(file.path);
        if (fm) frontmatterByPath.set(newPath, fm);
        Object.assign(file, {
          path: newPath,
          name: newPath.split('/').pop() ?? newPath,
          basename: (newPath.split('/').pop() ?? '').replace(/\.md$/i, ''),
        });
        entries.set(newPath, file);
      }),
      trashFile: jest.fn(async (file: TFile) => {
        entries.delete(file.path);
        contents.delete(file.path);
        frontmatterByPath.delete(file.path);
      }),
    },
    metadataCache: {
      getFileCache: (file: TFile) => {
        const fm = frontmatterByPath.get(file.path);
        return fm ? { frontmatter: fm } : null;
      },
    },
  } as unknown as App;

  return { app, entries, contents, frontmatterByPath };
}

describe('HistoryFileWriter', () => {
  it('writes a chat file once per turn and rewrites the body on the next turn', async () => {
    const folder = createFolder('Projects/A');
    const note = createFile('Projects/A/x.md');
    const harness = createVaultHarness([folder, note]);
    let conversation = createConversation();
    const enabled = true;
    const writer = new HistoryFileWriter({
      app: harness.app,
      isEnabled: () => enabled,
      getConversation: (id) => (id === conversation.id ? conversation : null),
      hydrateConversation: async (id) => (id === conversation.id ? conversation : null),
      listConversationMeta: () => [],
    });

    writer.scheduleWrite(conversation.id);
    await Promise.resolve();
    await Promise.resolve();
    await flushQueues();

    expect(harness.app.vault.create).toHaveBeenCalledTimes(1);
    const createdPath = 'Projects/A/Plan review.chat.md';
    expect(harness.contents.has(createdPath)).toBe(true);
    expect(harness.contents.get(createdPath)).toContain('hello');
    expect(harness.contents.get(createdPath)).toContain('world');
    expect(harness.frontmatterByPath.get(createdPath)?.id).toBe(conversation.id);

    conversation = createConversation({
      messages: [user('hello'), assistant('world'), user('again'), assistant('updated')],
      lastActivityAt: UPDATED_AT + 1,
    });
    writer.scheduleWrite(conversation.id);
    await flushQueues();

    expect(harness.app.vault.create).toHaveBeenCalledTimes(1);
    expect(harness.app.fileManager.processFrontMatter).toHaveBeenCalled();
    expect(harness.app.vault.process).toHaveBeenCalled();
    expect(harness.contents.get(createdPath)).toContain('updated');
    expect(harness.frontmatterByPath.get(createdPath)?.id).toBe(conversation.id);
  });

  it('keeps writing to a user-renamed path and recreates after delete only on the next turn', async () => {
    const harness = createVaultHarness([createFolder('Projects/A'), createFile('Projects/A/x.md')]);
    const conversation = createConversation();
    const writer = new HistoryFileWriter({
      app: harness.app,
      isEnabled: () => true,
      getConversation: () => conversation,
      hydrateConversation: async () => conversation,
      listConversationMeta: () => [],
    });

    writer.scheduleWrite(conversation.id);
    await flushQueues();
    const original = 'Projects/A/Plan review.chat.md';
    const moved = 'Projects/A/Renamed.chat.md';
    const file = harness.entries.get(original) as TFile;
    await harness.app.fileManager.renameFile(file, moved);
    writer.handleVaultRename(file, original);

    writer.scheduleWrite(conversation.id);
    await flushQueues();
    expect(harness.app.vault.create).toHaveBeenCalledTimes(1);
    expect(harness.contents.has(moved)).toBe(true);

    await harness.app.fileManager.trashFile(file);
    writer.handleVaultDelete(file);
    expect(harness.contents.has(moved)).toBe(false);

    writer.scheduleWrite(conversation.id);
    await flushQueues();
    expect(harness.app.vault.create).toHaveBeenCalledTimes(2);
  });

  it('writes nothing when the setting is off', async () => {
    const harness = createVaultHarness([createFolder('Projects/A'), createFile('Projects/A/x.md')]);
    const conversation = createConversation();
    const writer = new HistoryFileWriter({
      app: harness.app,
      isEnabled: () => false,
      getConversation: () => conversation,
      hydrateConversation: async () => conversation,
      listConversationMeta: () => [],
    });
    writer.scheduleWrite(conversation.id);
    await flushQueues();
    expect(harness.app.vault.create).not.toHaveBeenCalled();
  });

  it('backfills existing capable chats when started', async () => {
    const harness = createVaultHarness([createFolder('Projects/A'), createFile('Projects/A/x.md')]);
    const conversation = createConversation();
    const meta: ConversationMeta = {
      id: conversation.id,
      providerId: 'claude',
      title: conversation.title,
      createdAt: conversation.createdAt,
      lastActivityAt: conversation.lastActivityAt,
      messageCount: 2,
      preview: 'hello',
      linkedContentPath: conversation.linkedContentPath,
    };
    const writer = new HistoryFileWriter({
      app: harness.app,
      isEnabled: () => true,
      getConversation: () => conversation,
      hydrateConversation: async () => conversation,
      listConversationMeta: () => [meta],
    });

    writer.startBackfill();
    await flushQueues();
    await new Promise(resolve => window.setTimeout(resolve, 40));
    await flushQueues();
    expect(harness.app.vault.create).toHaveBeenCalled();
  });

  it('serializes overlapping writes for one conversation', async () => {
    const harness = createVaultHarness([createFolder('Projects/A'), createFile('Projects/A/x.md')]);
    let conversation = createConversation();
    const writer = new HistoryFileWriter({
      app: harness.app,
      isEnabled: () => true,
      getConversation: () => conversation,
      hydrateConversation: async () => conversation,
      listConversationMeta: () => [],
    });

    writer.scheduleWrite(conversation.id);
    conversation = createConversation({
      messages: [user('hello'), assistant('second')],
    });
    writer.scheduleWrite(conversation.id);
    await flushQueues();
    expect(harness.app.vault.create).toHaveBeenCalledTimes(1);
    expect(harness.contents.get('Projects/A/Plan review.chat.md')).toContain('second');
  });

  it('trashes the chat markdown when deleting a conversation', async () => {
    const harness = createVaultHarness([createFolder('Projects/A'), createFile('Projects/A/x.md')]);
    const conversation = createConversation();
    const writer = new HistoryFileWriter({
      app: harness.app,
      isEnabled: () => true,
      getConversation: () => conversation,
      hydrateConversation: async () => conversation,
      listConversationMeta: () => [],
    });
    writer.scheduleWrite(conversation.id);
    await flushQueues();
    await writer.trashForConversation(conversation.id);
    expect(harness.app.fileManager.trashFile).toHaveBeenCalled();
    expect(harness.contents.has('Projects/A/Plan review.chat.md')).toBe(false);
  });
});

async function flushQueues(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}
