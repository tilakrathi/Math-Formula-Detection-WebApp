# Web Application for Mathematical Formula Detection and Retrieval (HTML5 + Vanilla JS)

A browser-based web application that detects mathematical formulas entered by users and retrieves related formulas using HTML5, JavaScript, and KaTeX rendering.

This version uses **KaTeX** for faster rendering.

## Features

- Mathematical formula input + “Detect Formula” action
- Live KaTeX preview while typing
- Detect-as-you-type (debounced) + Enter key support
- Token-based detection (operators, functions, variables, concepts)
- Retrieval of exact matches, similar formulas, and same-category formulas
- Dynamic results rendering (no page reload)
- Client-side only (no backend server)

## Tech Stack

- HTML5
- CSS3
- Vanilla JavaScript
- KaTeX (formula rendering)
- JSON (local formula storage)

## Project Structure

```
math-formula-detection-webapp/
├── index.html
├── style.css
├── script.js
├── data/
│   └── formulas.json
├── assets/
│   └── icons/
└── README.md
```

## How It Works (High Level)

1. User enters an expression (e.g., `a^2 + b^2`, `sin(x)`, `integration x dx`).
2. The app tokenizes the expression:
   - Operators: `+ - * / = ^ ( ) ...`
   - Functions: `sin cos log ln sqrt int ...`
   - Variables: single-letter identifiers like `x`, `y`
   - Concepts: inferred tags like `trigonometry`, `integration`, `derivatives`
3. The retrieval engine scores each DB entry by token overlap and category similarity.
4. Results are rendered with KaTeX.

## Run Instructions

### Option A (recommended): run with a tiny local static server

Some browsers block `fetch()` for local JSON files when opening `index.html` via `file://`.

Pick one of these:

- Node (recommended on Windows):
  - `npx --yes serve . -l 5173`
  - Then open: `http://localhost:5173/` (if the port is busy, `serve` will pick another one and print it)

- Python (if installed):
  - `python -m http.server 5173`
  - Then open: `http://localhost:5173/`

### Option B: open `index.html` directly

If you open the file directly, some browsers will block loading `data/formulas.json` via `fetch()`.
Run via Option A for reliable database loading.

## Customize the Database

Edit the JSON file at `data/formulas.json`.

### Import a public dataset (optional)

This repo includes an importer that pulls formulas from **Wikidata (CC0)** using the public SPARQL endpoint.

- Run: `node scripts/fetch-wikidata-formulas.mjs`
- Optional: set `MFD_WD_LIMIT=800` to control how many entries are fetched.

Imported items are tagged with category `Wikidata` and include the Wikidata “defining formula” property (P2534).

Schema:

```json
[
  {
    "name": "Pythagorean Identity",
    "formula": "\\sin^2(x) + \\cos^2(x) = 1",
    "category": "Trigonometry",
    "description": "Fundamental trigonometric identity"
  }
]
```

## GitHub-Ready Development Prompt

Use this prompt with GitHub Copilot / ChatGPT / GenAI tools to extend the project.

---

### Project Title

**Web Application for Mathematical Formula Detection and Retrieval Using HTML5 & JavaScript**

### Project Development Prompt

Build a **responsive web application** that detects mathematical formulas entered by users and retrieves related formulas using **HTML5, CSS3, and Vanilla JavaScript**.

The application should allow users to input mathematical expressions and dynamically display similar or related formulas from a predefined formula database stored locally in JSON format.

The system must run completely in the browser without requiring a backend server.

### Functional Requirements

#### 1. User Interface

- Clean, responsive UI
- Mathematical input textbox
- Search/Detect button
- Results display section
- Support mathematical symbol rendering using **MathJax or KaTeX**

#### 2. Formula Input

Users can enter formulas like:

```
a^2 + b^2
sin(x)
integration x dx
```

Then click **Detect Formula**.

#### 3. Formula Detection Engine

Implement JavaScript logic that:

- Parses input expressions
- Identifies operators (`+, −, ×, ÷`), functions (`sin, cos, log, ...`), variables
- Converts formula into searchable tokens

Example:

```
Input: sin(x) + cos(x)
Tokens: ["sin","cos","trigonometry"]
```

#### 4. Formula Database

Create a local JSON database containing:

- Formula name
- Mathematical expression
- Category
- Description

#### 5. Retrieval System

Develop matching logic that:

- Compares detected tokens with database entries
- Retrieves exact matches, similar formulas, and same-category formulas

#### 6. Result Display

- Render formulas using MathJax
- Show formula name, equation, category, explanation
- Update results dynamically without page reload

### Non-Functional Requirements

- Responsive design
- Fast client-side execution
- Cross-browser compatibility
- Modular JavaScript structure
- Clean folder organization

### Expected Output

- User enters a mathematical expression
- System detects formula structure
- Related formulas appear instantly
- Mathematical expressions render correctly
