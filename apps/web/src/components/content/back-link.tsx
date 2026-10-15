import Link from "next/link";

// "← cd ..": back to the parent list from a project or blog post. The arrow sits outside a
// keyboard-key box; both are one link. Styles in globals.css ("Back link").
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={`cd .. (back to ${label})`}
      className="back-key group inline-flex items-center gap-2 font-mono text-[13px] focus-visible:outline-none"
    >
      <span aria-hidden="true" className="back-key-arrow text-accent-brand">
        ←
      </span>
      <span aria-hidden="true" className="back-key-box">
        cd ..
      </span>
    </Link>
  );
}
