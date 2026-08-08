import { intro, log, outro, spinner } from "@clack/prompts";
import OpenAI from "openai";
import os from "os";
import fs from "fs";
import { z } from "zod/v4";
import { PluralKey, StringCatalog, stringCatalog } from "./types";
import pluralCategoriesFor from "./utils/pluralCategories";
import "colors";

const DEFAULT_CONCURRENCY = 10;
/** Handled by the OpenAI SDK itself (rate limits, timeouts, 5xx). */
const MAX_RETRIES = 5;

/** A plain string, translated into every language that is still missing it. */
type SimpleJob = {
  kind: "string";
  key: string;
  text: string;
  comment?: string;
  targetLanguages: string[];
};

/**
 * A whole plural set. All source forms go out in one request so the model can
 * keep the wording consistent, and every target language asks for the plural
 * categories *it* needs – not the ones the source happens to have.
 */
type PluralJob = {
  kind: "plural";
  key: string;
  comment?: string;
  sourceForms: { category: PluralKey; text: string }[];
  targets: { language: string; categories: PluralKey[] }[];
};

type TranslationJob = SimpleJob | PluralJob;

const jobLabel = (job: TranslationJob) =>
  job.kind === "string"
    ? job.text
    : job.sourceForms.find((form) => form.category === "other")?.text ??
      job.sourceForms[0]?.text ??
      job.key;

