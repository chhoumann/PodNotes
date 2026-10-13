---
title: Fix save problems
slug: save-problems
description: Find out what each PodNotes save notice means, whether you lost anything, and how to make PodNotes save again.
---

Find out what a PodNotes save notice means, whether you lost anything, and how to make PodNotes save your library to `data.json` again. Find the notice below.

## PodNotes could not save your changes

The write to `data.json` failed, for example because the disk is full or the folder does not allow writes.

PodNotes keeps your changes in memory and tries again every 10 seconds. The changes stay in memory while Obsidian stays open, also if the next notice says that PodNotes could not read the file. If you quit Obsidian before a save succeeds, the unsaved changes are lost.

PodNotes shows the notice once and gives no sign when a save succeeds. If the notice appears again after a while, saving failed again after it had worked.

To fix the cause, free disk space, and check that your vault folder allows writes.

## PodNotes could not read data.json

The notice starts with "PodNotes could not read" and the file's path, such as `.obsidian/plugins/podnotes/data.json`. PodNotes leaves the file unchanged and saves nothing until it can read the file again. The usual cause is a sync service that is still writing the file. The notice stays on screen until PodNotes can read the file.

### A read error during a session

Your changes stay in memory. While you have unsaved changes, PodNotes reads the file again every 10 seconds. When the file reads again, the notice closes, and PodNotes saves your changes merged with the file.

If you restart Obsidian now, the changes in memory are lost. If the notice stays, try these steps in order:

1. Let your sync service finish.
2. Check the free disk space and the permissions of the file named in the notice.
3. While Obsidian is open, rename the file, for example to `data.json.broken`. Obsidian does not show its configuration folder, so on a computer, use your system's file manager.
4. Change any PodNotes setting, so that PodNotes has a change to save. Within about 10 seconds, PodNotes writes a new `data.json` with your library from memory. You can then change the setting back.
5. Before you quit Obsidian, check that the folder has a new `data.json`.

Steps 3 to 5 are a last resort. Changes that your other devices saved into the file since this device last read it are lost.

### A read error at startup

PodNotes could not read the file when it started, so it has no library in memory. Changes you make before the file reads again are lost.

1. Replace the file with a readable backup, or let your sync service deliver a readable copy. When the file changes and PodNotes can read it without repairs, PodNotes loads it as your library, and saving resumes with your next change.
2. If the notice stays, restart Obsidian.

Do not rename or delete the file in this case, unless you want to start a new library.

## Older or newer data formats

If a synced `data.json` uses an older data format, a notice says that the file was replaced by a copy from an older version of PodNotes. PodNotes saves nothing until you restart Obsidian, which updates the file. To fix it:

1. Update PodNotes on every device.
2. Let sync finish.
3. Restart Obsidian.

If `data.json` uses a data format that is newer than this version of PodNotes, PodNotes does not start, and its notice asks you to update. Update PodNotes on every device that shares the vault.

## Failed settings imports and API key choices

A failed settings import or API key choice shows its own notice, such as `Could not import PodNotes settings. The failed import was rolled back without overwriting newer changes.` The notice says which settings PodNotes kept, or asks you to change any setting to save again. Fix the save problem, then import the file or choose the key again.

## Start a new library

To start over with an empty library:

1. Quit Obsidian.
2. Back up `data.json`.
3. Delete `data.json`.
4. Start Obsidian.

If you sync your vault, a device that still has the old library loaded combines it with the new one when sync delivers the new file. The old podcasts and progress then come back on every device.
