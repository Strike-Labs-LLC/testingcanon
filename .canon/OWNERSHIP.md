# File ownership

Canon records an owner for every file it writes in `.canon/manifest.json`.
The installer honours these rules, so reinstalling never destroys your work.

| Owner | Key | Rule |
| --- | --- | --- |
| Canon-managed | `canon` | Regenerated on every compile. Do not hand-edit; change the flow in Canon instead. |
| Merge-managed | `merge` | Canon owns the region between the canon:begin and canon:end markers. Everything outside the markers is yours and is preserved on reinstall. |
| User-managed | `user` | Written once as a starting point. Canon never overwrites it, so it is safe to edit. |

## Commands

| Task | Command |
| --- | --- |
| Preview an install | `node .canon/install.mjs --dry-run` |
| Install or update | `node .canon/install.mjs` |
| Accept Canon's version of conflicted files | `node .canon/install.mjs --force` |
| Verify the installation | `node .canon/verify.mjs` |
| See what removal would do | `node .canon/uninstall.mjs` |
| Remove Canon | `node .canon/uninstall.mjs --apply` |

Run the installer from the package root with the repository as `--target`, or copy the
package into the repository and run it there.
