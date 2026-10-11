---
title: Import and export
slug: import_export
description: Import podcasts from OPML, export them to OPML, and back up or move your PodNotes settings.
---

Move your podcasts between PodNotes and other podcast apps with OPML files, and back up or move your PodNotes setup with a settings file.
All of these controls are in **Settings → PodNotes**.

## <span id="importing"></span>Import podcasts from OPML

Most podcast apps, such as Pocket Casts, can export your subscriptions as an OPML file.

1. In your other podcast app, export your subscriptions as an OPML file.
2. In **Settings → PodNotes**, under **Import/Export**, select **Import** next to **Import OPML**.
3. Select the `.opml` file.

PodNotes fetches each feed and adds it to your podcasts.
A notice shows the progress, then how many podcasts it saved.
PodNotes skips podcasts you already have, matched by feed URL or by title.
A feed that fails to load is not added, and a notice says how many failed.

## <span id="exporting"></span>Export podcasts to OPML

1. In **Settings → PodNotes**, under **Import/Export**, enter a file name next to **Export OPML**, or keep `PodNotes_Export.opml`.
2. Select **Export**.

PodNotes saves the file at the root of your vault.
To save it in a folder, include the folder in the name, such as `Exports/PodNotes_Export.opml`. The folder must exist.
PodNotes never overwrites a file. If the name is taken, the export fails, so choose another name.

The OPML file contains the real feed URLs, private feed URLs included.
Delete it after you import it into the other app.

## <span id="settings-templates"></span><span id="settings--templates"></span>Back up or move your settings

A settings file copies your PodNotes setup to another vault, or keeps a backup of it.
The controls are under **Preferences & templates** in **Settings → PodNotes**.

A settings file includes:

- Your preferences.
- Your note, feed note, timestamp, transcript, and download templates and paths.
- Your saved podcasts.
- Your queue, favorites, and playlists.

It leaves out playback progress, played status, downloads, and the current episode.
It leaves out your API keys unless you turn on **Include API keys**.

### <span id="exporting-settings"></span>Export your settings

1. In **Settings → PodNotes**, under **Preferences & templates**, enter a file name next to **Export settings**, or keep `PodNotes_Settings.json`.
2. To include your OpenAI and Deepgram API keys, turn on **Include API keys**. Read [API keys in a settings file](#api-keys-in-a-settings-file) first.
3. Next to **Export settings**, select **Export**.

PodNotes saves the file in your vault and never overwrites an existing file. If the name is taken, choose another name.

### <span id="importing-settings"></span>Import your settings

1. In **Settings → PodNotes**, under **Preferences & templates**, select **Import** next to **Import settings**.
2. Select the settings file.
3. In **Import PodNotes settings?**, select **Import**.

The import replaces your preferences, templates, saved podcasts, and playlists with the ones in the file.
Your playback progress and downloads stay.

PodNotes imports files from **Export settings**, files from older PodNotes versions, and a copy of `data.json`.
If a newer PodNotes version wrote the file in a newer format, PodNotes rejects it and asks you to update.
An import also sets the current speed and volume to the imported **Default Playback Rate** and **Default Volume**.

### API keys in a settings file

With **Include API keys** on, the file contains your OpenAI and Deepgram API keys in plain text, in a separate `secrets` section.
The file sits in your vault, so it can sync to other devices, and other plugins can read it.
Keep the file private, and delete it when you no longer need it.

- **Include API keys** turns off again each time you open the settings.
- The export includes only the keys you set. If a selected key is missing on this device, the export stops with a notice. Select or create the key under **Transcripts** in **Settings → PodNotes**, then export again.
- An import without keys keeps the keys already selected in the destination vault.
- When a file contains keys, the import confirmation names them. PodNotes saves each key to Obsidian's secret storage for this vault on this device. It never overwrites an existing secret, and saves a conflicting key under a new name instead.
- Imported keys exist only on this device. On another device, import the file again, or set the keys there.
- Settings files from older PodNotes versions, and older copies of `data.json`, can contain plain-text keys. PodNotes moves them to secret storage when you import the file.
