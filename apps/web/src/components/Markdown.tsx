import clsx from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Markdown-Darstellung. Rohes HTML wird nicht gerendert (kein rehype-raw) → XSS-sicher.
 * Links öffnen extern mit rel="noopener noreferrer nofollow".
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={clsx('prose prose-sm max-w-none dark:prose-invert prose-a:text-accent prose-img:rounded', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
