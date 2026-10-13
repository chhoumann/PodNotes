---
title: Fix save problems
slug: save-problems
description: Find out what each PodNotes save notice means, whether you lost anything, and how to make PodNotes save again.
---

Find the notice that PodNotes showed in the sections below. Each section says what happened, whether you lost anything, and how to make PodNotes save your library to `data.json` again.

## PodNotes could not save your changes

The write to `data.json` failed, for example because the disk is full or the folder does not allow writes.

PodNotes keeps your changes in memory and tries again every 10 seconds. The changes stay in memory while Obsidian stays open, even if the next notice says that PodNotes could not read the file. If you quit Obsidian before a save succeeds, the unsaved changes are lost.

PodNotes shows the notice once and gives no sign when a save succeeds. If the notice appears again after a while, saving failed again after it had worked.

To fix the cause, free disk space, and check that PodNotes may write to its plugin folder, `.obsidian/plugins/podnotes/`. Keep Obsidian open until you have fixed it, so that your changes stay safe. Then check that saving works again:

1. In **Settings → PodNotes**, change any setting, such as **Skip forward length (s)** to 20.
2. Wait about 10 seconds.
3. Open `data.json` in a text editor. Obsidian does not show its configuration folder, so use your system's file manager, with hidden files shown. It should hold the new value, such as `"skipForwardLength": 20`, and end with a closing `}`. If your editor checks JSON, it should report no errors.

If the file still holds the old value, the cause is not fixed yet. PodNotes shows no new notice until a save succeeds, so fix the cause and check again. If the notice that PodNotes could not read the file appears instead, see [PodNotes could not read data.json](#podnotes-could-not-read-datajson).

## PodNotes could not read data.json

The notice starts with "PodNotes could not read" and the file's path, such as `.obsidian/plugins/podnotes/data.json`. PodNotes leaves the file unchanged and saves nothing until it can read the file again. The usual cause is a sync service that is still writing the file. An earlier failed save can also leave the file unreadable. The notice stays on screen until PodNotes can read the file.

If the notice also says that PodNotes started with default settings, see [A read error at startup](#a-read-error-at-startup). Otherwise, the error happened while you used PodNotes.

### A read error during a session

Your changes stay in memory. While you have unsaved changes, PodNotes reads the file again every 10 seconds. Without unsaved changes, it reads the file again when the file changes. When PodNotes can read the file again, the notice closes, and PodNotes saves your changes merged with the file. If you restart Obsidian before then, the changes in memory are lost.

If the notice "PodNotes could not save your changes." came first, a failed save may have left the file incomplete. Waiting for sync is unlikely to help then. Fix its cause, such as a full disk or a folder that does not allow writes. If the read notice is still there after you fixed the cause, go to [Write a new data.json](#write-a-new-datajson).

Otherwise, try these steps first:

1. Let your sync service finish.
2. Check the free disk space and the permissions of the file named in the notice.

If the notice still stays, go to [Write a new data.json](#write-a-new-datajson).

#### Write a new data.json

Use these steps only as a last resort. They lose the changes that your other devices saved into the file since this device last read it.

Obsidian does not show its configuration folder. On a computer, use your system's file manager, with hidden files shown. On a phone, use a file manager app that can open the vault folder. Without such an app, a phone cannot do these steps. Keep Obsidian open while you get one, because a restart loses the changes in memory.

1. While Obsidian is open, rename the file, for example to `data.json.broken`.
2. In **Settings → PodNotes**, change any setting, such as **Skip forward length (s)** to 20, so that PodNotes has a change to save. You can set it back once your library is saved. Because no file is there now, PodNotes can write again. Within about 10 seconds, it tries to write a new `data.json` with your library from memory.
3. Keep Obsidian open, and open the new `data.json` in a text editor.

Check that the file holds the setting you changed in step 2, such as `"skipForwardLength": 20`. Check that it ends with a closing `}`. If your editor checks JSON, it should report no errors. If all of this holds, PodNotes saved your library from memory, with your recent changes. Keep `data.json.broken` until you have checked your library on this device and your other devices, then delete it.

If the file is missing or empty, the write failed. Keep Obsidian open, and fix the cause, such as a full disk or a folder that does not allow writes. PodNotes tries again every 10 seconds. It shows its save-failure notice on the first failed write, and does not show it again until a save succeeds.

If the file is cut off, so that it does not end with `}`, the read notice returns. Fix the cause, then repeat steps 1 to 3 with another name, such as `data.json.broken2`.

### A read error at startup

The notice says that PodNotes started with default settings. PodNotes could not read the file when it started, so it has no library in memory. Changes you make before the file reads again are lost.

1. Replace the file with a readable backup, or let your sync service deliver a readable copy. When the file changes and PodNotes can read it as it is, PodNotes loads it as your library, and saving resumes with your next change.
2. If the notice stays, restart Obsidian.

Do not rename or delete the file in this case, unless you want to start a new library.

## Older or newer data formats

If a synced `data.json` uses an older data format, a notice says that the file was replaced by a copy from an older version of PodNotes. PodNotes saves nothing until you restart Obsidian, which updates the file, so changes you make before the restart are lost. To fix it:

1. Update PodNotes on every device.
2. Let sync finish.
3. Restart Obsidian.

If `data.json` uses a data format that is newer than this version of PodNotes, PodNotes does not start, and its notice asks you to update. Update PodNotes on every device that shares the vault.

## Failed settings imports and API key choices

A failed settings import or API key choice shows its own notice, such as "Could not import PodNotes settings. The failed import was rolled back without overwriting newer changes." The notice says which settings PodNotes kept. Fix the save problem first. If the notice asks you to change any setting, change one. Otherwise, import the file or choose the key again.

If the notice says that the selected API key may no longer be available, PodNotes kept the previous selection. Under **Transcripts**, select another secret, or create one that holds the key. The notice can also mean that Obsidian could not store the selected key.

## Start a new library

To start over with an empty library:

1. Quit Obsidian.
2. Back up `data.json`.
3. Delete `data.json`.
4. Start Obsidian.

If you sync your vault, a device that still has the old library loaded combines it with the new one when sync delivers the new file. The old podcasts and progress then come back on every device.
