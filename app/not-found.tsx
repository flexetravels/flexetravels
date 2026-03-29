import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center">
      <div className="text-5xl mb-4">🗺️</div>
      <h1 className="text-2xl font-black text-foreground mb-2">
        This destination doesn&apos;t exist (yet)
      </h1>
      <p className="text-muted-foreground mb-6 max-w-sm">
        The page you&apos;re looking for has flown the coop. Let&apos;s find somewhere that does exist.
      </p>
      <Link
        href="/chat"
        className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-bold transition-colors"
      >
        Plan a trip instead
      </Link>
    </div>
  );
}
