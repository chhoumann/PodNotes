---
title: Import and export
slug: import_export
description: Import podcasts from OPML, export them to OPML, and back up or move your PodNotes settings.
---

Move your podcasts between PodNotes and other podcast apps with OPML files, and back up or move your PodNotes setup with a settings file.
All of these controls are in **Settings → PodNotes**.

## <span id="importing"></span>Import podcasts from OPML

1. In your other podcast app, such as Pocket Casts, export your subscriptions as an OPML file.
2. In **Settings → PodNotes**, under **Import/Export**, select **Import** next to **Import OPML**.
3. Select the `.opml` file.

PodNotes fetches each feed and adds it to your podcasts, and a notice reports how many it saved and how many failed to load. It skips podcasts you already have, matched by feed URL or by title.

## <span id="exporting"></span>Export podcasts to OPML

1. In **Settings → PodNotes**, under **Import/Export**, enter a file name next to **Export OPML**, or keep `PodNotes_Export.opml`.
2. Select **Export**.

PodNotes saves the file at the root of your vault. To save it in an existing folder, include the folder in the name, such as `Exports/PodNotes_Export.opml`. If the name is taken, the export fails, so choose another name.

The OPML file contains the real feed URLs, private ones included. Delete it after you import it into the other app.

## <span id="settings-templates"></span><span id="settings--templates"></span>Back up or move your settings

A settings file copies your PodNotes setup to another vault, or keeps a backup of it. It holds your preferences, your templates and paths, your saved podcasts, and your queue, favorites, and playlists. It leaves out playback progress, played status, downloads, and the current episode, and it holds your API keys only if you turn on **Include API keys**.

### <span id="exporting-settings"></span>Export your settings

1. In **Settings → PodNotes**, under **Preferences & templates**, enter a file name next to **Export settings**, or keep `PodNotes_Settings.json`.
2. To include your OpenAI and Deepgram API keys, turn on **Include API keys**. Read [API keys in a settings file](#api-keys-in-a-settings-file) first.
3. Next to **Export settings**, select **Export**.

PodNotes saves the file in your vault and never overwrites an existing file. If the name is taken, choose another name.

### <span id="importing-settings"></span>Import your settings

After an import, PodNotes cannot fetch your protected private feeds, the ones whose URL contains a user name, a password, or a token parameter such as `auth`. A settings file holds a placeholder instead of their URLs. The same holds when you import a backup or a copy of `data.json` with **Import settings**, even into the same vault. Before you import, keep a copy of their private URLs.

1. In **Settings → PodNotes**, under **Preferences & templates**, select **Import** next to **Import settings**.
2. Select the settings file.
3. In **Import PodNotes settings?**, select **Import**.
4. Under **Search Podcasts**, with the search box empty, select **Remove** next to each protected private feed.
5. Add each of those feeds again with its private URL, as described in [Add a podcast](/podcasts/#add-a-podcast).

The import replaces your preferences, templates, saved podcasts, and playlists, and keeps your playback progress and downloads. It also sets the current speed and volume to the imported **Default Playback Rate** and **Default Volume**.

PodNotes also imports settings files from older versions and a copy of `data.json`. It rejects a file in a newer format than this version supports and asks you to update.

### API keys in a settings file

With **Include API keys** on, the file contains your OpenAI and Deepgram API keys in plain text. The file sits in your vault, so it can sync to other devices, and other plugins can read it. Keep the file private, and delete it when you no longer need it.

- **Include API keys** turns off again each time you open the settings.
- If a selected key is missing on this device, the export stops with a notice. Select or create the key under **Transcripts**, then export again.
- An import saves the file's keys, including plain-text keys from older files, to secret storage on this device only. It never overwrites an existing secret, and an import without keys keeps the keys you selected.

See [API keys and private feeds on each device](/sync/#api-keys-and-private-feeds-on-each-device).
