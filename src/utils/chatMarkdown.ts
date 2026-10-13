import { ChatInterface, ContentInterface, isImageContent, isTextContent } from '@type/chat';

export const chatToMarkdown = (chat: ChatInterface): string => {
  let markdown = `# ${chat.title}\n\n`;
  let i = 0;

  while (i < chat.messages.length) {
    let message = chat.messages[i];
    let messageContent = contentToMarkdown(message.content);

    while (hasUnclosedCodeBlock(messageContent) && i + 1 < chat.messages.length && chat.messages[i + 1].role === message.role) {
      i++;
      messageContent += contentToMarkdown(chat.messages[i].content);
    }

    if (hasUnclosedCodeBlock(messageContent)) {
      // Close unclosed code block
      messageContent += '\n```\n';
    }

    markdown += `### **${message.role}**:\n\n${messageContent}---\n\n`;
    i++;
  }

  return markdown;
};

const contentToMarkdown = (contents: ContentInterface[]): string => {
  let text = '';
  contents.forEach((content) => {
    if (content) {
      if (isTextContent(content)) {
        text += content.text;
      } else if (isImageContent(content)) {
        text += `![image](${content.image_url.url})`;
      }
      text += "\n\n";
    }
  });
  return text;
};

export const hasUnclosedCodeBlock = (text: string): boolean => {
  if (!text) {
    return false
  }
  const codeBlockPattern = /```/g;
  const matches = text.match(codeBlockPattern);
  return matches ? matches.length % 2 !== 0 : false;
};

