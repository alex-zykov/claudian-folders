import type { App, WorkspaceLeaf } from 'obsidian';
import { TFile, WorkspaceLeaf as ObsidianWorkspaceLeaf } from 'obsidian';

import { ChatFileOpenHandler } from '@/features/chat/history-file/ChatFileOpenHandler';

function createFile(path: string): TFile {
  const file = new TFile();
  Object.assign(file, {
    path,
    name: path.split('/').pop() ?? path,
    basename: (path.split('/').pop() ?? '').replace(/\.md$/i, ''),
    extension: 'md',
  });
  return file;
}

describe('ChatFileOpenHandler', () => {
  it('routes chat files to openConversation and leaves markdown for the escape hatch', async () => {
    const chatFile = createFile('Projects/A/Plan.chat.md');
    const note = createFile('Projects/A/x.md');
    const openConversation = jest.fn(async () => undefined);
    const activateView = jest.fn(async () => undefined);
    const original = jest.fn(async () => undefined);
    const detach = jest.fn();

    const leaf = Object.create(ObsidianWorkspaceLeaf.prototype) as WorkspaceLeaf;
    Object.assign(leaf, { detach });
    const previous = ObsidianWorkspaceLeaf.prototype.setViewState;
    ObsidianWorkspaceLeaf.prototype.setViewState = original;

    const app = {
      vault: {
        getAbstractFileByPath: (path: string) => (
          path === chatFile.path ? chatFile : path === note.path ? note : null
        ),
      },
      metadataCache: {
        getFileCache: (file: TFile) => (
          file.path === chatFile.path
            ? { frontmatter: { 'claudian-chat': true, id: 'conv-open-1' } }
            : null
        ),
      },
      workspace: {
        getLeaf: () => leaf,
        getMostRecentLeaf: () => leaf,
        getActiveFile: () => chatFile,
      },
    } as unknown as App;

    const handler = new ChatFileOpenHandler({
      app,
      activateView,
      openConversation,
      hasConversation: () => true,
      isEnabled: () => true,
      findConversationAcrossViews: () => null,
    });
    handler.install();

    await leaf.setViewState({
      type: 'markdown',
      state: { file: chatFile.path },
      active: true,
    });
    expect(activateView).toHaveBeenCalled();
    expect(openConversation).toHaveBeenCalledWith('conv-open-1');
    expect(original).not.toHaveBeenCalled();
    expect(detach).toHaveBeenCalledTimes(1);

    handler.allowNextMarkdownOpen();
    await leaf.setViewState({
      type: 'markdown',
      state: { file: chatFile.path },
      active: true,
    });
    expect(original).toHaveBeenCalledTimes(1);

    handler.uninstall();
    expect(ObsidianWorkspaceLeaf.prototype.setViewState).toBe(original);
    ObsidianWorkspaceLeaf.prototype.setViewState = previous;
  });

  it('forwards ordinary setViewState with the calling leaf as this', async () => {
    const note = createFile('Projects/A/x.md');
    const received: WorkspaceLeaf[] = [];
    const original = jest.fn(async function (this: WorkspaceLeaf) {
      received.push(this);
    });
    const previous = ObsidianWorkspaceLeaf.prototype.setViewState;
    ObsidianWorkspaceLeaf.prototype.setViewState = original;
    const leaf = Object.create(ObsidianWorkspaceLeaf.prototype) as WorkspaceLeaf;
    const app = {
      vault: { getAbstractFileByPath: () => note },
      metadataCache: { getFileCache: () => null },
      workspace: { getLeaf: () => leaf, getMostRecentLeaf: () => leaf, getActiveFile: () => note },
    } as unknown as App;

    const handler = new ChatFileOpenHandler({
      app,
      activateView: jest.fn(async () => undefined),
      openConversation: jest.fn(async () => undefined),
      hasConversation: () => true,
      isEnabled: () => true,
      findConversationAcrossViews: () => null,
    });
    handler.install();
    await leaf.setViewState({ type: 'markdown', state: { file: note.path }, active: true });
    expect(original).toHaveBeenCalled();
    expect(received).toEqual([leaf]);
    handler.uninstall();
    ObsidianWorkspaceLeaf.prototype.setViewState = previous;
  });

  it('does not route ordinary markdown files', async () => {
    const note = createFile('Projects/A/x.md');
    const original = jest.fn(async () => undefined);
    const previous = ObsidianWorkspaceLeaf.prototype.setViewState;
    ObsidianWorkspaceLeaf.prototype.setViewState = original;
    const leaf = Object.create(ObsidianWorkspaceLeaf.prototype) as WorkspaceLeaf;
    const app = {
      vault: { getAbstractFileByPath: () => note },
      metadataCache: { getFileCache: () => null },
      workspace: { getLeaf: () => leaf, getMostRecentLeaf: () => leaf, getActiveFile: () => note },
    } as unknown as App;

    const handler = new ChatFileOpenHandler({
      app,
      activateView: jest.fn(async () => undefined),
      openConversation: jest.fn(async () => undefined),
      hasConversation: () => true,
      isEnabled: () => true,
      findConversationAcrossViews: () => null,
    });
    handler.install();
    await leaf.setViewState({ type: 'markdown', state: { file: note.path }, active: true });
    expect(original).toHaveBeenCalled();
    handler.uninstall();
    ObsidianWorkspaceLeaf.prototype.setViewState = previous;
  });
  it.each([
    ['unknown conversation', { hasConversation: () => false, openConversation: jest.fn(async () => undefined) }],
    ['failed open', {
      hasConversation: () => true,
      openConversation: jest.fn(async () => { throw new Error('open failed'); }),
    }],
  ])('keeps the markdown view when routing fails (%s)', async (_label, deps) => {
    const chatFile = createFile('Projects/A/Plan.chat.md');
    const original = jest.fn(async () => undefined);
    const detach = jest.fn();
    const previous = ObsidianWorkspaceLeaf.prototype.setViewState;
    ObsidianWorkspaceLeaf.prototype.setViewState = original;
    const leaf = Object.create(ObsidianWorkspaceLeaf.prototype) as WorkspaceLeaf;
    Object.assign(leaf, { detach });
    const app = {
      vault: { getAbstractFileByPath: () => chatFile },
      metadataCache: {
        getFileCache: () => ({ frontmatter: { 'claudian-chat': true, id: 'conv-missing' } }),
      },
      workspace: { getLeaf: () => leaf, getMostRecentLeaf: () => leaf, getActiveFile: () => chatFile },
    } as unknown as App;

    const handler = new ChatFileOpenHandler({
      app,
      activateView: jest.fn(async () => undefined),
      findConversationAcrossViews: () => null,
      isEnabled: () => true,
      ...deps,
    });
    handler.install();
    await leaf.setViewState({ type: 'markdown', state: { file: chatFile.path }, active: true });

    expect(original).toHaveBeenCalledTimes(1);
    expect(detach).not.toHaveBeenCalled();
    handler.uninstall();
    ObsidianWorkspaceLeaf.prototype.setViewState = previous;
  });
  it('opens chat files as regular markdown while chat routing is off', async () => {
    const chatFile = createFile('Projects/A/Plan.chat.md');
    const original = jest.fn(async () => undefined);
    const openConversation = jest.fn(async () => undefined);
    const detach = jest.fn();
    const previous = ObsidianWorkspaceLeaf.prototype.setViewState;
    ObsidianWorkspaceLeaf.prototype.setViewState = original;
    const leaf = Object.create(ObsidianWorkspaceLeaf.prototype) as WorkspaceLeaf;
    Object.assign(leaf, { detach });
    const app = {
      vault: { getAbstractFileByPath: () => chatFile },
      metadataCache: {
        getFileCache: () => ({ frontmatter: { 'claudian-chat': true, id: 'conv-1' } }),
      },
      workspace: { getLeaf: () => leaf, getMostRecentLeaf: () => leaf, getActiveFile: () => chatFile },
    } as unknown as App;
    let enabled = false;

    const handler = new ChatFileOpenHandler({
      app,
      activateView: jest.fn(async () => undefined),
      openConversation,
      hasConversation: () => true,
      isEnabled: () => enabled,
      findConversationAcrossViews: () => null,
    });
    handler.install();
    await leaf.setViewState({ type: 'markdown', state: { file: chatFile.path }, active: true });

    expect(original).toHaveBeenCalledTimes(1);
    expect(openConversation).not.toHaveBeenCalled();
    expect(detach).not.toHaveBeenCalled();

    enabled = true;
    await leaf.setViewState({ type: 'markdown', state: { file: chatFile.path }, active: true });
    expect(openConversation).toHaveBeenCalledWith('conv-1');
    expect(original).toHaveBeenCalledTimes(1);
    handler.uninstall();
    ObsidianWorkspaceLeaf.prototype.setViewState = previous;
  });
});
