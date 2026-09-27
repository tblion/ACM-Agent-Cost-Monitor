# Open Source MIT Publication Design

## Scope

Prepare the current project for public open-source publication without changing its functional scope:

- License the project under MIT.
- Make the default README English and add a French translation.
- Keep the existing project files and behavior as the basis of the new initial commit.
- Use English for source-code comments.
- Keep French UI translations available.
- Use English as the fallback language when the system language is unsupported.
- Replace the Git history with one initial commit.
- Delete all local and remote tags and all GitHub releases.

## Repository Documentation

`README.md` becomes the canonical English documentation. `README.fr.md` contains the French translation. Both files link to each other near the top. Existing technical instructions, prerequisites, build commands, testing guidance, release guidance, configuration details, and project structure remain represented in both languages.

Add an MIT `LICENSE` file. Also declare `MIT` in the npm and Cargo package metadata so repository hosting services and package tooling identify the project license consistently.

## Language Behavior

The supported application languages remain French and English. English is the explicit fallback for missing, malformed, or unsupported system language values. A supported French system locale still selects French. Test-only browser locale configuration is not changed because it does not define the application's runtime default.

## Comments

Translate French explanatory comments and documentation comments in source and configuration files to English. Preserve compiler directives, test annotations, URLs, identifiers, string fixtures, and user-facing translations. Do not translate the existing French UI resource values except where required by the README split.

## Git and GitHub Publication

After file changes and validation:

1. Create a new root history containing the final working tree in one initial commit.
2. Remove all local tags.
3. Force-push the new `main` history to `origin`.
4. Delete all remote tags.
5. Delete every GitHub release for the repository.
6. Verify that the remote has one commit, no tags, and no releases.

These operations are intentionally destructive to the existing Git and GitHub publication history, as explicitly authorized by the project owner.

## Validation

Run the frontend build and the applicable frontend tests. Run the E2E suite if its local prerequisites are available. Verify the resulting files, language fallback behavior, license declarations, comments, Git history, remote tags, and GitHub releases before reporting completion.
