import { expect, test } from "vitest";
import { parsePort } from "./config.js"

test("falls back to 3000 when unset or invalid", () => {
    expect(parsePort(undefined)).toBe(3000)
    expect(parsePort("")).toBe(3000)
    expect(parsePort("abs")).toBe(3000)
});

test("accepts a valid port", () => {
    expect(parsePort("3002")).toBe(3002)
})