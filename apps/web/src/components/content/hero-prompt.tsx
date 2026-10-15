import { MarkHeroSeen } from "./mark-hero-seen";

// The home hero's "$ whoami": types itself on a refresh or a fresh visit (CSS, see "Home hero" in
// globals.css; <MarkHeroSeen> switches it off otherwise). The full text is always in the HTML.
export function HeroPrompt() {
  return (
    <p className="font-mono text-xs text-accent-brand">
      <span className="hero-type">$ whoami</span>
      <span aria-hidden="true" className="hero-caret" />
      <MarkHeroSeen />
    </p>
  );
}
