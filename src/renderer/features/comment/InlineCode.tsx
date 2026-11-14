import React from 'react';

/**
 * Text with its backtick spans shown as code, as replies and failure lines
 * write file names and commands. Nothing else in the text is read as
 * Markdown, and none of it as HTML.
 */
export const InlineCode: React.FC<{ text: string }> = ({ text }) => {
  const parts = text.split(/`([^`\n]+)`/);
  return (
    <>
      {parts.map((part, index) => (index % 2 === 1
        ? <code key={index}>{part}</code>
        : part ? <React.Fragment key={index}>{part}</React.Fragment> : null))}
    </>
  );
};
