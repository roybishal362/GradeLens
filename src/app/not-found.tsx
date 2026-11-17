import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-5 py-16">
      <p className="text-lg font-[750] tracking-tight">GradeLens</p>
      <h1 className="mt-6 text-[1.95rem] font-[750] tracking-tight">This page isn&apos;t here</h1>
      <p className="mt-2 text-muted-foreground">
        The link may be mistyped, or the class or test was deleted. If you&apos;re a student, ask your teacher for the current upload link.
      </p>
      <p className="mt-6 flex gap-5">
        <Link href="/app" className="font-semibold underline underline-offset-4">Your classes</Link>
        <Link href="/sample" className="font-semibold underline underline-offset-4">Sample class</Link>
      </p>
    </main>
  );
}