export default async function translateStringCatalog(
  file: string,
  options: {
    apiKey?: string;
    languages?: string;
    model: string;
    informalLanguage?: boolean;
    concurrency?: string | number;
  }
) {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    log.error(
      "No API key provided. Please provide an API key via the --api-key flag or the OPENAI_API_KEY environment variable."
    );
    return;
  }
  const spin = spinner();
  const openai = new OpenAI({ apiKey, maxRetries: MAX_RETRIES });
  const languages =
    options.languages
      ?.split(",")
      .map((lang) => lang.trim())
      .filter(Boolean) ?? [];

  if (languages.length === 0) {
    log.error("No languages provided");
    return;
  }

  const parsedConcurrency = Number(options.concurrency ?? DEFAULT_CONCURRENCY);
  const concurrency =
    Number.isFinite(parsedConcurrency) && parsedConcurrency > 0
      ? Math.floor(parsedConcurrency)
      : DEFAULT_CONCURRENCY;

  const translationResult: Record<
    string,
    { translation: string; language: string }[]
  > = {};

  const addToResult = (input: string, lang: string, translation: string) => {
    translationResult[input] = translationResult[input] || [];
    translationResult[input].push({ translation, language: lang });
  };

  /**
   * Schemas depend on the languages (and plural categories) still missing for a
   * string, so they are built on demand and cached per combination.
   */
  const schemaCache = new Map<
    string,
    { parser: z.ZodType; jsonSchema: Record<string, unknown> }
  >();

  function schemaFor(job: TranslationJob) {
    const cacheKey =
      job.kind === "string"
        ? `s:${job.targetLanguages.join(",")}`
        : `p:${job.targets
            .map((t) => `${t.language}=${t.categories.join("|")}`)
            .join(",")}`;

    const cached = schemaCache.get(cacheKey);
    if (cached) return cached;

    const parser =
      job.kind === "string"
        ? z.object(
            Object.fromEntries(
              job.targetLanguages.map((lang) => [lang, z.string()])
            )
          )
        : z.object(
            Object.fromEntries(
              job.targets.map((target) => [
                target.language,
                z.object(
                  Object.fromEntries(
                    target.categories.map((category) => [category, z.string()])
                  )
                ),
              ])
            )
          );

    // OpenAI rejects unknown top level keywords in strict mode.
    const { $schema, ...jsonSchema } = z.toJSONSchema(parser);
    const entry = { parser, jsonSchema };
    schemaCache.set(cacheKey, entry);
    return entry;
  }

  function promptFor(job: TranslationJob, sourceLanguage: string) {
    const comment = job.comment
      ? `\nFor this text the develeoper added a comment: ${job.comment}`
      : "";

    const tokens = `Please respect specific tokens and only return the translations. For example %@ is a placeholder for a string. %i is a placeholder for a number, etc. Every format specifier must appear in every translation, unchanged and in the same order.`;

    if (job.kind === "string") {
      return {
        system: `Translate from ${sourceLanguage} into these languages: ${job.targetLanguages.join(
          ", "
        )}. You are translating an iOS string catalog. ${tokens}
Return a JSON object with one entry per language, using the language code as the key and the translation as the value.${comment}`,
        user: job.text,
      };
    }

    const sourceForms = Object.fromEntries(
      job.sourceForms.map((form) => [form.category, form.text])
    );

    const required = job.targets
      .map((target) => `- ${target.language}: ${target.categories.join(", ")}`)
      .join("\n");

    return {
      system: `Translate from ${sourceLanguage} into an iOS string catalog plural set. ${tokens}
The source provides these CLDR plural categories: ${job.sourceForms
        .map((form) => form.category)
        .join(", ")}.
Return a JSON object keyed by language code, each holding the requested plural categories for that language:
${required}
Languages need different plural categories than the source. When a language requires a category the source does not provide, write the form that is grammatically correct for that category in that language, based on the meaning of the source forms. Never copy a source form into a category where it would be ungrammatical.${comment}`,
      user: JSON.stringify(sourceForms),
    };
  }

  async function translate(job: TranslationJob, sourceLanguage: string) {
    const { parser, jsonSchema } = schemaFor(job);
    const { system, user } = promptFor(job, sourceLanguage);

    const result = await openai.chat.completions.create({
      model: options.model,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "translations",
          strict: true,
          schema: jsonSchema,
        },
      },
      messages: [
        { role: "system", content: system },
        ...((options.informalLanguage
          ? [
              {
                role: "system",
                content: "Use informal language",
              },
            ]
          : []) satisfies OpenAI.Chat.Completions.ChatCompletionMessageParam[]),
        { role: "user", content: user },
      ],
    });

    const message = result.choices?.[0]?.message.content;

    if (!message) {
      throw new Error("No translation found");
    }

    return parser.parse(JSON.parse(message));
  }

  intro("Let's go 🤞.");

  const fileContent = fs.readFileSync(file.replace("~", os.homedir()), "utf8");
  try {
    const catalog = stringCatalog.parse(JSON.parse(fileContent));

    const jobs = collectJobs(catalog, languages);

    if (jobs.length === 0) {
      outro("Nothing to translate, everything is up to date 🎉");
      return;
    }

    const applyStringUnit = (key: string, lang: string, value: string) => {
      catalog.strings[key].localizations = {
        ...catalog.strings[key].localizations,
        [lang]: {
          stringUnit: {
            state: "translated",
            value,
          },
        },
      };
    };

    const applyPlural = (
      key: string,
      lang: string,
      pluralKey: PluralKey,
      value: string
    ) => {
      const existing = catalog.strings[key].localizations?.[lang];
      const existingPlural =
        existing && "variations" in existing && existing.variations?.plural
          ? existing.variations.plural
          : {};

      catalog.strings[key].localizations = {
        ...catalog.strings[key].localizations,
        [lang]: {
          variations: {
            plural: {
              ...existingPlural,
              [pluralKey]: {
                stringUnit: {
                  state: "translated",
                  value,
                },
              },
            },
          },
        },
      };
    };

    const applyJob = (job: TranslationJob, translations: unknown) => {
      if (job.kind === "string") {
        const result = translations as Record<string, string>;
        for (const lang of job.targetLanguages) {
          const translation = result[lang];
          if (!translation) continue;
          addToResult(job.text, lang, translation);
          applyStringUnit(job.key, lang, translation);
        }
        return;
      }

      const result = translations as Record<string, Record<string, string>>;
      for (const target of job.targets) {
        const perCategory = result[target.language];
        if (!perCategory) continue;

        for (const category of target.categories) {
          const translation = perCategory[category];
          if (!translation) continue;

          const sourceText =
            job.sourceForms.find((form) => form.category === category)?.text ??
            jobLabel(job);

          addToResult(sourceText, `${target.language} · ${category}`, translation);
          applyPlural(job.key, target.language, category, translation);
        }
      }
    };

    const totalRequests = jobs.length;
    let finished = 0;
    let failed = 0;

    const progress = (text: string) =>
      `[${finished}/${totalRequests}] ${text}`.replace(/\s*\n\s*/g, " ");

    spin.start(
      progress(
        `Translating ${totalRequests} strings into ${languages.length} languages`
      )
    );

    let cursor = 0;
    const worker = async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        try {
          const translations = await translate(job, catalog.sourceLanguage);
          applyJob(job, translations);
          finished++;
          spin.message(progress(`✓ ${jobLabel(job)}`));
        } catch (e) {
          finished++;
          failed++;
          spin.message(progress(`✗ ${jobLabel(job)}`.red));
          log.error(
            `Failed to translate "${jobLabel(job)}": ${
              e instanceof Error ? e.message : String(e)
            }`
          );
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, jobs.length) }, worker)
    );

    spin.stop(
      `Translated ${totalRequests - failed}/${totalRequests} strings${
        failed > 0 ? ` (${failed} failed)` : ""
      }`
    );

    const translationCount = Object.values(translationResult).reduce(
      (acc, curr) => acc + curr.length,
      0
    );

    if (translationCount > 0) {
      log.step(`Writing translations to ${file}`);
      fs.writeFileSync(
        file.replace("~", os.homedir()),
        JSON.stringify(catalog, null, 2)
      );
      log.success(`Updated ${file}`);

      log.step("Summary".yellow);

      for (const [sourceText, translations] of Object.entries(
        translationResult
      )) {
        log.success(`Source: ${sourceText}`);
        for (const { translation, language } of translations) {
          log.info(`    ${language.green}: ${translation}`);
        }
      }
    }

    outro(`Translated ${translationCount} strings`);
  } catch (e) {
    console.dir(e, { depth: null });
  }
}

