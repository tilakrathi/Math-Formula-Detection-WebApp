/*
  Math Formula Detector (client-side only)

  - Loads local JSON DB (data/formulas.json)
  - Tokenizes user input (operators, functions, variables, concepts)
  - Builds an inverted index for fast retrieval
  - Renders formulas via KaTeX (fast TeX rendering)
*/

const KNOWN_FUNCTIONS = [
  "sin",
  "cos",
  "tan",
  "cot",
  "sec",
  "csc",
  "asin",
  "acos",
  "atan",
  "sinh",
  "cosh",
  "tanh",
  "log",
  "ln",
  "exp",
  "sqrt",
  "abs",
  "min",
  "max",
  "sum",
  "prod",
  "int",
  "integral",
  "frac",
];

const OPERATOR_SYMBOLS = ["+", "-", "*", "×", "/", "÷", "=", "^", "_", "(", ")", "[", "]", "{", "}", ","];

/** @typedef {{name: string, formula: string, category: string, description: string}} FormulaEntry */
/** @typedef {{entry: FormulaEntry, score: number, overlap: number, jaccard: number, matchType: string}} ScoredMatch */

/** @type {FormulaEntry[]} */
let formulasDb = [];

/**
 * @type {{
 *   entry: FormulaEntry,
 *   tokens: string[],
 *   tokenSet: Set<string>,
 *   categoryLower: string,
 *   normFormula: string
 * }[]}
 */
let dbCache = [];

/** @type {Map<string, number[]>} */
let tokenIndex = new Map();

/** @type {() => void} */
let runDetection = () => {};

/** @type {FormulaEntry | null} */
let activeTutorEntry = null;

const QUICK_EXAMPLES = [
  { label: "Pythagoras", tex: "a^2 + b^2 = c^2" },
  { label: "Quadratic", tex: "x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}" },
  { label: "Identity", tex: "\\sin^2(x) + \\cos^2(x) = 1" },
  { label: "Euler", tex: "e^{ix} = \\cos x + i\\sin x" },
  { label: "Derivative", tex: "\\frac{d}{dx}\\sin(x)=\\cos(x)" },
  { label: "Integral", tex: "\\int x^n \\, dx = \\frac{x^{n+1}}{n+1} + C" },
  { label: "Bayes", tex: "P(A\\mid B)=\\frac{P(B\\mid A)P(A)}{P(B)}" },
  {
    label: "Normal PDF",
    tex: "f(x)=\\frac{1}{\\sigma\\sqrt{2\\pi}}\\exp\\left(-\\frac{(x-\\mu)^2}{2\\sigma^2}\\right)",
  },
  { label: "Series", tex: "\\sum_{k=1}^{n} k=\\frac{n(n+1)}{2}" },
  { label: "Circle", tex: "(x-h)^2+(y-k)^2=r^2" },
  { label: "Law of Cos", tex: "c^2=a^2+b^2-2ab\\cos C" },
  {
    label: "Matrix inv",
    tex: "\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}^{-1}=\\frac{1}{ad-bc}\\begin{pmatrix}d&-b\\\\-c&a\\end{pmatrix}",
  },
];

function $(id) {
  return document.getElementById(id);
}

function debounce(fn, delayMs) {
  /** @type {number | undefined} */
  let t;
  return (...args) => {
    if (t) window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), delayMs);
  };
}

function preprocessMathString(input) {
  return String(input || "")
    .replace(/\u2212/g, "-")
    .replace(/[×·⋅]/g, "*")
    .replace(/[÷]/g, "/")
    .replace(/[∫]/g, "\\int")
    .replace(/[√]/g, "sqrt")
    .replace(/[π]/g, "pi")
    .replace(/[θ]/g, "theta")
    .replace(/[φ]/g, "phi")
    .replace(/[∞]/g, "infty");
}

