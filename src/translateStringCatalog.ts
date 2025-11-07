import { intro, log, outro, spinner } from "@clack/prompts";
import OpenAI from "openai";
import os from "os";
import fs from "fs";
import { stringCatalog } from "./types";
import "colors";

export default async function translateStringCatalog(
  file: string,
  options: {
    apiKey?: string;
    languages?: string;
    model: string;
    informalLanguage?: boolean;
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
  const openai = new OpenAI({ apiKey });
  const languages = options.languages?.split(",") ?? [];

  if (languages.length === 0) {
    log.error("No languages provided");
    return;
  }

  const translationResult: Record<
    string,
    { translation: string; language: string }[]
  > = {};

  const addToResult = (input: string, lang: string, translation: string) => {
    translationResult[input] = translationResult[input] || [];
    translationResult[input].push({ translation, language: lang });
  };

  async function translate({
    text,
    sourceLanguage,
    targetLanguage,
    openAi,
    comment,
  }: {
    text: string;
    sourceLanguage: string;
    targetLanguage: string;
    openAi: OpenAI;
    comment?: string;
  }): Promise<string> {
    spin.start(`Translating ${text} ${comment ? `(${comment})` : ""}`);

    const result = await openAi.chat.completions.create({
      model: options.model,
      messages: [
        {
          role: "system",
          content: `Translate from ${sourceLanguage} to ${targetLanguage}. You are translating an iOS string catalog. Please respect specific tokens and only return the translation.
          For example %@ is a placeholder for a string. %i is a placeholder for a number, etc.
            ${
              comment
                ? `For this text the develeoper added a comment: ${comment}`
                : ""
            }`,
        },
        ...((options.informalLanguage
          ? [
              {
                role: "system",
                content: "Use informal language",
              },
            ]
          : []) satisfies OpenAI.Chat.Completions.ChatCompletionMessageParam[]),
        {
          role: "user",
          content: text,
        },
      ],
    });

    const message = result.choices?.[0]?.message.content;
    spin.stop(message ?? "No translation found");

    if (!message) {
      throw new Error("No translation found");
    }
    return message;
  }

  intro("Let's go 🤞.");

  const fileContent = fs.readFileSync(file.replace("~", os.homedir()), "utf8");
  try {
    const catalog = stringCatalog.parse(JSON.parse(fileContent));

    for (const key in catalog.strings) {
      for (const lang of languages) {
        const source =
          catalog.strings[key].localizations?.[catalog.sourceLanguage];
        const comment = catalog.strings[key].comment;

        if (source && "stringUnit" in source && source.stringUnit) {
          const existingTranslation =
            catalog.strings[key].localizations?.[lang];
          if (
            existingTranslation &&
            "stringUnit" in existingTranslation &&
            existingTranslation.stringUnit?.value
          ) {
            continue;
          }
          try {
            const newText = await translate({
              text: source.stringUnit.value,
              sourceLanguage: catalog.sourceLanguage,
              targetLanguage: lang,
              openAi: openai,
              comment,
            });

            addToResult(
              source.stringUnit.value,
              catalog.sourceLanguage,
              newText
            );
            catalog.strings[key].localizations = {
              ...catalog.strings[key].localizations,
              [lang]: {
                stringUnit: {
                  state: "translated",
                  value: newText,
                },
              },
            };
          } catch (e) {
            console.error(e);
          }
        } else if (
          source &&
          "variations" in source &&
          source.variations &&
          "plural" in source.variations &&
          source.variations.plural
        ) {
          for (const plural in source.variations.plural) {
            const pluralKey = plural as keyof typeof source.variations.plural;
            if (
              source.variations.plural[pluralKey]?.stringUnit?.value ===
              undefined
            )
              continue;
            const existingTranslation =
              catalog.strings[key].localizations?.[lang];
            if (
              existingTranslation &&
              "variations" in existingTranslation &&
              existingTranslation.variations &&
              "plural" in existingTranslation.variations &&
              existingTranslation.variations.plural &&
              existingTranslation.variations.plural[pluralKey]?.stringUnit
                ?.value
            ) {
              continue;
            }

            try {
              const newText = await translate({
                text: source.variations.plural[pluralKey].stringUnit.value,
                sourceLanguage: catalog.sourceLanguage,
                targetLanguage: lang,
                openAi: openai,
                comment,
              });

              addToResult(
                source.variations.plural[pluralKey].stringUnit.value,
                catalog.sourceLanguage,
                newText
              );

              catalog.strings[key].localizations = {
                ...catalog.strings[key].localizations,
                [lang]: {
                  variations: {
                    plural: {
                      ...(catalog.strings[key].localizations?.[lang] &&
                      "variations" in
                        catalog.strings[key].localizations[lang] &&
                      catalog.strings[key].localizations[lang].variations
                        ?.plural
                        ? catalog.strings[key].localizations[lang].variations
                            .plural
                        : {}),
                      [pluralKey]: {
                        stringUnit: {
                          state: "translated",
                          value: newText,
                        },
                      },
                    },
                  },
                },
              };
            } catch (e) {
              console.error(e);
            }
          }
        } else {
          const existingTranslation =
            catalog.strings[key].localizations?.[lang];
          if (
            existingTranslation &&
            "stringUnit" in existingTranslation &&
            existingTranslation.stringUnit?.value
          )
            continue;
          try {
            const newText = await translate({
              text: key,
              sourceLanguage: catalog.sourceLanguage,
              targetLanguage: lang,
              openAi: openai,
              comment,
            });

            catalog.strings[key].localizations = {
              ...catalog.strings[key].localizations,
              [lang]: {
                stringUnit: {
                  state: "translated",
                  value: newText,
                },
              },
            };
          } catch (e) {
            console.error(e);
          }
        }
      }
    }

    const translationCount = Object.values(translationResult).reduce(
      (acc, curr) => acc + curr.length,
      0
    );

    if (translationCount > 0) {
      fs.writeFileSync(
        file.replace("~", os.homedir()),
        JSON.stringify(catalog, null, 2)
      );
      log.success(`Updated ${file}`);
    }

    for (const [sourceText, translations] of Object.entries(
      translationResult
    )) {
      log.info(`Source: ${sourceText}`);
      for (const { translation, language } of translations) {
        log.info(`  [${language.green}]: ${translation}`);
      }
    }

    outro(`Translated ${translationCount} strings`);
  } catch (e) {
    console.dir(e, { depth: null });
  }
}
