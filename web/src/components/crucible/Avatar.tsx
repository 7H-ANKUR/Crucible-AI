'use client';

/**
 * User avatar — shared across desktop nav, mobile nav, and both profile pages.
 *
 * Intentionally a plain <img>, not next/image: the src is a dynamic
 * Clerk-hosted URL (img.clerk.com) and the rendered sizes are tiny (≤96px),
 * so image optimisation brings no measurable benefit while next/image would
 * require whitelisting a remote host (and throws at runtime if the provider
 * ever serves an avatar from a different CDN). Centralising here keeps the
 * single lint exception and the graceful initials fallback in one place.
 */
export function Avatar({
  src,
  name,
  className = '',
}: {
  src?: string | null;
  name?: string | null;
  className?: string;
}) {
  if (!src) {
    const initials =
      (name ?? '')
        .trim()
        .split(/\s+/)
        .map((w) => w[0])
        .filter(Boolean)
        .slice(0, 2)
        .join('')
        .toUpperCase() || '?';
    return (
      <span
        role="img"
        aria-label={name ?? 'Profile'}
        className={`inline-flex items-center justify-center bg-panel3 text-ink2 font-bold ${className}`}
      >
        {initials}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- dynamic Clerk CDN avatar, tiny; next/image adds no value and needs remote-host config
    <img
      src={src}
      alt={name ?? 'Profile'}
      referrerPolicy="no-referrer"
      loading="lazy"
      className={className}
    />
  );
}
