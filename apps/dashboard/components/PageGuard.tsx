import { Notice } from "./ui";

/**
 * Renders the page body, or a readable error instead of Next.js's opaque production error screen.
 * Server-side data errors (RLS, missing tables, bad env) show their message so they can be fixed quickly.
 */
export async function guarded(render: () => Promise<React.ReactNode>): Promise<React.ReactNode> {
  try {
    return await render();
  } catch (e) {
    if ((e as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    return (
      <Notice kind="error">
        <b>Failed to load this page.</b>
        <div className="mt-1 font-mono text-xs whitespace-pre-wrap">{msg}</div>
      </Notice>
    );
  }
}
