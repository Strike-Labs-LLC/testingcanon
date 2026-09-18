# File ownership

Canon records an owner for every file it writes in `.canon/flows/beta-9de674/manifest.json`.
The installer honours these rules, so reinstalling never destroys your work.

| Owner | Key | Rule |
| --- | --- | --- |
| Canon-managed | `canon` | Regenerated on every compile. Do not hand-edit; change the flow in Canon instead. |
| Merge-managed | `merge` | Canon owns the region between the canon:begin and canon:end markers. Everything outside the markers is yours and is preserved on reinstall. |
| User-managed | `user` | Written once as a starting point. Canon never overwrites it, so it is safe to edit. |

## Commands

| Task | Command |
| --- | --- |
| Preview an install | `node .canon/flows/beta-9de674/install.mjs --dry-run` |
| Install or update | `node .canon/flows/beta-9de674/install.mjs` |
| Accept Canon's version of conflicted files | `node .canon/flows/beta-9de674/install.mjs --force` |
| Verify the installation | `node .canon/flows/beta-9de674/verify.mjs` |
| See what removal would do | `node .canon/flows/beta-9de674/uninstall.mjs` |
| Remove Canon | `node .canon/flows/beta-9de674/uninstall.mjs --apply` |

Run the installer from the package root with the repository as `--target`, or copy the
package into the repository and run it there.