/**
 * Walks the catalog and returns one job per source string – plural sets stay
 * together as a single job. Only languages/categories that are still missing a
 * translation end up in a job; fully translated strings produce none.
 */
export function collectJobs(
  catalog: StringCatalog,
  languages: string[]
): TranslationJob[] {
  const jobs: TranslationJob[] = [];

  for (const key in catalog.strings) {
    const source = catalog.strings[key].localizations?.[catalog.sourceLanguage];
    const comment = catalog.strings[key].comment;

    if (
      source &&
      "variations" in source &&
      source.variations &&
      "plural" in source.variations &&
      source.variations.plural
    ) {
      const plural = source.variations.plural;
      const sourceForms = (Object.keys(plural) as PluralKey[]).flatMap(
        (category) => {
          const text = plural[category]?.stringUnit?.value;
          return text === undefined ? [] : [{ category, text }];
        }
      );

      if (sourceForms.length === 0) continue;

      const targets = languages
        .map((language) => {
          const existing = catalog.strings[key].localizations?.[language];
          const existingPlural =
            existing &&
            "variations" in existing &&
            existing.variations &&
            "plural" in existing.variations &&
            existing.variations.plural
              ? existing.variations.plural
              : undefined;

          // Ask for what the *target* language needs, not what the source has.
          const categories = pluralCategoriesFor(language).filter(
            (category) => !existingPlural?.[category]?.stringUnit?.value
          );

          return { language, categories };
        })
        .filter((target) => target.categories.length > 0);

      if (targets.length === 0) continue;

      jobs.push({ kind: "plural", key, comment, sourceForms, targets });
      continue;
    }

    // Either a plain stringUnit or no source localization at all – in the
    // latter case the key itself is the source text.
    const text =
      source && "stringUnit" in source && source.stringUnit
        ? source.stringUnit.value
        : key;

    const targetLanguages = languages.filter((lang) => {
      const existing = catalog.strings[key].localizations?.[lang];
      return !(
        existing &&
        "stringUnit" in existing &&
        existing.stringUnit?.value
      );
    });

    if (targetLanguages.length === 0) continue;

    jobs.push({ kind: "string", key, text, comment, targetLanguages });
  }

  return jobs;
}
