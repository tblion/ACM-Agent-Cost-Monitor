# Verifies the contents and launch behavior of the generated macOS disk image.
set -euo pipefail

shopt -s nullglob
dmgs=(release/ACM\ Agent\ Cost\ Monitor-*.dmg)
if [ "${#dmgs[@]}" -ne 1 ]; then
  printf 'Expected one DMG in release/, found %s.\n' "${#dmgs[@]}" >&2
  exit 1
fi

mount_point=$(mktemp -d "${TMPDIR:-/tmp}/ocv-dmg.XXXXXX")
install_root=$(mktemp -d "${TMPDIR:-/tmp}/ocv-applications.XXXXXX")
mounted=false
cleanup() {
  if [ "$mounted" = true ]; then hdiutil detach "$mount_point" >/dev/null 2>&1 || true; fi
  rm -rf "$install_root" "$mount_point"
}
trap cleanup EXIT

hdiutil attach -readonly -nobrowse -mountpoint "$mount_point" "${dmgs[0]}" >/dev/null
mounted=true
applications_alias=$(readlink "$mount_point/Applications")
if [ "$applications_alias" != "/Applications" ]; then
  printf 'DMG Applications alias points to %s instead of /Applications.\n' "$applications_alias" >&2
  exit 1
fi

source_app="$mount_point/ACM Agent Cost Monitor.app"
installed_app="$install_root/ACM Agent Cost Monitor.app"
run_packaged_e2e() {
  ELECTRON_EXECUTABLE_PATH="$installed_app/Contents/MacOS/ACM Agent Cost Monitor" \
    E2E_ELECTRON=true node e2e/run-playwright.mjs
}

ditto "$source_app" "$installed_app"
run_packaged_e2e
rm -rf "$installed_app"
ditto "$source_app" "$installed_app"
run_packaged_e2e
rm -rf "$installed_app"
if [ -e "$installed_app" ]; then
  printf 'DMG app removal left an application bundle behind.\n' >&2
  exit 1
fi
