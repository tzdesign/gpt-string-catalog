#!/usr/bin/env node
import { intro, log, outro, spinner } from "@clack/prompts";
import { program } from "commander";
import OpenAI from "openai";
import fs from "fs";
import os from "os";
import { stringCatalog } from "./types";

program.version("0.0.1").name("gpt-string-catalog");

program
  .argument("<file>", "File or directory to translate")
  .option(
    "-l,--languages <languages>",
    "The language codes. Please check the language codes in XCode"
  )
  .option(
    "-m, --model <model>",
    "The model to use see list on openai https://platform.openai.com/docs/models",
    "gpt-4o"
  )
  .option(
    "-a, --api-key <key>",
    "OpenAI API key. Can also be set via OPENAI_API_KEY env variable"
  )
  .action(async (file, options) => {
    const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      log.error(
        "No API key provided. Please provide an API key via the --api-key flag or the OPENAI_API_KEY environment variable."
      );
      return;
    }
    const openai = new OpenAI({ apiKey });
    const languages = options.languages?.split(",") ?? [];

    if (languages.length === 0) {
      log.error("No languages provided");
      return;
    }

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
      const result = await openAi.chat.completions.create({
        model: options.model,
        messages: [
          {
            role: "system",
            content: `Translate from ${sourceLanguage} to ${targetLanguage}. You are translating an iOS string catalog. Please respect specific tokens and only return the translation.
            ${
              comment
                ? `For this text the develeoper added a comment: ${comment}`
                : ""
            }`,
          },
          {
            role: "user",
            content: text,
          },
        ],
      });

      const message = result.choices?.[0]?.message.content;

      if (!message) {
        throw new Error("No translation found");
      }

      return message;
    }

    intro("Let's go 🤞.");
    let translationCount = 0;

    const fileContent = fs.readFileSync(
      file.replace("~", os.homedir()),
      "utf8"
    );
    try {
      const catalog = stringCatalog.parse(JSON.parse(fileContent));

      for (const key in catalog.strings) {
        for (const lang of languages) {
          const source =
            catalog.strings[key].localizations[catalog.sourceLanguage];
          const comment = catalog.strings[key].comment;

          if (source && "stringUnit" in source && source.stringUnit) {
            const existingTranslation =
              catalog.strings[key].localizations[lang];
            if (
              existingTranslation &&
              "stringUnit" in existingTranslation &&
              existingTranslation.stringUnit
            ) {
              continue;
            }
            console.log(
              `Translate source string unit ${source.stringUnit.value} to ${lang}`
            );
            try {
              const newText = await translate({
                text: source.stringUnit.value,
                sourceLanguage: catalog.sourceLanguage,
                targetLanguage: lang,
                openAi: openai,
                comment,
              });
              catalog.strings[key].localizations[lang] = {
                stringUnit: {
                  state: "translated",
                  value: newText,
                },
              };
              translationCount++;
            } catch (e) {
              console.log(e);
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
                catalog.strings[key].localizations[lang];
              if (
                existingTranslation &&
                "variations" in existingTranslation &&
                existingTranslation.variations &&
                "plural" in existingTranslation.variations &&
                existingTranslation.variations.plural &&
                existingTranslation.variations.plural[pluralKey] &&
                existingTranslation.variations.plural[pluralKey].stringUnit
                  ?.value
              ) {
                continue;
              }
              console.log(
                `translation of ${plural}: ${source.variations.plural[pluralKey].stringUnit.value} to ${lang}`
              );

              try {
                const newText = await translate({
                  text: source.variations.plural[pluralKey].stringUnit.value,
                  sourceLanguage: catalog.sourceLanguage,
                  targetLanguage: lang,
                  openAi: openai,
                  comment,
                });
                translationCount++;

                catalog.strings[key].localizations[lang] = {
                  variations: {
                    plural: {
                      ...("variations" in
                      catalog.strings[key].localizations[lang]
                        ? catalog.strings[key].localizations[lang].variations
                            ?.plural
                        : {}),
                      [pluralKey]: {
                        stringUnit: {
                          state: "translated",
                          value: newText,
                        },
                      },
                    },
                  },
                };
              } catch (e) {}
            }
          } else {
            const existingTranslation =
              catalog.strings[key].localizations[lang];
            if (
              existingTranslation &&
              "stringUnit" in existingTranslation &&
              existingTranslation.stringUnit
            )
              continue;
            console.log(`Translation by key: ${key} in ${lang}`);
            try {
              const newText = await translate({
                text: key,
                sourceLanguage: catalog.sourceLanguage,
                targetLanguage: lang,
                openAi: openai,
                comment,
              });
              translationCount++;

              catalog.strings[key].localizations[lang] = {
                stringUnit: {
                  state: "translated",
                  value: newText,
                },
              };
            } catch (e) {
              console.log(e);
            }
          }
        }
      }
      if (translationCount > 0) {
        fs.writeFileSync(
          file.replace("~", os.homedir()),
          JSON.stringify(catalog, null, 2)
        );
        log.success(`Updated ${file}`);
      }
      outro(`Translated ${translationCount} strings`);
    } catch (e) {
      console.dir(e, { depth: null });
    }
  });

program.parse(process.argv);
