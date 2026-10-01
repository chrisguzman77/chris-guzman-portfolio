// `html` must come from renderMarkdown(), which sanitizes it.
export function Prose({ html }: { html: string }) {
  return <div className="prose-content" dangerouslySetInnerHTML={{ __html: html }} />;
}
