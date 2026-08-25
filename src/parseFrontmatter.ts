// Splits a markdown file into its frontmatter block and its body.
//
//     ---
//     source_type: oem_service_manual
//     title: Front upper control arm replacement
//     ---
//
//     Raise the vehicle and support it on a lift...
//
// Everything between the fences becomes database columns; everything after
// becomes the text that gets chunked and embedded. Before this existed the
// whole file went into chunkText(), so the fences and the metadata were being
// embedded as if they were part of the procedure.
//
// This function deliberately does NOT know what keys are meaningful. It returns
// a bag of strings; mapping `source_type` onto DocumentMeta and rejecting a file
// with no title is ingestFile's job. A parser that knows the schema has to be
// edited every time the schema changes.

const FENCE = "---";

/** One `key: value` line, or null if there isn't a colon on it.
 *
 *  indexOf + two slices, NOT split(":"). A value like
 *  `https://service.tesla.com/docs/x` contains colons of its own, and
 *  split(":")[1] would hand back " https" and silently drop the rest. */
function parseLine(line: string): [string, string] | null {
    const idx = line.indexOf(":");
    if (idx === -1) return null;
    return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
}

export function parseFrontmatter(raw: string): {
    meta: Record<string, string>;
    body: string;
} {
    const lines = raw.split("\n");

    // No opening fence means no frontmatter. Not an error — a plain text file
    // is a legitimate input, it just arrives with no metadata of its own.
    // (`?.` because noUncheckedIndexedAccess types lines[0] as string|undefined,
    // and an empty string splits to [""], never an empty array.)
    if (lines[0]?.trim() !== FENCE) {
        return { meta: {}, body: raw };
    }

    // Find the CLOSING fence. Search the original array from index 1 — slicing
    // first would give an index into the copy, which is off by however much was
    // sliced away. trim() each line so "--- " with trailing whitespace matches.
    let fenceIdx = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i]?.trim() === FENCE) {
            fenceIdx = i;
            break;
        }
    }

    // An opening fence with no closing one is malformed, not empty. Throwing
    // here beats silently treating the entire document as metadata.
    if (fenceIdx === -1) {
        throw new Error("frontmatter opened with --- but never closed");
    }

    const meta: Record<string, string> = {};

    for (let i = 1; i < fenceIdx; i++) {
        const line = lines[i];
        if (line === undefined) continue;

        // Check the RESULT before unpacking it. `const [k, v] = parseLine(...)`
        // is a TypeError the first time a blank line appears in the block,
        // because you cannot destructure null. Once past this guard, `pair` is
        // a tuple of two plain strings — no further checking needed, which is
        // what the `| null` return type buys.
        const pair = parseLine(line);
        if (pair === null) continue;

        const [key, value] = pair;
        meta[key] = value;
    }

    // join("\n") — join() with no argument uses commas and would quietly
    // reassemble the document with the wrong line breaks.
    return { meta, body: lines.slice(fenceIdx + 1).join("\n").trim() };
}
