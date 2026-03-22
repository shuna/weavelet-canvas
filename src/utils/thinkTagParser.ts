/**
 * Stateful parser that extracts `<think>...</think>` blocks from a content
 * stream, splitting them into separate reasoning and content strings.
 *
 * Handles chunk boundaries correctly — a `<think>` or `</think>` tag may be
 * split across two consecutive chunks.
 *
 * Usage:
 *   const parser = new ThinkTagParser();
 *   // for each streamed chunk:
 *   const { content, reasoning } = parser.process(chunk);
 *   // at the end of the stream:
 *   const remaining = parser.flush();
 */
export class ThinkTagParser {
  private state: 'outside' | 'inside' = 'outside';
  private pending = '';

  /**
   * Process a chunk of text. Returns the content and reasoning portions found
   * in this chunk. Either (or both) may be empty strings.
   */
  process(text: string): { content: string; reasoning: string } {
    let content = '';
    let reasoning = '';
    let buffer = this.pending + text;
    this.pending = '';

    while (buffer.length > 0) {
      if (this.state === 'outside') {
        const openIdx = buffer.indexOf('<think>');
        if (openIdx === -1) {
          const partial = this.findPartialTag(buffer, '<think>');
          if (partial > 0) {
            content += buffer.slice(0, buffer.length - partial);
            this.pending = buffer.slice(buffer.length - partial);
          } else {
            content += buffer;
          }
          break;
        } else {
          content += buffer.slice(0, openIdx);
          buffer = buffer.slice(openIdx + 7); // '<think>'.length === 7
          this.state = 'inside';
        }
      } else {
        const closeIdx = buffer.indexOf('</think>');
        if (closeIdx === -1) {
          const partial = this.findPartialTag(buffer, '</think>');
          if (partial > 0) {
            reasoning += buffer.slice(0, buffer.length - partial);
            this.pending = buffer.slice(buffer.length - partial);
          } else {
            reasoning += buffer;
          }
          break;
        } else {
          reasoning += buffer.slice(0, closeIdx);
          buffer = buffer.slice(closeIdx + 8); // '</think>'.length === 8
          this.state = 'outside';
        }
      }
    }

    return { content, reasoning };
  }

  /**
   * Flush any remaining buffered text at the end of the stream.
   * Partial tags are treated as literal text.
   */
  flush(): { content: string; reasoning: string } {
    const remaining = this.pending;
    this.pending = '';
    if (this.state === 'inside') {
      return { content: '', reasoning: remaining };
    }
    return { content: remaining, reasoning: '' };
  }

  /** Check if `buffer` ends with a prefix of `tag` (for partial tag detection). */
  private findPartialTag(buffer: string, tag: string): number {
    const maxLen = Math.min(tag.length - 1, buffer.length);
    for (let len = maxLen; len > 0; len--) {
      if (buffer.endsWith(tag.slice(0, len))) {
        return len;
      }
    }
    return 0;
  }
}
