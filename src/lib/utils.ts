export { cn } from "cn"

/** Roster order people expect: "Student 2" before "Student 10" (the database sorts names as plain text). */
export const byName = <T extends { display_name: string }>(rows: readonly T[] | null | undefined): T[] =>
  [...(rows ?? [])].sort((a, b) => a.display_name.localeCompare(b.display_name, undefined, { numeric: true, sensitivity: "base" }));