function normalizeText(input) {
  return preprocessMathString(input)
    .toLowerCase()
    .replace(/\\/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForExactMatch(formula) {
  return preprocessMathString(formula)
    .toLowerCase()
    .replace(/\\/g, "")
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9+\-*/=^_(){}\[\].,|]/g, "");
}

function detectConceptTokens(raw) {
  const text = normalizeText(raw);
  /** @type {Set<string>} */
  const concepts = new Set();

  const hasTrig = /(\bsin\b|\bcos\b|\btan\b|\bcot\b|\bsec\b|\bcsc\b)/i.test(text);
  const hasLog = /(\blog\b|\bln\b)/i.test(text);
  const hasIntegral = /(\bint\b|\bintegral\b|\bintegration\b)/i.test(text);
  const hasDerivative = /(d\s*\/\s*dx|\bderivative\b|\\frac\{d\}\{dx\}|\\frac\{d\}\{d[a-z]\})/i.test(text);

  if (hasTrig) concepts.add("trigonometry");
  if (hasLog) concepts.add("logarithms");
  if (hasIntegral) concepts.add("integration");
  if (hasDerivative) concepts.add("derivatives");

  if (/(\bquadratic\b|\bsqrt\b|\broot\b|\bpoly\b|\bexp\b|\be\^)/i.test(text)) concepts.add("algebra");
  if (/(\btriangle\b|\bpythag\b|\bangle\b)/i.test(text)) concepts.add("geometry");

  if (hasTrig && /(=\s*1\b)/i.test(text)) concepts.add("identity");

  return [...concepts];
}

function tokenizeFormula(rawInput) {
  const raw = preprocessMathString(rawInput);
  const lower = raw.toLowerCase();

  /** @type {Set<string>} */
  const tokens = new Set();

  for (const op of OPERATOR_SYMBOLS) {
    if (lower.includes(op)) tokens.add(op);
  }

  const latexCmds = raw.match(/\\[a-zA-Z]+/g);
  if (latexCmds) {
    for (const cmd of latexCmds) tokens.add(cmd.replace(/^\\/, "").toLowerCase());
  }

  for (const fn of KNOWN_FUNCTIONS) {
    if (new RegExp(`\\b${fn}\\b`, "i").test(lower)) tokens.add(fn);
  }

  const varMatches = lower.match(/\b[a-z]\b/g);
  if (varMatches) {
    for (const v of varMatches) tokens.add(v);
  }

  const diffMatches = lower.match(/\bd[a-z]\b/g);
  if (diffMatches) {
    for (const d of diffMatches) tokens.add(d);
  }

  const numMatches = lower.match(/\b\d+(?:\.\d+)?\b/g);
  if (numMatches) {
    for (const n of numMatches) tokens.add(n);
  }

  for (const c of detectConceptTokens(raw)) tokens.add(c);

  return [...tokens].filter(Boolean);
}

function categorizeFromTokens(tokens) {
  const t = new Set(tokens);
  if (t.has("trigonometry") || t.has("sin") || t.has("cos") || t.has("tan")) return "Trigonometry";
  if (t.has("integration") || t.has("int") || t.has("integral")) return "Calculus";
  if (t.has("derivatives") || t.has("frac") || (t.has("d") && t.has("x"))) return "Calculus";
  if (t.has("logarithms") || t.has("log") || t.has("ln")) return "Algebra";
  if (t.has("geometry") || t.has("triangle")) return "Geometry";
  return "";
}

function buildDbIndex(entries) {
  dbCache = entries.map((entry) => {
    const tokens = tokenizeFormula([entry.formula, entry.name, entry.category, entry.description].filter(Boolean).join(" "));
    return {
      entry,
      tokens,
      tokenSet: new Set(tokens),
      categoryLower: String(entry.category || "").toLowerCase(),
      normFormula: normalizeForExactMatch(entry.formula),
    };
  });

  tokenIndex = new Map();
  for (let i = 0; i < dbCache.length; i++) {
    for (const t of dbCache[i].tokenSet) {
      if (!tokenIndex.has(t)) tokenIndex.set(t, []);
      tokenIndex.get(t).push(i);
    }
  }
}

