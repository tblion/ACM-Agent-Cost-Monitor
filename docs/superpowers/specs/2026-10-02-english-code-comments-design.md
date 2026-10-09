# English Code Comments and File Headers

## Goal

Set a consistent English-only standard for source-code comments and add useful file headers across maintained textual project files, making each file's purpose easier to understand without altering application behavior.

## Scope

- Include maintained textual source files, tests, scripts, and configuration files across the repository.
- Add a concise file-purpose header wherever the file format supports comments without invalidating the file.
- Add inline comments only when they clarify non-obvious intent, constraints, or behavior; do not restate the code.
- Exclude generated files, dependencies, build artifacts, binaries, lockfiles, and data/resource files where comments are unsupported or would corrupt the format.
- Preserve existing user changes and content, including the current local modifications to `AGENTS.md` and untracked documentation.

## Conventions

- All new or edited code comments and file headers must be written in English.
- Headers describe the file's responsibility; they do not include author names or dates.
- Use the native comment syntax for each supported format and keep structured data valid.
- Update the project `AGENTS.md` to state the English-comment convention and these annotation principles.

## Validation

- Review the diff to confirm comments are accurate, concise, and do not change runtime behavior.
- Run `npm run build` to check the renderer and TypeScript.
- Run a focused syntax/build validation for changed scripts or other supported project components where practical; C# tests remain disabled per project guidance.
