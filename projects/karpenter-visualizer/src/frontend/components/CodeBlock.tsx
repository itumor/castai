import { useCallback, useState } from 'react';

export interface CodeBlockProps {
  code: string;
  language?: string;
}

/**
 * Preformatted code block with a copy-to-clipboard button.
 *
 * Falls back to a simple textarea-based copy when the Clipboard API
 * is unavailable (e.g. in older test environments).
 */
export default function CodeBlock({
  code,
  language = 'json',
}: CodeBlockProps): JSX.Element {
  const [copied, setCopied] = useState<boolean>(false);

  const handleCopy = useCallback(async (): Promise<void> => {
    try {
      if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function'
      ) {
        await navigator.clipboard.writeText(code);
      } else if (typeof document !== 'undefined') {
        const ta = document.createElement('textarea');
        ta.value = code;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, [code]);

  return (
    <div
      className="kv-codeblock"
      data-testid="code-block"
      data-language={language}
    >
      <div className="kv-codeblock__header">
        <span className="kv-codeblock__language">{language}</span>
        <button
          type="button"
          className="kv-codeblock__copy"
          onClick={handleCopy}
          data-testid="code-block-copy"
          aria-label="Copy code to clipboard"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="kv-codeblock__pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}
