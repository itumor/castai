export interface ErrorMessageProps {
  error: string | Error;
  title?: string;
}

/**
 * Reusable error display block. Renders the title (if any) and the error string.
 */
export default function ErrorMessage({
  error,
  title = 'Something went wrong',
}: ErrorMessageProps): JSX.Element {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div
      className="kv-error"
      role="alert"
      data-testid="kv-error"
      data-state="error"
    >
      <strong className="kv-error__title">{title}</strong>
      <p className="kv-error__message">{message}</p>
    </div>
  );
}
