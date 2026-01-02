# Repository Guidelines

## Project Structure & Module Organization
This repository is a small browser extension content script with all files at the root. `explorer.js` contains the runtime logic that parses the Colonist.io game log and renders the table. `styles.css` defines the injected table styles. `manifest.json` configures the extension and its content script injection. `icon64.png` is the extension icon. `compress.sh` creates a packaged zip for distribution.

## Build, Test, and Development Commands
There is no build system or package manager. Use `./compress.sh` to create `explorer.zip` for distribution. For local development, load the extension unpacked in Chrome (Extensions page, enable Developer mode, then “Load unpacked” and select the repo directory) and navigate to a Colonist.io game to exercise the content script.

## Coding Style & Naming Conventions
Keep JavaScript style consistent with `explorer.js`: function declarations, `var` declarations, semicolons, and 4-space indentation. Follow the existing naming mix: lowerCamel for functions (e.g., `renderPlayerCell`) and lower_snake_case for data structures where already used (e.g., `player_colors`). CSS class names use the `explorer-` prefix and kebab-case (e.g., `.explorer-tbl-row`); keep selectors and spacing aligned with `styles.css`.

## Testing Guidelines
There are no automated tests. Validate changes manually by loading the extension and confirming the table renders, updates on “got” messages, trades, and thefts, and does not duplicate or leave stale tables. Verify behaviour across a full game session since the log resets on refresh.

## Commit & Pull Request Guidelines
Recent commit history uses short, imperative, sentence-case messages (for example, `Add table design`). Keep commits focused on a single change. For pull requests, include a clear description and add a screenshot when UI behaviour or layout changes.

## Security & Configuration Tips
`manifest.json` scopes permissions to `https://colonist.io/*` and `https://hexs.io/*`; avoid broadening these without a clear need. Do not log sensitive player data beyond what is already visible in the game UI.
