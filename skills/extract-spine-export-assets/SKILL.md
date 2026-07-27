---
name: extract-spine-export-assets
description: "Extract, pair, rename, and verify Spine assets from Unity export folders. Use this skill whenever a user asks to整理、提取、归档 or 批量复制 Spine resources from Texture2D/TextAsset exports, including monster, character, NPC, boss, pet, effect, or other named PNG sets with matching .skel.asset and .atlas.asset files. It creates one directory per resource, renames copies to .skel and .atlas.txt, applies exclusions such as Low and _placeholder, and protects against missing pairs, duplicates, and accidental overwrites."
---

# Extract Spine Export Assets

Turn a Unity export into runtime-ready Spine resource directories without changing the source export. Treat the extension changes as copy-time renames, not data conversion.

## Output Contract

For a source stem such as `monster_3220`, create:

```text
<output-root>/monster_3220/
  monster_3220.png
  monster_3220.skel
  monster_3220.atlas.txt
```

Map files exactly as follows:

| Source | Destination |
| --- | --- |
| `Texture2D/<stem>.png` | `<output-root>/<stem>/<stem>.png` |
| `TextAsset/<stem>.skel.asset` | `<output-root>/<stem>/<stem>.skel` |
| `TextAsset/<stem>.atlas.asset` | `<output-root>/<stem>/<stem>.atlas.txt` |

Do not edit file contents. The atlas must already reference the selected PNG filename.

## Run the Workflow

1. Resolve the export root, output root, and requested resource naming rule from the user's paths and examples. Convert a prefix such as `monster_` to `monster_*`; keep a user-provided wildcard as written.
2. Inspect the output example when one is provided. Use it to confirm directory layout and suffixes, not to narrow the skill to that resource category.
3. Recursively inspect `Texture2D` and `TextAsset`. Report how many PNG files match, how many are excluded, and whether each selected stem has exactly one skeleton and one atlas.
4. Run the bundled script with `-DryRun`. It performs the full preflight without creating directories or files.
5. Resolve every reported conflict before writing. A missing or duplicate counterpart means the source selection is ambiguous; stop and report exact paths. Do not guess.
6. Run the same command without `-DryRun` after preflight succeeds.
7. Report the number of resource groups and files written or left unchanged. The script verifies SHA-256 hashes after copying.

Use the script from this skill directory:

```powershell
& '<skill-dir>\scripts\extract-spine-assets.ps1' `
  -ExportRoot 'C:\path\to\Export' `
  -NamePattern 'monster_*' `
  -OutputRoot 'I:\project\public\assets\spine_monster' `
  -DryRun
```

Then remove only `-DryRun` to perform the copy.

## Select Resources Deliberately

`-NamePattern` is required so an underspecified request cannot copy every exported texture. It accepts one or more PowerShell wildcard patterns:

```powershell
-NamePattern 'hero_*', 'npc_*'
```

The default exclusions are case-insensitive `*Low*` and `*_placeholder*`. Replace them only when the user gives different rules:

```powershell
-ExcludePattern '*Low*', '*_placeholder*', '*preview*'
```

The script searches recursively. Duplicate files with the same stem or duplicate matching TextAsset names are errors because path order is not a reliable selection rule.

If `Texture2D` and `TextAsset` are not direct children of the same export root, pass their locations explicitly:

```powershell
-TextureRoot 'C:\exports\textures' -TextAssetRoot 'C:\exports\text'
```

## Protect Existing Work

- Leave source files untouched.
- Preflight all resources before creating any target file. This prevents a missing pair late in the scan from producing a partial batch.
- Treat an existing destination with the same hash as `Unchanged`.
- Refuse to overwrite different destination content by default. Inspect the conflict and use `-Force` only when replacement is part of the user's request or has been confirmed.
- Preserve unrelated files already present in a resource directory. Never clean or delete a destination directory as part of extraction.
- Reject an output root located inside either source tree, which could make recursive scans consume generated output.
- Keep the default exclusions unless the user explicitly changes them.

## Interpret Failures

- `No PNG files matched`: verify the pattern, export root, and exclusions.
- `Missing skeleton` or `Missing atlas`: locate the intended TextAsset export; do not create placeholders.
- `Duplicate ... source`: show all duplicate paths and ask the user to choose the authoritative export when local evidence cannot decide.
- `Atlas does not reference`: the files do not form the expected one-PNG Spine set. Inspect the atlas for multiple pages or a different texture name before proceeding.
- `Destination differs`: compare source and target context. Rerun with `-Force` only after deciding that the source should replace the target.

## Report Results

Keep the handoff concrete: output path, selected stems or count, total verified file count, exclusion count, and any unchanged resources. Mention conflicts or skipped validation explicitly; do not claim success from copy completion alone.
