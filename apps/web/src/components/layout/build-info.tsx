import { buildInfo } from "@/lib/build-info";

const link =
  "text-accent-brand hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-brand";

// Written out in full so Next inlines each NEXT_PUBLIC_ value at build time.
export function BuildInfo() {
  const info = buildInfo({
    version: process.env.NEXT_PUBLIC_APP_VERSION,
    release: process.env.NEXT_PUBLIC_APP_RELEASE,
    builtAt: process.env.NEXT_PUBLIC_BUILD_TIME,
  });
  const dot = (
    <span aria-hidden="true" className="text-live">
      ●
    </span>
  );
  if (!info) {
    return (
      <p className="flex items-center gap-1.5">
        {dot}
        <span>dev</span>
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-1.5">
      {dot}
      <span>
        deployed <time dateTime={info.builtAt}>{info.ago}</time>
      </span>
      <span aria-hidden="true">·</span>
      <a
        href={info.shaUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`commit ${info.sha} on GitHub`}
        className={link}
      >
        {info.sha}
      </a>
      {info.release && info.releaseUrl ? (
        <>
          <span aria-hidden="true">·</span>
          <a
            href={info.releaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`release ${info.release} on GitHub`}
            className={link}
          >
            {info.release}
          </a>
        </>
      ) : null}
    </p>
  );
}
