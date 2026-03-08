import React, { Suspense, memo } from 'react';

const MarkdownRenderer = React.lazy(() => import('./MarkdownRenderer'));

const ContentBody = memo(function ContentBody({
  currentTextContent,
  markdownMode,
  inlineLatex,
  isGeneratingMessage,
}: {
  currentTextContent: string;
  markdownMode: boolean;
  inlineLatex: boolean;
  isGeneratingMessage: boolean;
}) {
  return (
    <div className='markdown prose w-full md:max-w-full break-words dark:prose-invert dark share-gpt-message'>
      {markdownMode ? (
        <>
          <Suspense
            fallback={
              <span className='whitespace-pre-wrap'>
                {currentTextContent}
              </span>
            }
          >
            <MarkdownRenderer
              content={currentTextContent}
              inlineLatex={inlineLatex}
            />
          </Suspense>
          {isGeneratingMessage && (
            <span className='inline-block animate-pulse text-gray-500 dark:text-gray-400'>▌</span>
          )}
        </>
      ) : (
        <span className='whitespace-pre-wrap'>
          {currentTextContent}
          {isGeneratingMessage && <span className='animate-pulse'>▌</span>}
        </span>
      )}
    </div>
  );
});

export default ContentBody;
