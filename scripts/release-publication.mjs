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

export function hasValidMacDmgArchitectures(dmgNames) {
  if (dmgNames.length !== 2) return false;

  const appleSiliconCount = dmgNames.filter(name => /arm64|aarch64/i.test(name)).length;
  const intelCount = dmgNames.filter(name => /x64|x86_64/i.test(name)).length;
  const unqualifiedCount = dmgNames.filter(name => !/arm64|aarch64|x64|x86_64/i.test(name)).length;

  return appleSiliconCount === 1
    && (intelCount === 1 && unqualifiedCount === 0 || intelCount === 0 && unqualifiedCount === 1);
}
