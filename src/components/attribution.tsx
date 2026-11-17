/** CC BY 4.0 requires attribution wherever the dataset's scripts are shown. */
export function DatasetAttribution({ className = "" }: { className?: string }) {
  return (
    <p className={`text-[0.85rem] text-muted-foreground ${className}`}>
      Scripts and teacher marks: Dinesh K P, &ldquo;A Dataset of Digitized Student Examination Papers, Answer Keys, and Manual
      Evaluations for Automated Grading Research&rdquo;, Mendeley Data, V1,{" "}
      <a href="https://doi.org/10.17632/sf3kvjwknt.1" className="underline underline-offset-2">doi:10.17632/sf3kvjwknt.1</a>, licensed{" "}
      <a href="https://creativecommons.org/licenses/by/4.0/" className="underline underline-offset-2">CC BY 4.0</a>. Shown unmodified; marks and
      highlights are GradeLens&apos; output. Students are identified only by number.
    </p>
  );
}
