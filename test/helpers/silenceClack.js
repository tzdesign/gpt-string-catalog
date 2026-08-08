/**
 * Replaces @clack/prompts with no-ops.
 *
 * `node --test` runs every test file in its own process and parses its stdout,
 * so the spinner's raw ANSI writes would corrupt the report. Requiring this
 * module *before* anything from `dist/` seeds the require cache with a stub.
 */
const clackPath = require.resolve("@clack/prompts");

const noop = () => {};

require.cache[clackPath] = {
  id: clackPath,
  filename: clackPath,
  path: require("node:path").dirname(clackPath),
  loaded: true,
  children: [],
  paths: [],
  exports: {
    intro: noop,
    outro: noop,
    note: noop,
    log: {
      error: noop,
      warn: noop,
      info: noop,
      step: noop,
      success: noop,
      message: noop,
    },
    spinner: () => ({ start: noop, stop: noop, message: noop }),
  },
};
