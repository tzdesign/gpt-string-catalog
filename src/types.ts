import { z } from "zod";

export const stringUnit = z.object({
  state: z.union([
    z.literal("translated"),
    z.literal("new"),
    z.literal("needs-translation"),
  ]),
  value: z.string(),
});

export type StringUnit = z.infer<typeof stringUnit>;

export const pluralVariation = z.record(
  z.literal("plural"),
  z.record(
    z.union([
      z.literal("one"),
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
        .catch("manual"),
      localizations: z.record(localization),
    })
  ),
});

export type StringCatalog = z.infer<typeof stringCatalog>;