function scoreCacheRecord(cacheRecord, queryTokenSet, qNorm, inferredCategory) {
  const entryTokenSet = cacheRecord.tokenSet;

  let overlap = 0;
  for (const t of queryTokenSet) {
    if (entryTokenSet.has(t)) overlap += 1;
  }

  const union = new Set([...queryTokenSet, ...entryTokenSet]).size;
  const jaccard = union ? overlap / union : 0;

  let score = overlap * 5 + jaccard * 70;

  const exact = qNorm && qNorm === cacheRecord.normFormula;
  if (exact) score += 160;

  const sameCategory =
    inferredCategory && cacheRecord.categoryLower === String(inferredCategory).toLowerCase();
  if (sameCategory) score += 18;

  const qText = normalizeText(qNorm);
  const nameText = normalizeText(cacheRecord.entry.name);
  if (qText && nameText && nameText.includes(qText)) score += 10;

  let matchType = "Similar";
  if (exact) matchType = "Exact";
  else if (overlap >= 4 || jaccard >= 0.18) matchType = "Strong";
  else if (sameCategory) matchType = "Same category";

  return { score, overlap, jaccard, matchType };
}

function renderTokens(tokens) {
  const list = $("tokensList");
  list.innerHTML = "";

  if (!tokens.length) {
    const empty = document.createElement("div");
    empty.className = "smallText";
    empty.textContent = "No tokens yet. Enter a formula and click Detect.";
    list.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const t of tokens) {
    const el = document.createElement("div");
    el.className = "token";
    el.textContent = t;
    el.setAttribute("role", "listitem");
    frag.appendChild(el);
  }
  list.appendChild(frag);
}

function renderKatex(el, tex, displayMode) {
  if (!el) return;

  const katexApi = window.katex;
  if (!katexApi || typeof katexApi.render !== "function") {
    el.textContent = String(tex || "");
    return;
  }

  try {
    katexApi.render(String(tex || ""), el, {
      displayMode: Boolean(displayMode),
      throwOnError: false,
      strict: "ignore",
      trust: false,
    });
  } catch {
    el.textContent = String(tex || "");
  }
}

