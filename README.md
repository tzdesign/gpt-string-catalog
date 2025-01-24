# gpt-string-catalog

`gpt-string-catalog` is a command-line tool that uses OpenAI's GPT model to translate iOS string catalogs into multiple languages.

## Installation

To install the tool, clone the repository and run:

```sh
npm install gpt-string-catalog
```

## Usage

```sh
gpt-string-catalog [options] <file>
```

### Arguments

- `<file>`: The file or directory to translate.

### Options

- `-V, --version`: Output the version number.
- `-l, --languages <languages>`: The language codes. Please check the language codes in XCode.
- `-a, --api-key <key>`: OpenAI API key. Can also be set via the `OPENAI_API_KEY` environment variable.

### Example

```sh
gpt-string-catalog ~/path/to/Localizable.xcstrings -l es,fr,de -a your_openai_api_key
```

## Environment Variables

- `OPENAI_API_KEY`: You can set your OpenAI API key as an environment variable instead of passing it as an option.

## How It Works

1. The tool reads the specified string catalog file.
2. It parses the file and extracts the strings to be translated.
3. For each string, it checks if a translation already exists for the target languages.
4. If a translation does not exist, it uses OpenAI's GPT model to generate a translation.
5. The translated strings are then written back to the string catalog file.

## License

This project is licensed under the MIT License.