---
title: Fix save problems
slug: save-problems
description: Find out what each PodNotes save notice means, whether you lost anything, and how to make PodNotes save again.
---

Find the notice that PodNotes showed in the sections below. Each section says what happened, whether you lost anything, and how to make PodNotes save your library to `data.json` again.

Obsidian does not show its configuration folder. On a computer, find `data.json` with your system's file manager, with hidden files shown, and open it in a text editor. On a phone, use a file manager app that can open the vault folder.

## PodNotes could not save your changes

The write to `data.json` failed, or PodNotes could not read the file back after writing it. For example, the disk is full, the folder does not allow writes, or a sync service replaced the file with one that PodNotes cannot read.

PodNotes keeps your changes in memory and tries again every 10 seconds. The changes stay in memory while Obsidian stays open, even if the next notice says that PodNotes could not read the file. If you quit Obsidian before a save succeeds, the unsaved changes are lost.

PodNotes shows the notice once and gives no sign when a save succeeds. If the notice appears again after a while, saving failed again after it had worked.

To fix the cause, free disk space, and check that PodNotes may write to its plugin folder, `.obsidian/plugins/podnotes/`. If a sync service replaced the file, wait until sync finishes on every device. Keep Obsidian open until you have fixed it, so that your changes stay safe. Then check that saving works again:

1. In **Settings → PodNotes**, under **Playback**, set **Skip forward (s)** to a new value, such as 20. You can set it back once saving works.
2. Wait about 10 seconds.
3. Open `data.json` in a text editor.

The file should hold the new value, such as `"skipForwardLength": 20`, and end with a closing `}`. If your editor checks JSON, it should report no errors.

If the file still holds the old value, the cause is not fixed yet. Fix it and check again. If the notice that PodNotes could not read the file appears instead, see [PodNotes could not read data.json](/save-problems/#podnotes-could-not-read-datajson).

## PodNotes could not read data.json

The notice starts with "PodNotes could not read" and the file's path, such as `.obsidian/plugins/podnotes/data.json`. PodNotes leaves the file unchanged and saves nothing until it can read the file again. The usual cause is a sync service that is still writing the file. An earlier failed save can also leave the file unreadable. The notice stays on screen until PodNotes can read the file.

If the notice also says that PodNotes started with default settings, see [A read error at startup](/save-problems/#a-read-error-at-startup). Otherwise, the error happened while you used PodNotes.

### A read error during a session

Your changes stay in memory. PodNotes reads the file again every 10 seconds, and right after the file changes, whether or not you made changes. When PodNotes can read the file again, the notice closes, and PodNotes saves your library merged with the file. If you restart Obsidian before then, the changes in memory are lost.

To make PodNotes read the file again:

1. Wait until your sync service has finished writing the file on every device.
2. If the disk is full, free some space.
3. If the file named in the notice or its folder does not allow reads and writes, allow them.
4. Wait a few minutes. If the read notice is still there, go to [Write a new data.json](/save-problems/#write-a-new-datajson).

If the notice "PodNotes could not save your changes." came first, a failed save may have left the file incomplete. The read notice then usually stays until you write a new `data.json`.

#### Write a new data.json

Use these steps only as a last resort. They lose the changes that your other devices saved into the file since this device last read it.

On a phone, these steps need a file manager app that can open the vault folder. Keep Obsidian open while you get one, because a restart loses the changes in memory.

1. While Obsidian is open, rename the file, for example to `data.json.broken`.
2. Wait about 10 seconds. PodNotes writes a new `data.json` with your library from memory.
3. Keep Obsidian open, and open the new `data.json` in a text editor.

Check that the file ends with a closing `}`, and that it lists your podcasts under `"savedFeeds"`. If your editor checks JSON, it should report no errors. If the file passes these checks, PodNotes saved your library from memory, with your recent changes. Keep `data.json.broken` until you have checked your library on this device and your other devices, then delete it.

If the file is missing or empty, the write failed. Keep Obsidian open, and fix the cause, such as a full disk or a folder that does not allow writes. PodNotes tries again every 10 seconds. It shows its save-failure notice on the first failed write, and does not show it again until a save succeeds.

If the file is cut off, so that it does not end with `}`, the read notice returns. Fix the cause, then repeat steps 1 to 3 with another name, such as `data.json.broken2`.

### A read error at startup

The notice says that PodNotes started with default settings. PodNotes could not read the file when it started, so it has no library in memory. Changes you make before the file reads again are lost.

1. Replace the file with a readable backup, or let your sync service deliver a readable copy. When the file changes and PodNotes can read it, PodNotes loads it as your library, and saving resumes.
2. If the file could not be read because of its permissions, fix them, then turn PodNotes off and on again in **Settings → Community plugins**.
3. If the notice stays, restart Obsidian.

Do not rename or delete the file in this case, unless you want to start a new library.

## Older or newer data formats

If a synced `data.json` comes from a version of PodNotes before 2.18.0, a notice says that the file was replaced by a copy from an older version of PodNotes. PodNotes saves nothing until you restart Obsidian, which updates the file, so changes you make before the restart are lost. To fix it:

1. Update PodNotes on every device.
2. Let sync finish.
3. Restart Obsidian.

If a synced `data.json` arrives in a data format newer than this version of PodNotes reads, a notice says that the file was written by a newer version of PodNotes. PodNotes then stops saving and reading the file, and changes you make afterwards are lost. Update PodNotes on this device, and on every device that shares the vault.

If `data.json` is in a newer format when PodNotes starts, PodNotes does not start, and its notice says that the format requires a newer version of PodNotes. Update PodNotes on every device that shares the vault.

## Failed settings imports and API key choices

A failed settings import or API key choice shows its own notice, such as "Could not import PodNotes settings. The failed import was rolled back without overwriting newer changes." The notice says which settings PodNotes kept. Fix the save problem first, then import the file or choose the key again. PodNotes reads `data.json` again before it saves an import or a key choice, so you need no other change.

The notice "Imported PodNotes settings, but could not save them yet. PodNotes saves them once it can." means that the import worked. PodNotes saves it once the save problem is fixed. Keep Obsidian open until then.

If the notice says that the selected API key may no longer be available, PodNotes kept the previous selection. Under **Transcripts**, select another secret, or create one that holds the key. The notice can also mean that Obsidian could not store the selected key.

## Start a new library

To start over with an empty library:

1. Quit Obsidian.
2. Back up `data.json`.
3. Delete `data.json`.
4. Start Obsidian.

If you sync your vault, a device that still has the old library loaded combines it with the new one when sync delivers the new file. The old podcasts and progress then come back on every device.
