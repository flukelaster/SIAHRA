#!/usr/bin/env bash
# pr-media.sh — host PR screenshots as GitHub *release assets* (pure `gh`, no
# browser session and no third-party tooling) and print embeddable Markdown.
#
# Why release assets: GitHub has no token-callable image-upload API (drag-and-drop
# in the web UI is the only official route), and committing PNGs to the branch just
# to link them pollutes history. A release asset is uploadable with the ordinary
# `gh` token (no `user_session` cookie, no third-party binary that reads your
# browser credentials), renders in the PR body, and works whether the repo is
# public or private.
# Credit: https://mareksuppa.com/til/github-pr-images-from-cli/
#
# The release is a `--prerelease` tagged `primg-<branch>` so it never pollutes real
# releases; `.github/workflows/pr-image-cleanup.yml` deletes it (and the tag) when the
# PR closes. This repo doesn't otherwise use GitHub Releases, so nothing collides.
#
# Usage:
#   scripts/pr-media.sh <branch> <image> [image ...]
#     <branch>  the PR's head branch — the release tag derives from it so the cleanup
#               workflow can find it on PR close (slashes become dashes).
#
# Example:
#   scripts/pr-media.sh "$(git branch --show-current)" .playwright-cli/chiangmai.png
set -euo pipefail

die() { echo "pr-media: $*" >&2; exit 1; }

[ $# -ge 2 ] || die "usage: pr-media.sh <branch> <image> [image ...]"

branch="$1"; shift
[ -n "$branch" ] || die "branch must be non-empty"
command -v gh >/dev/null 2>&1 || die "gh not found"

repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)"
[ -n "$repo" ] || die "could not resolve owner/repo via gh"

for f in "$@"; do [ -f "$f" ] || die "no such file: $f"; done

# Reject duplicate basenames — release asset names must be unique.
dup="$(for f in "$@"; do basename "$f"; done | sort | uniq -d | head -1)"
[ -z "$dup" ] || die "duplicate basename '$dup' — rename so each is unique"

tag="primg-$(printf '%s' "$branch" | tr '/' '-')"

if gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
  gh release upload "$tag" "$@" --repo "$repo" --clobber >/dev/null \
    || die "failed to upload to existing release '$tag'"
else
  gh release create "$tag" "$@" --repo "$repo" --prerelease \
    --title "Screenshots — $branch" \
    --notes "Auto-generated image assets for the PR on \`$branch\`. Deleted when the PR closes (pr-image-cleanup.yml)." >/dev/null \
    || die "failed to create release '$tag'"
fi

# Map each input file to its asset's browser_download_url (works for anyone with repo
# access → renders in the PR body even on a private repo). Plain TSV + awk lookup so this stays
# compatible with macOS's stock bash 3.2 (no `declare -A` associative arrays).
asset_tsv="$(gh api "repos/$repo/releases/tags/$tag" \
               --jq '.assets[] | [.name, .browser_download_url] | @tsv')"

names=(); urls=()
for f in "$@"; do
  b="$(basename "$f")"
  u="$(printf '%s\n' "$asset_tsv" | awk -F'\t' -v n="$b" '$1 == n {print $2; exit}')"
  [ -n "$u" ] || die "asset '$b' missing from release '$tag' after upload"
  names+=("$b"); urls+=("$u")
done

echo "Hosted ${#urls[@]} image(s) on prerelease '$tag' (auto-deleted on PR close):"
for u in "${urls[@]}"; do echo "  $u"; done
echo
echo "Markdown (paste into the PR description):"
echo
for i in "${!urls[@]}"; do
  printf '![%s](%s)\n' "${names[$i]%.*}" "${urls[$i]}"
done
