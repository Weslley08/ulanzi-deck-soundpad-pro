# Store listing

Text and art for the Ulanzi marketplace form. Generate the art with `npm run build:assets`. **Nothing here has been submitted.** Submitting, and making the repository or a release public, waits for the maintainer.

Before each submission, read the current guidelines and the form again, because they change. Sources used here: `bbs.ulanzistudio.com/thread-23-1-1.html` and `thread-464-1-1.html`, through the `ulanzi-plugin` skill. The store's terms of use have not been read.

## Files

| Field | File | Size |
|---|---|---|
| Main work file | `dist/com.ulanzi.soundpadpro.ulanziPlugin.zip` | 50 MB at most |
| Cover | `store/cover-2x1.png` or `store/cover-1x1.png` | The guide contradicts itself on 2:1 and 1:1, so check the form |
| Banner 01 | `com.ulanzi.soundpadpro.ulanziPlugin/assets/banners/banner-1.png` | 1098×732, 3:2 |

## Fields

- **Name:** Soundpad Controller
- **Author:** the organization name registered on the marketplace (replace the login e-mail the form fills in)
- **Category:** Soundpad Controller
- **Additional link:** https://github.com/Weslley08/ulanzi-deck-soundpad-pro

**Summary (300 characters at most):** the `Description` in `manifest.json`.

**Details (1000 characters at most):** the `Detail` in `manifest.json`.

## Before submitting

- [ ] **The name.** Guideline 1.2 forbids infringing others' trademarks, and "Soundpad" is Leppsoft's product name. "Soundpad Controller" says what the plugin works with and states it is not affiliated, but review may still refuse it. Decide with the maintainer, and consider asking Leppsoft.
- [ ] **The UUID** `com.ulanzi.soundpadpro.ulanziPlugin` was chosen by the maintainer. Guideline 1.3 asks for the author's organization name in it, and `com.ulanzi.` is Ulanzi's own namespace, so review may refuse it. It can never change after publishing.
- [ ] The status note at the top of the main README is removed
- [ ] No plugin with this name exists on the marketplace
- [ ] The store's terms of use were read
- [ ] [docs/VERIFY.md](../docs/VERIFY.md) passed on a real device with Soundpad
- [ ] `npm run verify:package` passes, and the Auto check panel on the form is all green
- [ ] The OS compatibility on the form says Windows only
- [ ] Copyright lines are on the store page or the repository, not in the settings panel

## Community Store

Clima Pro is listed on the unofficial [Ulanzi Community Store](https://ulanzicommunitystore.narlei.com), which reads `store.json` and `en.json` from the default branch and the release marked `latest`. Once listed, every release marked `latest` reaches its users as an update with no further review. This plugin is not listed there. The store shows `longDescription` only in languages the plugin has no file for; this plugin has `pt_BR.json`, so in Portuguese it shows that file's `Description`.
