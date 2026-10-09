import { resolveLinkedFolder } from '@/core/path/ResolveLinkedFolder';
import type { ConversationMeta } from '@/core/types';

export interface ChatFolderMatch {
  readonly id: string;
  readonly folder: string;
  readonly lastActivityAt: number;
}

/**
 * Picks the best chat for an active file: exact linked folder first, then the
 * nearest ancestor folder, then most recent `lastActivityAt`. Archived chats lose.
 */
export function findBestChat(
  filePath: string,
  conversations: readonly ConversationMeta[],
  isFolder: (path: string) => boolean | undefined,
): ChatFolderMatch | null {
  const fileFolder = parentFolder(filePath.replace(/\\/g, '/'));
  let best: ChatFolderMatch | null = null;
  let bestRank = Number.POSITIVE_INFINITY;

  for (const conversation of conversations) {
    if (conversation.isArchived) continue;
    const folder = resolveLinkedFolder(conversation.linkedContentPath, isFolder);
    const rank = folderRank(fileFolder, folder);
    if (rank === null) continue;
    const candidate: ChatFolderMatch = {
      id: conversation.id,
      folder,
      lastActivityAt: conversation.lastActivityAt,
    };
    if (
      !best
      || rank < bestRank
      || (rank === bestRank && candidate.lastActivityAt > best.lastActivityAt)
      || (
        rank === bestRank
        && candidate.lastActivityAt === best.lastActivityAt
        && candidate.id.localeCompare(best.id) < 0
      )
    ) {
      best = candidate;
      bestRank = rank;
    }
  }

  return best;
}

/** 0 = exact folder, 1 = parent, 2 = grandparent, ... */
function folderRank(fileFolder: string, chatFolder: string): number | null {
  if (chatFolder === fileFolder) return 0;
  if (chatFolder === '') {
    // Vault-root chats are ancestors of every file folder.
    return fileFolder === '' ? 0 : fileFolder.split('/').filter(Boolean).length;
  }
  if (fileFolder === chatFolder || fileFolder.startsWith(`${chatFolder}/`)) {
    return fileFolder.slice(chatFolder.length).split('/').filter(Boolean).length;
  }
  return null;
}

function parentFolder(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const separator = normalized.lastIndexOf('/');
  return separator === -1 ? '' : normalized.slice(0, separator);
}
