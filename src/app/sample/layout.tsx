import { AppHeader } from "@/components/app-header";

export default function SampleLayout({ children }: LayoutProps<"/sample">) {
  return (
    <>
      <AppHeader sample />
      <div className="flex flex-1 flex-col">{children}</div>
    </>
  );
}
