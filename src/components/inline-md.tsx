import { Fragment } from "react";

/**
 * AI-written text sometimes uses **bold** and *italic*. Render just those two, as React elements (never as HTML, so
 * nothing in the text can inject markup); everything else stays plain text.
 */
export function InlineMd({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") && p.length > 4 ? <strong key={i}>{p.slice(2, -2)}</strong>
          : p.startsWith("*") && p.endsWith("*") && p.length > 2 ? <em key={i}>{p.slice(1, -1)}</em>
            : <Fragment key={i}>{p}</Fragment>)}
    </>
  );
}
