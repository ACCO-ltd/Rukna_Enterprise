export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen border-t-[3px] border-brand-accent bg-background">
      <div className="mx-auto flex min-h-[calc(100vh-3px)] w-full items-center justify-center px-4 py-6 sm:px-6 sm:py-10 lg:px-10">
        {children}
      </div>
    </div>
  );
}
