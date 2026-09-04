const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Must come before anything from dist/ – see the module for why.
require("./helpers/silenceClack");

const {
  startMockOpenAI,
  httpError,
  echoSchema,
} = require("./helpers/mockOpenAI");

const translateStringCatalog =
  require("../dist/translateStringCatalog").default;
const { collectJobs } = require("../dist/translateStringCatalog");

const FIXTURE = path.join(__dirname, "fixtures", "all-options.xcstrings");
const readFixture = () => JSON.parse(fs.readFileSync(FIXTURE, "utf8"));

/** Copies the fixture to a temp file so tests never mutate it. */
function tempCatalog() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gpt-sc-"));
  const file = path.join(dir, "Localizable.xcstrings");
  fs.copyFileSync(FIXTURE, file);
  return file;
}

/** Runs the real command against a mock endpoint and returns the written file. */
async function run({ languages, respond = echoSchema, concurrency }) {
  const mock = await startMockOpenAI(respond);
  const file = tempCatalog();
  const previousBaseUrl = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_BASE_URL = mock.url;

  try {
    await translateStringCatalog(file, {
      apiKey: "test-key",
      languages,
      model: "gpt-4o",
      concurrency,
    });
  } finally {
    if (previousBaseUrl === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = previousBaseUrl;
    await mock.close();
  }

  return {
    catalog: JSON.parse(fs.readFileSync(file, "utf8")),
    requests: mock.requests,
    maxConcurrent: mock.maxConcurrent,
  };
}

const pluralOf = (catalog, key, lang) =>
  catalog.strings[key].localizations?.[lang]?.variations?.plural ?? {};

const categoriesOf = (catalog, key, lang) =>
  Object.keys(pluralOf(catalog, key, lang));

test("plural categories come from the target language, not the source", async () => {
  const { catalog } = await run({ languages: "de,pl,ar,ja" });

  // Source (en) only provides one + other.
  assert.deepEqual(
    Object.keys(readFixture().strings.apple_count.localizations.en.variations.plural),
    ["one", "other"]
  );

  assert.deepEqual(categoriesOf(catalog, "apple_count", "de"), [
    "one",
    "other",
  ]);
  assert.deepEqual(categoriesOf(catalog, "apple_count", "pl"), [
    "one",
    "few",
    "many",
    "other",
  ]);
  assert.deepEqual(categoriesOf(catalog, "apple_count", "ar"), [
    "zero",
    "one",
    "two",
    "few",
    "many",
    "other",
  ]);
  assert.deepEqual(categoriesOf(catalog, "apple_count", "ja"), ["other"]);
});

test("a source category the target does not need is dropped", async () => {
  // day_count has zero/one/other in English; German has no "zero" category.
  const { catalog } = await run({ languages: "de" });
  assert.deepEqual(categoriesOf(catalog, "day_count", "de"), ["one", "other"]);
});

test("one request per plural key carries every source form", async () => {
  const { requests } = await run({ languages: "de,pl,ar,ja" });

  const pluralRequests = requests.filter((r) => r.user.includes("%lld apple"));
  assert.equal(pluralRequests.length, 1, "plural set must be a single request");

  const sent = JSON.parse(pluralRequests[0].user);
  assert.deepEqual(sent, { one: "%lld apple", other: "%lld apples" });

  // The schema asks each language for exactly its own categories.
  assert.deepEqual(Object.keys(pluralRequests[0].properties), [
    "de",
    "pl",
    "ar",
    "ja",
  ]);
  assert.deepEqual(
    Object.keys(pluralRequests[0].properties.pl.properties),
    ["one", "few", "many", "other"]
  );
  assert.deepEqual(Object.keys(pluralRequests[0].properties.ja.properties), [
    "other",
  ]);
  // Strict structured output: every key required, nothing extra allowed.
  assert.equal(pluralRequests[0].properties.pl.additionalProperties, false);
  assert.deepEqual(pluralRequests[0].properties.pl.required, [
    "one",
    "few",
    "many",
    "other",
  ]);
});

test("existing translations are kept and never re-requested", async () => {
  const { catalog, requests } = await run({ languages: "de,pl" });

  // German already had the "one" form of message_count.
  assert.equal(
    pluralOf(catalog, "message_count", "de").one.stringUnit.value,
    "%lld neue Nachricht"
  );
  assert.ok(pluralOf(catalog, "message_count", "de").other.stringUnit.value);

  const messageRequest = requests.find((r) =>
    r.user.includes("%lld new message")
  );
  assert.deepEqual(Object.keys(messageRequest.properties.de.properties), [
    "other",
  ]);
  assert.deepEqual(Object.keys(messageRequest.properties.pl.properties), [
    "one",
    "few",
    "many",
    "other",
  ]);

  // "Hello %@" already exists in German, so only Polish may be requested.
  const helloRequest = requests.find((r) => r.user === "Hello %@");
  assert.deepEqual(Object.keys(helloRequest.properties), ["pl"]);
  assert.equal(
    catalog.strings["Hello %@"].localizations.de.stringUnit.value,
    "Hallo %@"
  );
});

test("a fully translated string produces no request at all", async () => {
  const { requests } = await run({ languages: "de,pl,ar,ja" });
  assert.equal(
    requests.some((r) => r.user === "Fully translated"),
    false
  );
});

test("a key without localizations is translated from the key itself", async () => {
  const { catalog, requests } = await run({ languages: "de" });

  assert.ok(requests.some((r) => r.user === "Key only, no localizations"));
  assert.equal(
    catalog.strings["Key only, no localizations"].localizations.de.stringUnit
      .value,
    "[de] Key only, no localizations"
  );
});

test("plain strings batch all missing languages into one request", async () => {
  const { requests, catalog } = await run({ languages: "de,pl,ar,ja" });

  const settings = requests.filter((r) => r.user === "Settings");
  assert.equal(settings.length, 1);
  assert.deepEqual(Object.keys(settings[0].properties), [
    "de",
    "pl",
    "ar",
    "ja",
  ]);

  for (const lang of ["de", "pl", "ar", "ja"]) {
    assert.equal(
      catalog.strings.Settings.localizations[lang].stringUnit.value,
      `[${lang}] Settings`
    );
  }
});

test("the comment is passed to the model when present", async () => {
  // "Hello %@" already has German, so ask for a language it still needs.
  const { requests } = await run({ languages: "de,pl" });

  const withComment = requests.find((r) => r.user === "Hello %@");
  assert.match(withComment.system, /Greeting shown on the home screen/);

  const withoutComment = requests.find((r) => r.user === "Settings");
  assert.doesNotMatch(withoutComment.system, /develeoper added a comment/);
});

test("concurrency is capped at the configured value", async () => {
  const { maxConcurrent } = await run({
    languages: "de,pl,ar,ja",
    concurrency: 2,
    respond: async (record) => {
      await new Promise((r) => setTimeout(r, 50));
      return echoSchema(record);
    },
  });
  assert.ok(maxConcurrent <= 2, `expected <= 2, saw ${maxConcurrent}`);
  assert.ok(maxConcurrent > 1, "requests did not run in parallel");
});

test("a failed string keeps its key and its existing content", async () => {
  const { catalog } = await run({
    languages: "de",
    respond: (record) =>
      record.user === "Settings"
        ? httpError(400, "nope")
        : echoSchema(record),
  });

  assert.ok(catalog.strings.Settings, "the key must survive a failure");
  assert.equal(
    catalog.strings.Settings.localizations.en.stringUnit.value,
    "Settings"
  );
  assert.equal(catalog.strings.Settings.localizations.de, undefined);
  // Unrelated strings still got translated.
  assert.ok(catalog.strings["Hello %@"].localizations.de);
});

test("nothing is written when every string is already translated", async () => {
  const mock = await startMockOpenAI(echoSchema);
  const file = tempCatalog();
  const languages = "de,pl,ar,ja";
  process.env.OPENAI_BASE_URL = mock.url;

  try {
    const options = { apiKey: "k", languages, model: "gpt-4o" };
    await translateStringCatalog(file, options);
    const firstPass = mock.requests.length;
    const afterFirst = fs.readFileSync(file, "utf8");

    await translateStringCatalog(file, options);

    assert.ok(firstPass > 0);
    assert.equal(mock.requests.length, firstPass, "second run must be a no-op");
    assert.equal(fs.readFileSync(file, "utf8"), afterFirst);
  } finally {
    delete process.env.OPENAI_BASE_URL;
    await mock.close();
  }
});

test("collectJobs reports one job per string, plural sets included", () => {
  const jobs = collectJobs(
    {
      sourceLanguage: "en",
      version: "1.0",
      strings: {
        plain: {
          localizations: {
            en: { stringUnit: { state: "translated", value: "Plain" } },
          },
        },
        counted: {
          localizations: {
            en: {
              variations: {
                plural: {
                  one: { stringUnit: { state: "translated", value: "%lld x" } },
                  other: { stringUnit: { state: "translated", value: "%lld xs" } },
                },
              },
            },
          },
        },
      },
    },
    ["pl"]
  );

  assert.equal(jobs.length, 2);
  const plural = jobs.find((j) => j.kind === "plural");
  assert.equal(plural.sourceForms.length, 2);
  assert.deepEqual(plural.targets, [
    { language: "pl", categories: ["one", "few", "many", "other"] },
  ]);
});
