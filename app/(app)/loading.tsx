// Instant loading UI for the whole (app) route group. Because `loading.tsx`
// wraps page.js in a <Suspense> boundary, navigation into any app route paints
// this skeleton immediately (and <Link> prefetch pre-renders it) while the real
// page streams in behind it — instead of the user staring at the previous page.
// The nav chrome comes from layout.tsx; this fills the centered content column.
export default function AppLoading() {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <div className="h-8 w-2/3 rounded-lg bg-black/10" />
        <div className="h-4 w-full rounded bg-black/5" />
        <div className="h-4 w-4/5 rounded bg-black/5" />
      </div>
      <div className="card p-5 space-y-4">
        <div className="h-10 w-1/3 rounded-lg bg-black/10" />
        <div className="h-3 w-full rounded bg-black/5" />
        <div className="h-3 w-5/6 rounded bg-black/5" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="card p-5 h-24" />
        <div className="card p-5 h-24" />
      </div>
    </div>
  );
}
