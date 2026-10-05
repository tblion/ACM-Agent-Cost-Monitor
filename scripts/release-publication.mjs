// Builds the GitHub CLI arguments for publishing a tagged release.
export function createReleaseArguments(tag, installers, repository) {
  const argumentsList = [
    "release",
    "create",
    tag,
    ...installers,
    "--repo",
    repository,
    "--title",
    tag,
    "--generate-notes",
  ];
  if (/^v\d+\.\d+\.\d+-/.test(tag)) argumentsList.push("--prerelease");
  return argumentsList;
}
