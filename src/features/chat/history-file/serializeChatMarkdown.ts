import { stringifyYaml } from 'obsidian';

import type { ChatFileFrontmatter } from '@/features/chat/history-file/renderChatFile';

export function serializeChatMarkdown(
  frontmatter: ChatFileFrontmatter,
  body: string,
): string {
  const yaml = typeof stringifyYaml === 'function'
    ? stringifyYaml(frontmatter).trimEnd()
    : Object.entries(frontmatter)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join('\n');
  const normalizedBody = body.endsWith('\n') ? body : `${body}\n`;
  return `---\n${yaml}\n---\n${normalizedBody}`;
}
