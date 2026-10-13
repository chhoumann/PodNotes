---
title: Fix save problems
slug: save-problems
description: What each PodNotes save notice means, whether you lose anything, and how to make PodNotes save again.
---

When PodNotes cannot save your library to `data.json`, it shows a notice. Find the notice below to learn what happened and what to do.

## PodNotes could not save your changes

The write to `data.json` failed, for example because the disk is full or the folder does not allow writes.

PodNotes keeps your changes in memory and tries again every 10 seconds. It shows the notice once and does not say when a save succeeds. If the notice appears again later, a save failed again. If you quit Obsidian before a save succeeds, the unsaved changes are lost.

To fix the cause, free disk space, and check that your vault folder allows writes.

## PodNotes could not read data.json

The notice starts with "PodNotes could not read" and the file's path, such as `.obsidian/plugins/podnotes/data.json`. PodNotes leaves the file unchanged and saves nothing until it can read the file again. A sync service that is still writing the file often causes this. The notice stays on screen until PodNotes can read the file.

### When the notice appears while you use PodNotes

Your changes stay in memory. While you have unsaved changes, PodNotes reads the file again every 10 seconds. When the file reads again, the notice closes, and PodNotes saves your changes merged with the file.

If you restart Obsidian now, the changes in memory are lost. If the notice stays, try these steps in order:

1. Let your sync service finish.
2. Check the free disk space and the permissions of the file named in the notice.
3. While Obsidian is open, rename the file, for example to `data.json.broken`. Within about 10 seconds, PodNotes writes your library again from memory, with your changes, and the notice closes.

### When the notice says PodNotes started with default settings

PodNotes could not read the file when it started, so it has no library in memory. Changes you make before the file reads again are lost.

1. Replace the file with a readable backup, or let your sync service deliver a readable copy. When the file changes and PodNotes can read it, PodNotes loads it as your library, and saving resumes with your next change.
2. If the notice stays, restart Obsidian.

Do not rename or delete the file in this case, unless you want to start a new library.

## data.json comes from an older or newer PodNotes

If a device with an older PodNotes syncs its `data.json`, a notice says that the file was replaced by a copy from an older version. PodNotes saves nothing until you restart Obsidian, which updates the file. Update PodNotes on every device, let sync finish, and restart Obsidian.

If `data.json` uses a data format that is newer than this version of PodNotes, PodNotes does not start, and its notice asks you to update. Update PodNotes on every device that shares the vault.

## A settings import or an API key fails to save

A failed settings import or API key choice shows its own notice, such as "Could not import PodNotes settings. The failed import was rolled back without overwriting newer changes." The notice says which settings PodNotes kept. Fix the save problem, then import the file or choose the key again.

## Start a new library

To start over with an empty library, quit Obsidian, back up and delete `data.json`, and start Obsidian again.
If you sync your vault, a device that still has the old library loaded combines it with the new one when sync delivers the new file, so the old podcasts and progress come back.
