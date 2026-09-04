# gpt-string-catalog

`gpt-string-catalog` is a command-line tool that uses OpenAI's GPT model to translate iOS string catalogs and xliff into multiple languages.

My motivation as an indie developer was to be able to offer my app in as many languages as possible with the least possible effort.
That's why this tool can translate string catalogs and Xliff files.


## Installation

To install the tool, clone the repository and run:

```sh
npm install gpt-string-catalog
```

## Usage

```sh
gpt-string-catalog [options] [command]
```

### Options

- `-V, --version`: Output the version number.
- `-h, --help`: Display help for command.

### Commands

- `translate [options] <file>`: Translate a xcstrings file. The file will be translated to the languages provided.
- `translate-xliff [options] <file>`: Translate a xliff file(s). All infos are in the files. You can provide a directory or a file.
- `help [command]`: Display help for command.

### Example

```sh
gpt-string-catalog translate ~/path/to/Localizable.xcstrings -l es,fr,de -a your_openai_api_key
```

## Environment Variables

- `OPENAI_API_KEY`: You can set your OpenAI API key as an environment variable instead of passing it as an option.

## How It Works

1. The tool reads the specified string catalog file.
2. It parses the file and extracts the strings to be translated.
3. For each string, it checks which of the target languages are still missing a translation. Existing translations are never overwritten.
4. For every string one request is sent to OpenAI that returns the translations for all missing languages at once (structured output, one JSON key per language code).
5. Those requests run in parallel – 10 at a time by default, configurable via `-c, --concurrency`. Failed requests are retried by the OpenAI SDK up to 5 times.
6. The translated strings are then written back to the string catalog file.

### Pluralization

A plural set is translated as a whole: all source forms go out in a single request, so the model can keep the wording consistent across forms.

More importantly, the plural categories are taken from the **target** language, not from the source. English only has `one` and `other`, but Polish needs `one`, `few`, `many` and `other`, and Arabic needs all six. The categories come from ICU via `Intl.PluralRules`, so translating an English catalog to Polish produces a complete, grammatically correct plural set instead of just copying the two English categories.

Categories the target language does not have are skipped – translating `zero`/`one`/`other` from English to German yields `one`/`other`.

## Development

```sh
pnpm install
pnpm build
pnpm test
```

The tests run the real command against a mock OpenAI endpoint (no API key and no network needed) using `test/fixtures/all-options.xcstrings`, a catalog that covers every supported shape: plain strings, plural sets, keys without localizations, partially and fully translated entries, comments and extraction states.

## License

This project is licensed under the MIT License.