function formatTime(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function addTutorMessage(role, text) {
  const host = $("tutorMessages");
  if (!host) return;

  const msg = document.createElement("div");
  msg.className = `msg ${role}`;

  const meta = document.createElement("div");
  meta.className = "msgMeta";

  const who = document.createElement("span");
  who.textContent = role === "user" ? "You" : "Tutor";

  const when = document.createElement("span");
  when.textContent = formatTime(Date.now());

  meta.appendChild(who);
  meta.appendChild(when);

  const body = document.createElement("div");
  body.className = "msgBody";
  body.textContent = String(text || "");

  msg.appendChild(meta);
  msg.appendChild(body);
  host.appendChild(msg);
  host.scrollTop = host.scrollHeight;
}

function setTutorContext(entry) {
  activeTutorEntry = entry;

  const ctx = $("tutorContext");
  if (!ctx) return;

  const title = ctx.querySelector(".tutorContextTitle");
  const formulaBox = ctx.querySelector(".tutorContextFormula");

  if (!entry) {
    if (title) title.textContent = "No formula selected";
    if (formulaBox) formulaBox.textContent = "";
    return;
  }

  if (title) title.textContent = `${entry.name} • ${entry.category || ""}`.trim();
  if (formulaBox) {
    formulaBox.innerHTML = "";
    const inner = document.createElement("div");
    formulaBox.appendChild(inner);
    renderKatex(inner, entry.formula, true);
  }
}

function guessVariables(tex) {
  const text = normalizeText(tex);
  const vars = new Set((text.match(/\b[a-z]\b/g) || []).filter(Boolean));
  const common = ["x", "y", "a", "b", "c", "r", "n", "t", "u", "v", "p", "q"];
  const ordered = [];
  for (const v of common) if (vars.has(v)) ordered.push(v);
  for (const v of vars) if (!ordered.includes(v)) ordered.push(v);
  return ordered.slice(0, 8);
}

function relatedFormulasFor(entry) {
  if (!entry) return [];
  const tokens = tokenizeFormula([entry.formula, entry.name, entry.category, entry.description].filter(Boolean).join(" "));
  const matches = retrieveMatches(entry.formula, tokens);
  return matches
    .filter((m) => m.entry && m.entry.name !== entry.name)
    .slice(0, 3)
    .map((m) => m.entry.name);
}

function tutorAnswer(userText) {
  const q = String(userText || "").trim();
  if (!q) return "";

  if (!activeTutorEntry) {
    return "Click a result card first, then ask me about that formula.";
  }

  const entry = activeTutorEntry;
  const qLower = q.toLowerCase();
  const wantsExample = /\b(example|numerical|numbers|sample)\b/.test(qLower);
  const wantsMeaning = /\b(meaning|mean|what is|explain|intuition|understand)\b/.test(qLower);
  const wantsUse = /\b(use|when|why|application|applied|where)\b/.test(qLower);
  const wantsVars = /\b(variable|symbol|what does .* mean|what is x|what is y)\b/.test(qLower);
  const wantsDerive = /\b(derive|derivation|prove|proof)\b/.test(qLower);

  const vars = guessVariables(entry.formula);
  const related = relatedFormulasFor(entry);

  let out = "";
  out += `Selected: ${entry.name} (${entry.category || "Uncategorized"})\n`;
  out += `Formula: ${entry.formula}\n\n`;

  if (wantsMeaning || (!wantsExample && !wantsUse && !wantsVars && !wantsDerive)) {
    out += `${entry.description ? entry.description : "This is a standard relationship/definition used in mathematics."}\n\n`;
  }

  if (wantsVars) {
    if (vars.length) {
      out += `Common symbols to watch for here: ${vars.map((v) => v.toUpperCase() === v ? v : v).join(", ")}\n`;
    } else {
      out += "This formula mostly uses standard constants/symbols; tell me which symbol you want defined.";
    }
    out += "\n";
  }

  if (wantsUse) {
    out += "Typical uses:\n";
    if ((entry.category || "").toLowerCase().includes("calculus")) {
      out += "- Simplify differentiation/integration steps\n- Solve rate/area/accumulation problems\n";
    } else if ((entry.category || "").toLowerCase().includes("trigon")) {
      out += "- Simplify trig expressions\n- Convert between angles/lengths in triangles\n";
    } else if ((entry.category || "").toLowerCase().includes("geometry")) {
      out += "- Compute lengths/areas/angles\n- Model shapes and coordinates\n";
    } else if ((entry.category || "").toLowerCase().includes("prob")) {
      out += "- Update/compute probabilities from given information\n";
    } else {
      out += "- Identify patterns and transform expressions\n";
    }
    out += "\n";
  }

  if (wantsDerive) {
    out += "Derivation/proof (offline tutor note):\n";
    out += "I can outline steps, but for a full proof it depends on prerequisites (definitions/axioms). Tell me your level (high school / first-year uni / advanced).\n\n";
  }

  if (wantsExample) {
    out += "Example idea:\n";
    const name = (entry.name || "").toLowerCase();
    if (name.includes("pythag")) {
      out += "- If a=3 and b=4, then c=5 because 3^2+4^2=5^2.\n";
    } else if (name.includes("quadratic")) {
      out += "- Plug your a,b,c into the formula to get two roots (±).\n";
    } else if ((entry.category || "").toLowerCase().includes("calculus")) {
      out += "- Pick a simple function and apply the rule step-by-step (e.g., for derivatives use f(x)=x^3).\n";
    } else {
      out += "- Substitute simple numbers for variables to check the relationship holds and to build intuition.\n";
    }
    out += "\n";
  }

  if (related.length) {
    out += `Related formulas you can explore: ${related.join(" • ")}`;
  }

  return out.trim();
}

function renderResults(matches, metaText) {
  const results = $("results");
  const meta = $("resultsMeta");

  meta.textContent = metaText || "";
  results.innerHTML = "";

  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "smallText";
    empty.textContent = "No matches found. Try a different expression (e.g., sin(x), a^2+b^2, \"integration x dx\").";
    results.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();

  for (const m of matches) {
    const e = m.entry;

    const card = document.createElement("article");
    card.className = "card";
    if (typeof m.idx === "number") card.dataset.idx = String(m.idx);

    const top = document.createElement("div");
    top.className = "cardTop";

    const title = document.createElement("h3");
    title.className = "cardTitle";
    title.textContent = e.name;

    const cat = document.createElement("div");
    cat.className = "cardCategory";
    cat.textContent = e.category;

    top.appendChild(title);
    top.appendChild(cat);

    const metaRow = document.createElement("div");
    metaRow.className = "cardMeta";

    const badgeType = document.createElement("div");
    badgeType.className = m.matchType === "Exact" ? "badge strong" : "badge";
    badgeType.textContent = `Match: ${m.matchType}`;

    const badgeScore = document.createElement("div");
    badgeScore.className = "badge";
    badgeScore.textContent = `Score: ${Math.round(m.score)}`;

    metaRow.appendChild(badgeType);
    metaRow.appendChild(badgeScore);

    const eq = document.createElement("div");
    eq.className = "equation";

    const eqInner = document.createElement("div");
    eq.appendChild(eqInner);
    renderKatex(eqInner, e.formula, true);

    const desc = document.createElement("p");
    desc.className = "desc";
    desc.textContent = e.description;

    card.appendChild(top);
    card.appendChild(metaRow);
    card.appendChild(eq);
    card.appendChild(desc);

    frag.appendChild(card);
  }

  results.appendChild(frag);
}

function toPreviewTex(rawInput) {
  const raw = String(rawInput || "").trim();
  if (!raw) return "";

  let s = preprocessMathString(raw);

  if (!/\\int\b/i.test(s) && /\bintegration\b|\bintegral\b/i.test(s)) {
    s = s.replace(/\bintegration\b|\bintegral\b/gi, "\\int");
  }

  return s;
}

function renderPreview(rawQuery) {
  const box = $("inputPreview");
  const status = $("previewStatus");
  if (!box) return;

  const tex = toPreviewTex(rawQuery);
  if (!tex) {
    if (status) status.textContent = "KaTeX";
    box.textContent = "Your rendered input will appear here.";
    return;
  }

  if (status) status.textContent = "Rendered";

  box.innerHTML = "";
  const inner = document.createElement("div");
  box.appendChild(inner);
  renderKatex(inner, tex, true);
}

function renderExampleChips() {
  const host = $("exampleChips");
  if (!host) return;

  host.innerHTML = "";
  const frag = document.createDocumentFragment();

  for (const ex of QUICK_EXAMPLES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chipBtn";
    btn.setAttribute("role", "listitem");
    btn.setAttribute("data-tex", ex.tex);

    const label = document.createElement("span");
    label.className = "chipLabel";
    label.textContent = ex.label;

    const tex = document.createElement("span");
    tex.className = "chipTex";
    tex.textContent = ex.tex;

    btn.appendChild(label);
    btn.appendChild(tex);
    frag.appendChild(btn);
  }

  host.appendChild(frag);
}

async function loadDatabase() {
  try {
    const res = await fetch("data/formulas.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("DB is not an array");

    formulasDb = data;
    buildDbIndex(formulasDb);

    // Refresh results now that the index is ready.
    runDetection();
  } catch {
    formulasDb = [];
    dbCache = [];
    tokenIndex = new Map();
  }
}

function retrieveMatches(rawQuery, tokens) {
  const query = rawQuery.trim();
  const qNorm = normalizeForExactMatch(query);
  const queryTokenSet = new Set(tokens);
  const inferred = categorizeFromTokens(tokens);

  /** @type {Set<number>} */
  const candidates = new Set();
  for (const t of queryTokenSet) {
    const ids = tokenIndex.get(t);
    if (!ids) continue;
    for (const id of ids) candidates.add(id);
  }

  const candidateList = candidates.size ? [...candidates] : dbCache.map((_, idx) => idx);

  /** @type {ScoredMatch[]} */
  const scored = [];
  for (const idx of candidateList) {
    const cacheRecord = dbCache[idx];
    if (!cacheRecord) continue;

    const { score, overlap, jaccard, matchType } = scoreCacheRecord(
      cacheRecord,
      queryTokenSet,
      qNorm,
      inferred
    );

    if (score > 0) {
      scored.push({ entry: cacheRecord.entry, idx, score, overlap, jaccard, matchType });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  const primary = [];
  for (const s of scored) {
    if (primary.length >= 9) break;
    primary.push(s);
  }

  return primary;
}

function wireUi() {
  const input = $("formulaInput");
  const detectBtn = $("detectBtn");

  const chipHost = $("exampleChips");
  const resultsHost = $("results");
  const tutorInput = $("tutorInput");
  const tutorSend = $("tutorSend");

  const run = () => {
    const query = input.value.trim();
    const tokens = tokenizeFormula(query);

    renderTokens(tokens);
    renderPreview(query);

    if (!query) {
      renderResults([], "");
      return;
    }

    const matches = retrieveMatches(query, tokens);
    const inferred = categorizeFromTokens(tokens);

    const meta = inferred ? `Showing ${matches.length} results (inferred: ${inferred})` : `Showing ${matches.length} results`;
    renderResults(matches, meta);
  };

  const runDebounced = debounce(run, 200);

  runDetection = run;

  detectBtn.addEventListener("click", run);
  input.addEventListener("input", runDebounced);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") run();
  });

  if (chipHost) {
    chipHost.addEventListener("click", (e) => {
      const target = e.target instanceof Element ? e.target.closest(".chipBtn") : null;
      if (!target) return;
      const tex = target.getAttribute("data-tex") || "";
      input.value = tex;
      input.focus();
      run();
    });
  }

  if (resultsHost) {
    resultsHost.addEventListener("click", (e) => {
      const card = e.target instanceof Element ? e.target.closest(".card") : null;
      if (!card) return;
      const idx = Number.parseInt(card.getAttribute("data-idx") || "", 10);
      if (!Number.isFinite(idx) || !dbCache[idx]) return;
      setTutorContext(dbCache[idx].entry);
      addTutorMessage("tutor", "Selected this formula. Ask me: what does it mean, when to use it, or give an example.");
    });
  }

  const sendTutor = () => {
    if (!tutorInput) return;
    const q = tutorInput.value.trim();
    if (!q) return;
    tutorInput.value = "";
    addTutorMessage("user", q);
    const a = tutorAnswer(q);
    if (a) addTutorMessage("tutor", a);
  };

  if (tutorSend) tutorSend.addEventListener("click", sendTutor);
  if (tutorInput) {
    tutorInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendTutor();
    });
  }

  renderTokens([]);
  renderResults([], "");
  renderPreview("");
  renderExampleChips();
  setTutorContext(null);
  addTutorMessage(
    "tutor",
    "Hi! Click a result card to select a formula, then ask me questions like: “What does this mean?” or “Give an example.”"
  );
}

(async function main() {
  wireUi();
  await loadDatabase();
})();
