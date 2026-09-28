# Saving Powermove projects

- **Command+S** saves the current editable project as a `.pmv` file. The first save asks for a name and location. Later saves update that file, including after restarting Powermove.
- **Shift+Command+S** (File → Save Project As…) chooses a destination and builds a fresh, self-contained project file. Future saves use that destination. When a different destination is chosen, the original file is left alone. The fresh file contains current and Undo/Redo-reachable media, without unreachable records from earlier saves.
- **Command+O** opens a project file. Layers, animation, nested compositions, project notes, and embedded imported media remain editable. Opening a copy creates a separate local project so it cannot replace an existing tab accidentally.
- An unsaved dot on a project tab means the current edits are not in its project file. Hover the tab to see its file location. Local recovery does not clear that dot.
- Closing a project or quitting asks whether to Save, Cancel, or Don’t Save when needed. Cancelling either the prompt or the file picker keeps the document open. Don’t Save leaves the project file unchanged; the local recovery copy remains available in Projects.

Each replacement keeps the previous complete version in the app's Application Support `backups/<project id>/` folder, with the newest 5 versions retained after a successful save. You can open a backup with Command+O, then use Save As to give the recovered version its own `.pmv` name. Writes use a flushed temporary file followed by atomic publication. macOS saves use copy-on-write file clones where supported: the backup is independent, but unchanged data blocks do not need to be copied. Other volumes use ordinary copies. Both the file and directory are flushed; macOS requests `F_FULLFSYNC` where supported.

If a backup or write fails, Powermove reports the error and does not report the project saved. Files changed outside Powermove are checked before preparing the save and again before publication. On macOS, atomic exchange retains and verifies the displaced file before releasing it; a conflicting version is restored or preserved at a recovery path reported in the error. A failed private file-association update is repaired from a commit journal at next launch. If the project file was saved but local recovery storage subsequently fails, the app distinguishes those outcomes.

Project files embed imported media with **no application-imposed total size cap**. Native Save and Open transfer media in bounded chunks without assembling a whole-project buffer. Save writes directly into a temporary file beside the chosen destination, eliminating a separate upload spool. Available disk space and filesystem limits still apply; unsupported clone volumes need space for full staging and backup copies. Missing sources retain their editable references. Generated effects and panels still need their corresponding extensions installed on another computer.

Desktop Save writes the incremental **PMV4** format. Unchanged media keeps its existing byte ranges; only the new project/history snapshot, changed media, and a checksummed index are written into the cloned file. Media storage revisions change on every replacement, including same-size replacements; sampled import fingerprints are not used to prove that saved bytes are unchanged. Opening verifies the saved document and media checksums. Saving also retains whole-file external-change verification, so it still reads existing bytes even when it does not rewrite them.

Old snapshots and unreferenced media are compacted when their space exceeds both 16 MiB and half the retained media size. Compaction occurs inside the temporary file and retains media needed by Undo and Redo. Document JSON is parsed in memory and is limited to a 32-bit byte length; the separate PMV4 index is limited to 64 MiB and 100,000 media records. Legacy PMV3 and JSON files remain readable and upgrade on their next desktop save, with their previous version backed up. Older Powermove versions cannot read PMV4; the portable project export and browser save fallback continue to produce PMV3 for compatibility.

Local recovery remains in the app’s own storage and is separate from deliberate saves. Playing, seeking, selecting layers, and moving panels do not constitute project-file edits. Unsaved edits are retained locally for recovery, but a `.pmv` file changes only when you explicitly save it.

Native save/open/close handlers are installed at app launch. An already-running development session must be restarted with the user’s approval to activate changes to those handlers. Tests run only in the hidden Electron harness with a fresh temporary profile; native dialog decisions are substituted there while the actual file reads/writes and renderer commands run unchanged.

### Undo and redo persistence

Saved `.pmv` files and local project sessions retain the bounded project-edit
history and its current undo/redo position. Grouped agent edits remain a single
step, and the file includes media referenced only by history (for example, a
deleted image). Opening an older file without history starts a fresh timeline.
Session-only selection and interface callbacks are not included in the file.
