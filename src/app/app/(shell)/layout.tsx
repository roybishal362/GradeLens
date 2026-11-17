import { TeacherShell } from "@/components/shell/shell";

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return <TeacherShell>{children}</TeacherShell>;
}
