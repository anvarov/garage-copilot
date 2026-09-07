// NHTSA open-recall lookup.
//
// Public-domain data, no API key. This is the corpus policy working as intended:
// recalls are fetched LIVE rather than scraped and stored, so nothing
// copyrighted ends up in the database.
//
//   GET https://api.nhtsa.gov/recalls/recallsByVehicle?make=..&model=..&modelYear=..

import type Anthropic from "@anthropic-ai/sdk";

const ENDPOINT = "https://api.nhtsa.gov/recalls/recallsByVehicle";

/** How many recalls to hand back. A 2023 Model 3 has 12; some vehicles have far
 *  more, and nobody wants forty listed at them. `count` reports the true total
 *  so the model can say the list is truncated instead of implying it is whole. */
const MAX_RECALLS = 10;

/** NHTSA's shape: their casing, their field names, their date format. */
type NhtsaRecall = {
    NHTSACampaignNumber: string;
    Component: string;
    Consequence: string;
    Remedy: string;
    ReportReceivedDate: string;   // DD/MM/YYYY
    parkIt: boolean;
    parkOutSide: boolean;         // their spelling
    overTheAirUpdate: boolean;
};

type NhtsaResponse = {
    Count: number;
    Message: string;
    results: NhtsaRecall[];
};

/** Our shape: normalised names, ISO dates, only the fields worth spending
 *  prompt budget on. `Summary` is deliberately dropped — it is the longest
 *  field and overlaps heavily with Component + Consequence. */
export type Recall = {
    campaignNumber: string;
    component: string;
    consequence: string;
    remedy: string;
    reportedDate: string;   // ISO, YYYY-MM-DD
    parkIt: boolean;        // stop driving
    parkOutside: boolean;   // fire risk — do not park indoors
    otaUpdate: boolean;     // fixed by software, may already be applied
};

export type RecallLookup = {
    count: number;          // TRUE total, before capping
    recalls: Recall[];
};

/** DD/MM/YYYY -> YYYY-MM-DD.
 *
 *  Year first, hyphens, largest unit to smallest. Two payoffs:
 *  1. Nothing can misread it. "05/08/2026" is 5 August, but almost every reader
 *     and every model will call it May 8th — three months wrong on a safety
 *     recall, in an app whose whole claim is that it does not make things up.
 *  2. ISO strings sort chronologically under ordinary string comparison, so the
 *     sort below needs no date parsing at all. DD/MM/YYYY would compare the DAY
 *     first: "31/01/2020" would sort after "05/08/2026". Silently wrong. */
function toIso(ddmmyyyy: string): string {
    const [day, month, year] = ddmmyyyy.split("/");

    // `noUncheckedIndexedAccess` is on, so destructuring gives string | undefined
    // — TypeScript cannot know split() produced three parts, and it is right not
    // to assume. If NHTSA ever changes format, this throws loudly instead of
    // building a mangled date that then feeds the sort.
    if (!day || !month || !year) {
        throw new Error(`unexpected NHTSA date format: "${ddmmyyyy}"`);
    }

    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/** Rank for sorting. Booleans cannot be subtracted in TypeScript, and two
 *  separate flags leave the ordering implied rather than stated. */
function severity(r: Recall): number {
    if (r.parkIt) return 2;
    if (r.parkOutside) return 1;
    return 0;
}

export async function getRecalls(
    make: string,
    model: string,
    year: string,
): Promise<RecallLookup> {
    // encodeURIComponent on every interpolated value. `model` is "model 3" —
    // a raw space is not valid in a URL. Same habit as parameterising SQL:
    // never paste input into a string that something else has to parse.
    const url =
        `${ENDPOINT}?make=${encodeURIComponent(make)}` +
        `&model=${encodeURIComponent(model)}` +
        `&modelYear=${encodeURIComponent(year)}`;

    const res = await fetch(url);

    // Someone else's server on the public internet — unlike Postgres, this can
    // return an HTML error page with a 500. Without this check, res.json()
    // either throws something unhelpful or yields data.results === undefined,
    // and the .map below explodes one line later.
    if (!res.ok) {
        throw new Error(`NHTSA returned ${res.status} ${res.statusText}`);
    }

    // `as` is a CLAIM, not a check — nothing is verified at runtime. If NHTSA
    // renames a field tomorrow, TypeScript stays silent and this breaks at 2am.
    // Same trap as pool.query<RetrievedChunk> in retrieve.ts.
    const data = (await res.json()) as NhtsaResponse;

    // No `as Recall` here: the `: Recall[]` annotation is a real check. Adding
    // `as` would override it and let a misspelled field through in silence.
    const recalls: Recall[] = data.results.map((r) => ({
        campaignNumber: r.NHTSACampaignNumber,
        component: r.Component,
        consequence: r.Consequence,
        remedy: r.Remedy,
        reportedDate: toIso(r.ReportReceivedDate),
        parkIt: r.parkIt,
        parkOutside: r.parkOutSide,
        otaUpdate: r.overTheAirUpdate,
    }));

    // Sort BEFORE capping, or the cut is arbitrary — you could drop a
    // "stop driving, fire risk" recall and keep a font-size complaint.
    // Multi-key: compute key 1, return it if decisive, otherwise fall through.
    recalls.sort((x, y) => {
        const bySeverity = severity(y) - severity(x);   // severity, descending
        if (bySeverity !== 0) return bySeverity;
        return y.reportedDate.localeCompare(x.reportedDate);   // newest first
    });

    return { count: data.Count, recalls: recalls.slice(0, MAX_RECALLS) };
}

// Run directly:  npx tsx src/tools/nhtsa.ts
if (import.meta.filename === process.argv[1]) {
    const lookup = await getRecalls("tesla", "model 3", "2023");
    console.log(`${lookup.count} total, showing ${lookup.recalls.length}`);
    for (const r of lookup.recalls) {
        const flags = [
            r.parkIt && "PARK IT",
            r.parkOutside && "PARK OUTSIDE",
            r.otaUpdate && "OTA",
        ].filter(Boolean).join(" ");
        console.log(`${r.reportedDate}  ${r.campaignNumber}  ${r.component}  ${flags}`);
    }
}
export const tools: Anthropic.Tool[] = [
    { name: "NHTSA_call",
        description: "It should be used when user asks for open recalls, safety notices or wether their vehicle has known defects\
        based on the vehicle information get the latest recall information on vehicle",
        input_schema: {
            type: "object",
            properties: {
                "year": {
                    "type": "string",
                    "description": "Vehicle year, examples: 2023, 2021, 2001"
                },
                "make": {
                    "type": "string",
                    "description": "Vehicle make, examples tesla, Tesla, BMW, bmw"
                },
                "model": {
                    "type": "string",
                    "description": "Vehicle model, model 3, Model 3, MODEL 3"
                }
            },
            required: ["year", "make", "model"],
            additionalProperties: false,
        },
        strict: true,
    }
]