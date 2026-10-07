import { ResumeLink } from "@/components/analytics/resume-link";

// Shown at every width in a full-width, letter-shaped frame (8.5 x 11): its height follows its
// width, so the whole one-page resume fits without scrolling inside the frame (the page itself
// may scroll). toolbar=0 hides the Chromium viewer's toolbar and thumbnail sidebar (the page
// has its own Download button) and view=Fit fits the whole page, so it fills the frame.
// Browsers that cannot embed PDFs (Android Chrome) show the fallback link instead.
export function PdfEmbed({ src }: { src: string }) {
  return (
    <object
      data={`${src}#toolbar=0&view=Fit`}
      type="application/pdf"
      aria-label="Resume of Christopher Guzman (PDF)"
      className="block aspect-[8.5/11] w-full rounded"
    >
      <p className="p-6 text-sm text-muted-foreground">
        Your browser cannot show the PDF here.{" "}
        <ResumeLink href={src} className="text-accent-brand underline-offset-4 hover:underline">
          Open the resume PDF
        </ResumeLink>
        .
      </p>
    </object>
  );
}
