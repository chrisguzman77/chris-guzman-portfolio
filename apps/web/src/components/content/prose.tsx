import { MermaidDiagrams } from "./mermaid-diagrams";

// `html` must come from renderMarkdown(), which sanitizes it. The diagram renderer is only
// added (right after the prose div, which it scopes to) when the body has a ```mermaid block, so other pages never load Mermaid.
export function Prose({ html }: { html: string }) {
  return (
    <>
      <div className="prose-content" dangerouslySetInnerHTML={{ __html: html }} />
      {html.includes('data-mermaid=""') && <MermaidDiagrams />}
    </>
  );
}
