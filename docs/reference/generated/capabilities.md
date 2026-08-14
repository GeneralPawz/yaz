<!--
  GENERATED FILE - DO NOT EDIT.
  Produced by scripts/generate-docs.mjs from the code it describes.
  Edit the source, not this page. See docs/adr/0016-documentation-strategy.md.
-->

# Capability reference

Every privileged thing a plugin can do. A plugin declares these in its
`manifest.json`; the user grants them at install and can revoke any of them
individually afterwards.

**The security boundary is the Rust process, not the JavaScript context.** These
constrain what leaves your machine and what touches your disk. They do *not*
isolate a plugin from the application's interface — a plugin sharing the DOM can
read the open document. That is by design and is stated plainly in
[the security policy](https://github.com/GeneralPawz/yaz/blob/main/SECURITY.md).

| Capability | What granting it allows | Sensitive |
| --- | --- | :---: |
| `fs:project` | Read and change files in this project. | no |
| `fs:read` | Read files at a specific location outside this project. | no |
| `fs:write` | Change files at a specific location outside this project. | yes |
| `net` | Connect to the internet, limited to the hosts it declares. | yes |
| `process` | Run programs on your computer: the binaries it declares. | yes |
| `zotero` | Read your Zotero library. | no |
| `obsidian` | Read your Obsidian vault. | no |
| `clipboard` | Read and change the clipboard. | no |
| `notifications` | Show desktop notifications. | no |
| `shell:open` | Open links and files with your other applications. | no |

"Sensitive" ones are emphasised in the install dialog. Network access is limited
to explicitly declared hosts — a wildcard is rejected at manifest validation,
because a capability that grants "the internet" is not a capability.

See [ADR-0006](/adr/0006-plugin-runtime-and-capabilities).
