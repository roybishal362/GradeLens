/** The teacher area. (shell) pages get the sidebar; (focus) pages (review, printing) get a slim top bar. */
export default function AppLayout({ children }: LayoutProps<"/app">) {
  return <>{children}</>;
}
