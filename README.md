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
3. For each string, it checks if a translation already exists for the target languages.
4. If a translation does not exist, it uses OpenAI's GPT model to generate a translation.
5. The translated strings are then written back to the string catalog file.

## License

This project is licensed under the MIT License.