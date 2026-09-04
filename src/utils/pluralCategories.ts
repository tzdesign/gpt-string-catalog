import { PluralKey } from "../types";

/** CLDR order, also the order Xcode writes plural variations in. */
const PLURAL_ORDER: PluralKey[] = [
  "zero",
  "one",
  "two",
  "few",
  "many",
  "other",
];

const cache = new Map<string, PluralKey[]>();

/**
 * The cardinal plural categories a language actually needs, straight from ICU
 * via `Intl.PluralRules` – no hand maintained table.
 *
 * English only has `one` and `other`, but Polish needs `one`, `few`, `many`
 * and `other`, and Arabic needs all six. Copying the source categories to the
 * target would silently produce grammatically incomplete plurals.
 */
export default function pluralCategoriesFor(language: string): PluralKey[] {
  const cached = cache.get(language);
  if (cached) return cached;

  let categories: PluralKey[];
  try {
    const resolved = new Intl.PluralRules(language, {
      type: "cardinal",
    }).resolvedOptions().pluralCategories as PluralKey[];
    categories = PLURAL_ORDER.filter((category) =>
      resolved.includes(category)
    );
  } catch {
    // Malformed language tag – fall back to the most common set.
    categories = ["one", "other"];
  }

  // `other` is mandatory in a string catalog, ICU always reports it, but be safe.
  if (!categories.includes("other")) categories.push("other");

  cache.set(language, categories);
  return categories;
}

export { PLURAL_ORDER };
