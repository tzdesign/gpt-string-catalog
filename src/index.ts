#!/usr/bin/env node
import { program } from "commander";
import translateStringCatalog from "./translateStringCatalog";
import translateXliff from "./translateXliff";

program.version("0.0.1").name("gpt-string-catalog");

program
  .command("translate")
  .description(
    "Translate a xcstrings file. The file will be translated to the languages provided."
  )
  .argument("<file>", "Path to xcstrings file.")
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
    "-i, --informal-language",
    "Use informal language. This will make the translation more informal"
  )
  .option(
    "-a, --api-key <key>",
    "OpenAI API key. Can also be set via OPENAI_API_KEY env variable"
  )
  .action(translateStringCatalog);

program
  .command("translate-xliff")
  .description(
    "Translate a xliff file(s). All infos are in the files. You can provide a directory or a file."
  )
  .argument("<file>", "File or directory to translate")
  .option(
    "-m, --model <model>",
    "The model to use see list on openai https://platform.openai.com/docs/models",
    "gpt-4o"
  )
  .option(
    "-a, --api-key <key>",
    "OpenAI API key. Can also be set via OPENAI_API_KEY env variable"
  )
  .option(
    "-i, --informal-language",
    "Use informal language. This will make the translation more informal"
  )
  .action(translateXliff);

program.parse(process.argv);
