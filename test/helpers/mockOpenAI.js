const http = require("http");

/**
 * A stand-in for the OpenAI chat completions endpoint.
 *
 * Records every request so tests can assert on the schema and the prompt that
 * was sent, and tracks how many requests were in flight at the same time.
 *
 * `respond(request)` may return:
 *   - an object      -> sent back as the JSON content of the completion
 *   - { status, body } via `respond.error` style objects (see `httpError`)
 *   - a promise of either
 */
async function startMockOpenAI(respond) {
  const requests = [];
  let inFlight = 0;
  let maxConcurrent = 0;

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", async () => {
      const payload = JSON.parse(raw);
      const schema = payload.response_format?.json_schema?.schema;
      const record = {
        model: payload.model,
        schema,
        properties: schema ? schema.properties : undefined,
        system: payload.messages
          .filter((m) => m.role === "system")
          .map((m) => m.content)
          .join("\n"),
        user: payload.messages[payload.messages.length - 1].content,
      };
      requests.push(record);

      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      let result;
      try {
        result = await respond(record);
      } finally {
        inFlight--;
      }

      if (result && result.__httpError) {
        res.writeHead(result.status, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({ error: { message: result.message } })
        );
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-mock",
          object: "chat.completion",
          model: payload.model,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: JSON.stringify(result) },
              finish_reason: "stop",
            },
          ],
        })
      );
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    get maxConcurrent() {
      return maxConcurrent;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Non-retryable by the OpenAI SDK, so failure tests stay fast. */
const httpError = (status, message) => ({
  __httpError: true,
  status,
  message,
});

/**
 * Fills every leaf of the requested JSON schema with a marker string so tests
 * can tell exactly which language/category a value was written for.
 */
function echoSchema(record) {
  const walk = (schema, path) => {
    if (schema.type === "string") return `[${path.join("/")}] ${record.user}`;
    return Object.fromEntries(
      Object.keys(schema.properties).map((key) => [
        key,
        walk(schema.properties[key], [...path, key]),
      ])
    );
  };
  return walk(record.schema, []);
}

module.exports = { startMockOpenAI, httpError, echoSchema };
