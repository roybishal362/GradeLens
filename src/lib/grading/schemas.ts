import { z } from "zod";

/** Line on the scanned page, with a box normalized to 0..1000 as [ymin, xmin, ymax, xmax]. */
export const LineSchema = z.object({
  text: z.string(),
  box: z.array(z.number()).length(4),
  page: z.number().int().optional().describe("1-based page of this line, when the answer continues onto another page"),
});

export const ReadAnswerSchema = z.object({
  q: z.number().int().describe("question number"),
  text: z.string().describe("exact transcription, no corrections"),
  formulas: z.array(z.string()).describe("maths as linearized formulas, one step per item, in order"),
  diagram: z
    .object({ outline: z.string(), labels: z.array(z.string()) })
    .nullable()
    .describe("null when nothing is drawn"),
  lines: z.array(LineSchema).describe("every handwritten line of this answer with its box on the page"),
  page: z.number().int().describe("1-based page index the answer starts on"),
  illegible: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export const ReadResultSchema = z.object({
  studentName: z.string().nullable(),
  answers: z.array(ReadAnswerSchema),
  imageQuality: z.enum(["good", "blurry", "dark", "cut_off", "skewed"]),
});

export const CriterionSchema = z.object({
  id: z.string(),
  points: z.number().min(0).describe("max points for this criterion"),
  mustMention: z.string(),
  ecf: z
    .boolean()
    .optional()
    .describe("true = method mark: error carried forward allowed. false/absent = accuracy mark: this step must be actually correct"),
});

export const RubricQuestionSchema = z.object({
  q: z.number().int(),
  type: z.enum(["short", "long", "math", "diagram", "one_word", "mcq"]),
  marks: z.number(),
  text: z.string(),
  modelAnswer: z.string(),
  criteria: z.array(CriterionSchema),
  commonMisconceptions: z.array(z.string()),
});
export const RubricSchema = z.object({ questions: z.array(RubricQuestionSchema) });

export const GradeSchema = z.object({
  questions: z.array(
    z.object({
      q: z.number().int(),
      criteria: z.array(
        z.object({
          id: z.string(),
          points: z.number().min(0),
          evidenceQuote: z.string().describe("ONE continuous piece copied exactly from the answer, or empty"),
          reason: z.string(),
        }),
      ),
      misconceptions: z.array(z.string()),
      injectionAttempt: z.boolean(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

export type ReadResult = z.infer<typeof ReadResultSchema>;
export type ReadAnswer = z.infer<typeof ReadAnswerSchema>;
export type RubricQuestion = z.infer<typeof RubricQuestionSchema>;
export type Rubric = z.infer<typeof RubricSchema>;
export type GradeResult = z.infer<typeof GradeSchema>;
