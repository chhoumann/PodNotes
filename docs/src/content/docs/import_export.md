---
title: Import and export
slug: import_export
description: Import podcasts from OPML, export them to OPML, and back up or move your PodNotes settings.
---

Move your podcasts between PodNotes and other podcast apps with OPML files, and back up or move your PodNotes setup with a settings file.
All of these controls are in **Settings → PodNotes**. **Import OPML** is also in the PodNotes view, when your library is empty and on the **Add podcast** page.

## <span id="importing"></span>Import podcasts from OPML

1. In your other podcast app, such as Pocket Casts, export your subscriptions as an OPML file.
2. In **Settings → PodNotes**, under **Library**, select **Import** next to **Import OPML**.
3. Select the `.opml` file.

PodNotes fetches each feed and adds it to your podcasts. A notice counts the podcasts while it works, then reports how many it saved and skipped. A second notice reports the feeds that failed to load. It skips podcasts you already have, matched by feed address or by title. A private podcast whose address is not on this device gets it back from a private feed in the file with the same title.

## <span id="exporting"></span>Export podcasts to OPML

1. In **Settings → PodNotes**, under **Library**, enter a file name next to **Export OPML**, or keep `PodNotes_Export.opml`.
2. Select **Export**.

PodNotes saves the file at the root of your vault. To save it in an existing folder, include the folder in the name, such as `Exports/PodNotes_Export.opml`. If the name is taken, the export fails, so choose another name.

The OPML file contains the real feed addresses, private ones included, and a notice reminds you of it. Delete the file after you import it into the other app. PodNotes exports a private podcast whose address is not on this device with an empty address.

## <span id="settings-templates"></span><span id="settings--templates"></span>Back up or move your settings

A settings file copies your PodNotes setup to another vault, or keeps a backup of it. It holds your preferences, your templates and paths, your saved podcasts, your queue, favorites, and playlists, and your playback progress and played status. It leaves out downloads, local files, and the current episode. It holds your API keys only if you turn on **Include API keys**, and it never holds the private feed addresses that PodNotes [recognizes](/private-feeds/#which-addresses-podnotes-keeps-private), not even quoted in an episode's text.

### <span id="exporting-settings"></span>Export your settings

1. In **Settings → PodNotes**, under **Import and export**, enter a file name next to **Export settings**, or keep `PodNotes_Settings.json`.
2. To include your OpenAI and Deepgram API keys, turn on **Include API keys**. Read [API keys in a settings file](#api-keys-in-a-settings-file) first.
3. Next to **Export settings**, select **Export**.

PodNotes saves the file in your vault and never overwrites an existing file. If the name is taken, choose another name.

### <span id="importing-settings"></span>Import your settings

1. In **Settings → PodNotes**, under **Import and export**, select **Import** next to **Import settings**.
2. Select the settings file.
3. In **Import PodNotes settings?**, read what the import replaces, and select **Import**.

The import replaces your preferences, templates, saved podcasts, playlists, queue, and favorites. It adds the file's playback progress for episodes that this vault has not played, and keeps this vault's own progress, downloads, and local files.
The player's volume changes to the imported volume at once. The imported **Default speed** applies when a different episode loads.
If PodNotes cannot save the import, a notice says which settings it kept, or that PodNotes saves them once it can. See [Fix save problems](/save-problems/#failed-settings-imports-and-api-key-choices).

Private feeds that PodNotes recognizes work on a device that already has their addresses. On another device, set each address with **Set feed address**, or import an OPML file that lists the feeds. See [Move private feeds with settings and OPML files](/private-feeds/#move-private-feeds-with-settings-and-opml-files).

PodNotes also imports settings files from older versions and a copy of `data.json`. It rejects a file in a newer format than this version supports and asks you to update.

### API keys in a settings file

With **Include API keys** on, the file contains your OpenAI and Deepgram API keys in plain text. The file sits in your vault, so it can sync to other devices, and other plugins can read it. Keep the file private, and delete it when you no longer need it.

- **Include API keys** turns off again each time you open the settings.
- If a selected key is missing on this device, the export stops with a notice. Select or create the key under **Transcripts**, then export again.
- An import saves the file's keys, including plain-text keys from older files, to secret storage on this device only. It never overwrites an existing secret, and an import without keys keeps the keys you selected.

See [API keys and private feeds on each device](/sync/#api-keys-and-private-feeds-on-each-device).
