import { ResumeLink } from "@/components/analytics/resume-link";

// Shown at every width. Phones get a letter-shaped frame (8.5 x 11) so the one-page resume
// fits; desktop keeps a tall reader. Browsers that cannot embed PDFs (Android Chrome) show
// the fallback link instead.
export function PdfEmbed({ src }: { src: string }) {
  return (
    <object
      data={src}
      type="application/pdf"
      aria-label="Resume of Christopher Guzman (PDF)"
      className="aspect-[8.5/11] w-full rounded md:aspect-auto md:h-[80vh]"
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
