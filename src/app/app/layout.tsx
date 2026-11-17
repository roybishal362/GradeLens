import { AppHeader } from "@/components/app-header";

export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <>
      <AppHeader />
      <div className="flex-1">{children}</div>
    </>
  );
}
