import { intro, log, outro, spinner } from "@clack/prompts";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import findXliff from "./utils/findXliff";
// @ts-ignore
import jsToXliff12 from "xliff/jsToXliff12";
import { XliffTranslation, xliffTranslationSchema } from "./types";
import fs from "fs";

export default async function translateXliff(
  path: string,
  options: { apiKey?: string; model: string; informalLanguage?: boolean }
) {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    log.error(
      "No API key provided. Please provide an API key via the --api-key flag or the OPENAI_API_KEY environment variable."
    );
    return;
  }
  intro("Let's see if we can find 🔎 some xliff files in here.");
  const openai = new OpenAI({ apiKey });
  const xliffs = await findXliff(path);
  const spin = spinner();

  for (const key of xliffs.keys()) {
    const xFilename = xliffs[key][0];
    const xliff = xliffs[key][1];
    const resources = xliff.resources;
    const sourceLanguage = xliff.sourceLanguage;
    const targetLanguage = xliff.targetLanguage;
    if (sourceLanguage === targetLanguage) continue;
    log.step(`Preparing translation ${sourceLanguage} -> ${targetLanguage}`);
    for (const filename of Object.keys(resources)) {
      for (const tK of Object.keys(resources[filename])) {
        const source = resources[filename][tK].source;
        const target = resources[filename][tK].target;
        if (target) continue;
        const note = resources[filename][tK].note.replace(
          "No comment provided by engineer.",
          ""
        );
        const message: XliffTranslation = {
          filename,
          source,
          target,
          note,
          sourceLanguage,
          targetLanguage,
        };

        try {
          spin.start(`Translating ${source}`);
          const result = await openai.chat.completions.create({
            model: "gpt-4o",
            response_format: zodResponseFormat(
              xliffTranslationSchema,
              "translation"
            ),
            messages: [
              {
                role: "system",
                content: `Translate the following text from ${sourceLanguage} to ${targetLanguage}. Leave all fields of the input and only fill the target with the translation.`,
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
                content: JSON.stringify(message),
              },
            ],
          });
          const returnedString = result.choices?.[0]?.message?.content;

          if (!returnedString) {
            throw new Error("No translation found");
          }
          const object = xliffTranslationSchema.parse(
            JSON.parse(returnedString)
          );

          xliff.resources[filename][tK].target = object.target;

          console.log("Translating", source);
        } catch (e) {
          console.error(e);
        } finally {
          spin.stop(`${source} translated`);
        }
      }
    }

    fs.writeFileSync(xFilename, await jsToXliff12(xliff));
  }
  spin.stop(`Batch imported`);
  outro("All done! 🎉");
}
