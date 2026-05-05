export default function Loading() {
  return (
    <div className="min-h-screen bg-navy-950 text-navy-100 flex items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-4 h-8 w-8 rounded-full border-2 border-teal-500/30 border-t-teal-500 animate-spin" />
        <p className="text-xs uppercase tracking-[0.2em] text-teal-400 font-mono">Loading your trip</p>
      </div>
    </div>
  );
}
