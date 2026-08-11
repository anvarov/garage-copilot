import { expect, test } from "vitest";
import { chunkText } from "./chunk.js";

test("returns nothing for empty text", () => {
  expect(chunkText("", 4, 1)).toEqual([]);
});

test("returns one chunk when text is shorter than size", () => {
  expect(chunkText("abc", 700, 100)).toEqual(["abc"]);
});

test("overlaps consecutive chunks", () => {
  expect(chunkText("abcdefghij", 4, 1)).toEqual(["abcd", "defg", "ghij"]);
});

test("throws when overlap is not smaller than size", () => {
  expect(() => chunkText("abcdef", 3, 3)).toThrow();
});