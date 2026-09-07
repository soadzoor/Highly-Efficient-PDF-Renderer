# Oracle baselines

Generated baselines live in a versioned child directory, currently
`pdfjs-6.1.200/`. They are deliberately not generated during install, build,
or test commands.

Run the repository's `oracle:write` command manually when the tracked corpus
or the pinned oracle intentionally changes. Review and commit the resulting
report, normalized text files, and PNGs together. The ordinary `oracle:compare`
command never modifies this directory.
