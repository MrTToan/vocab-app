// Marketing layout: a bare, full-bleed canvas. The landing page brings its own
// header and sections, so no shared app nav here.
export default function MarketingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="flex-1 w-full">{children}</div>;
}
