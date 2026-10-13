import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import MarkdownRenderer from '../components/Chat/ChatContent/Message/View/MarkdownRenderer';
import { preprocessLaTeX } from './markdown';
const render = (content: string) => renderToStaticMarkup(React.createElement(MarkdownRenderer, {content, inlineLatex: true}));
describe('shared actual Markdown renderer', () => {
  it('uses actual GFM table, KaTeX and highlighted code', () => {
    const html = render('| A | B |\n| - | - |\n| 1 | 2 |\n\n\\(x^2\\)\n\n```js\nconst n=1;\n```');
    expect(html).toContain('<table>'); expect(html).toContain('katex');
    expect(html).toContain('hljs-keyword'); expect(html).toContain('copy codeblock');
  });
  it('keeps strings as text and applies existing URL sanitization', () => {
    const html = render('<script>alert(1)</script>\n\n[danger](javascript:alert)\n\n```text\n</script> ${secret} \\ ";\n```');
    expect(html).not.toContain('<script>'); expect(html).not.toContain('href="javascript:alert"');
    expect(html).toContain('&lt;/script&gt;'); expect(html).toContain('${secret}');
    expect(render('[safe](https://example.test/path)')).toContain('href="https://example.test/path"');
  });
  it('keeps the existing LaTeX delimiter conversion', () => {
    expect(preprocessLaTeX('\\[a\nb\\] \\(x\\)')).toBe('$$a\nb$$ $x$');
  });
});
