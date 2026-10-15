import { MarkHeroSeen } from "./mark-hero-seen";

// The home hero's "$ whoami". On the first view per browser session it types itself (CSS, see
// "Home hero" in globals.css); the full text is always in the HTML for SEO and screen readers.
export function HeroPrompt({ animate }: { animate: boolean }) {
  return (
    <p className="font-mono text-xs text-accent-brand">
      <span className={animate ? "hero-type" : undefined}>$ whoami</span>
      {animate ? (
        <>
          <span aria-hidden="true" className="hero-caret" />
          <MarkHeroSeen />
        </>
      ) : null}
    </p>
  );
}
