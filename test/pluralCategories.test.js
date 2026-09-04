const test = require("node:test");
const assert = require("node:assert/strict");

const pluralCategoriesFor = require("../dist/utils/pluralCategories").default;

test("plural categories follow CLDR per language", () => {
  assert.deepEqual(pluralCategoriesFor("en"), ["one", "other"]);
  assert.deepEqual(pluralCategoriesFor("de"), ["one", "other"]);
  assert.deepEqual(pluralCategoriesFor("pl"), ["one", "few", "many", "other"]);
  assert.deepEqual(pluralCategoriesFor("ru"), ["one", "few", "many", "other"]);
  assert.deepEqual(pluralCategoriesFor("ar"), [
    "zero",
    "one",
    "two",
    "few",
    "many",
    "other",
  ]);
  assert.deepEqual(pluralCategoriesFor("ja"), ["other"]);
});

test("categories are returned in CLDR order", () => {
  const order = ["zero", "one", "two", "few", "many", "other"];
  for (const lang of ["ar", "cy", "ga", "he", "pl", "ja"]) {
    const categories = pluralCategoriesFor(lang);
    const sorted = [...categories].sort(
      (a, b) => order.indexOf(a) - order.indexOf(b)
    );
    assert.deepEqual(categories, sorted, `${lang} is not in CLDR order`);
  }
});

test("regional and script tags resolve to their base language rules", () => {
  assert.deepEqual(pluralCategoriesFor("pt-BR"), ["one", "many", "other"]);
  assert.deepEqual(pluralCategoriesFor("zh-Hans"), ["other"]);
});

test("a malformed language tag falls back instead of throwing", () => {
  assert.deepEqual(pluralCategoriesFor("!!not-a-tag!!"), ["one", "other"]);
});

test("every language always includes the mandatory 'other' category", () => {
  for (const lang of ["en", "ja", "ar", "pl", "cy", "!!bad!!"]) {
    assert.ok(
      pluralCategoriesFor(lang).includes("other"),
      `${lang} is missing "other"`
    );
  }
});
