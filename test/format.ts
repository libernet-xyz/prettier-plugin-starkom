// Copyright 2026 The Libernet Team
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

import { expect } from "chai";
import * as prettier from "prettier";

import plugin from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function format(source: string): Promise<string> {
  return prettier.format(source, {
    parser: "starkom",
    plugins: [plugin],
  });
}

describe("format", function () {
  for (const name of ["vitalik", "statements", "expressions"]) {
    it(name, async function () {
      const input = readFileSync(path.join(__dirname, `${name}.input.starkom`), "utf-8");
      const expected = readFileSync(path.join(__dirname, `${name}.output.starkom`), "utf-8");
      const result = await format(input);
      expect(result).to.equal(expected);
      expect(await format(result)).to.equal(expected);
    });
  }
});
