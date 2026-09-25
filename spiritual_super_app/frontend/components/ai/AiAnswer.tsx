import { Fragment, type ReactNode } from 'react';

/** Renders `**bold**` spans as <strong>; everything else stays plain text (no HTML is ever injected). */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={index} className="font-semibold text-ved-green-900">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;
const HEADING = /^\s*#{1,6}\s+/;

/** A light Markdown subset for model answers: paragraphs, bullet/numbered lists, headings and bold. */
export default function AiAnswer({ text }: { text: string }) {
  const blocks = text.trim().split(/\n\s*\n/);
  return (
    <div className="space-y-2.5">
      {blocks.map((block, blockIndex) => {
        const lines = block.split('\n').filter((line) => line.trim() !== '');
        if (lines.length > 0 && lines.every((line) => BULLET.test(line))) {
          return (
            <ul key={blockIndex} className="list-disc space-y-1 pl-5 marker:text-ved-gold-600">
              {lines.map((line, index) => (
                <li key={index}>{inline(line.replace(BULLET, ''))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={blockIndex}>
            {lines.map((line, index) => (
              <Fragment key={index}>
                {index > 0 && <br />}
                {HEADING.test(line) ? (
                  <strong className="font-semibold text-ved-green-900">{line.replace(HEADING, '')}</strong>
                ) : (
                  inline(line.replace(BULLET, '• '))
                )}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
