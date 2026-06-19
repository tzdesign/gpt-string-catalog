import { z } from "zod";
// zod v4 entrypoint, used only for schemas that need `z.toJSONSchema()`.
import { z as z4 } from "zod/v4";

export const stringUnit = z.object({
  state: z.union([
    z.literal("translated"),
    z.literal("new"),
    z.literal("needs_review"),
    z.literal("needs-translation"),
  ]),
  value: z.string(),
});

export type StringUnit = z.infer<typeof stringUnit>;

export const pluralVariation = z.record(
  z.literal("plural"),
  z.record(
    z.union([
      z.literal("zero"),
      z.literal("one"),
      z.literal("two"),
      z.literal("few"),
      z.literal("many"),
      z.literal("other"),
    ]),
    z.record(z.literal("stringUnit"), stringUnit)
  )
);

export const localization = z.union([
  z.record(z.literal("stringUnit"), stringUnit),
  z.record(z.literal("variations"), pluralVariation),
]);

export type Localization = z.infer<typeof localization>;

export const stringCatalog = z.object({
  sourceLanguage: z.string(),
  version: z.string(),
  strings: z.record(
    z.object({
      comment: z.string().optional(),
      extractionState: z
        .union([z.literal("manual"), z.literal("stale")])
        .catch("manual")
        .optional(),
      localizations: z.record(localization).optional(),
    })
  ),
});

export type StringCatalog = z.infer<typeof stringCatalog>;

// Built with zod v4 so we can derive a JSON Schema via `z.toJSONSchema()`
// for OpenAI structured outputs.
export const xliffTranslationSchema = z4.object({
  filename: z4.string(),
  source: z4.string(),
  target: z4.string(),
  note: z4.string(),
  sourceLanguage: z4.string(),
  targetLanguage: z4.string(),
});

export type XliffTranslation = z4.infer<typeof xliffTranslationSchema>;
