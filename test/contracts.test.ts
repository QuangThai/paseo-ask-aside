import assert from "node:assert/strict";
import { test } from "node:test";
import { readableError } from "../shared/contracts.ts";

test("readableError keeps only the messages of a rejected input", () => {
  const raw =
    'Request failed: [\n  {\n    "origin": "string",\n    "code": "too_big",\n    "maximum": 8000,\n    "path": ["question"],\n    "message": "Questions can be at most 8,000 characters."\n  }\n]';
  assert.equal(readableError(raw), "Questions can be at most 8,000 characters.");
});

test("readableError passes other messages through without the RPC prefix", () => {
  assert.equal(
    readableError("Request failed: A side question is still being answered. Stop it or wait for it to finish."),
    "A side question is still being answered. Stop it or wait for it to finish.",
  );
  assert.equal(readableError("[not json"), "[not json");
  assert.equal(readableError(""), "Something went wrong.");
});
