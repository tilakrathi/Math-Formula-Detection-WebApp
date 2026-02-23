/*
  Fetch formulas from Wikidata (CC0) using the public SPARQL endpoint
  and write them into data/formulas.json.

  Why Wikidata?
  - Open license (CC0)
  - Large, well-curated knowledge base

  Usage:
    node scripts/fetch-wikidata-formulas.mjs

  Notes:
  - We fetch items that have a "defining formula" (P2534).
  - This will include a mix of identities, definitions, and relations.
*/

import fs from "node:fs";
import path from "node:path";

const OUT_PATH = path.join(process.cwd(), "data", "formulas.json");

const LIMIT = Number.parseInt(process.env.MFD_WD_LIMIT || "800", 10);

const query = `
SELECT ?item ?itemLabel ?formula WHERE {
  ?item wdt:P2534 ?formula .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT ${LIMIT}
`;

function normalizeForKey(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\\/g, "")
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9+\-*/=^_(){}\[\].,|]/g, "");
}

async function fetchSparql(queryText) {
  const url = new URL("https://query.wikidata.org/sparql");
  url.searchParams.set("format", "json");
  url.searchParams.set("query", queryText);

  const res = await fetch(url, {
    headers: {
      "accept": "application/sparql-results+json",
      "user-agent": "math-formula-detection-webapp/1.0 (educational project)"
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Wikidata query failed: HTTP ${res.status}\n${body.slice(0, 400)}`);
  }

  return res.json();
}

function toEntry(itemLabel, formula) {
  const name = String(itemLabel || "").trim();
  const tex = String(formula || "").trim();

  return {
    name: name || "Wikidata formula",
    formula: tex,
    category: "Wikidata",
    description: "Imported from Wikidata (property P2534: defining formula).",
  };
}

function stableSortByName(entries) {
  return entries.slice().sort((a, b) => a.name.localeCompare(b.name));
}

async function main() {
  console.log(`Fetching up to ${LIMIT} formulas from Wikidata…`);

  const json = await fetchSparql(query);
  const bindings = json?.results?.bindings || [];

  /** @type {any[]} */
  const fetched = [];
  for (const b of bindings) {
    const label = b?.itemLabel?.value;
    const formula = b?.formula?.value;
    if (!formula) continue;
    fetched.push(toEntry(label, formula));
  }

  // Merge with existing DB (if present)
  /** @type {any[]} */
  let existing = [];
  if (fs.existsSync(OUT_PATH)) {
    try {
      existing = JSON.parse(fs.readFileSync(OUT_PATH, "utf8"));
      if (!Array.isArray(existing)) existing = [];
    } catch {
      existing = [];
    }
  }

  const seen = new Set();
  const merged = [];

  for (const e of existing) {
    const key = `${normalizeForKey(e?.name)}|${normalizeForKey(e?.formula)}`;
    if (!key || key === "|") continue;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(e);
  }

  for (const e of fetched) {
    const key = `${normalizeForKey(e.name)}|${normalizeForKey(e.formula)}`;
    if (!key || key === "|") continue;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(e);
  }

  const finalDb = stableSortByName(merged);
  fs.writeFileSync(OUT_PATH, JSON.stringify(finalDb, null, 2) + "\n", "utf8");

  console.log(`Done. Wrote ${finalDb.length} formulas to ${OUT_PATH}`);
  console.log(`(Added ${finalDb.length - existing.length} new entries; fetched ${fetched.length}.)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
