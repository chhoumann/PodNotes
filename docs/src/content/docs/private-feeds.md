---
title: Use private feeds
slug: private-feeds
description: Add a paid or members-only podcast by its private feed address, use it on several devices, and keep the address out of your vault.
---

Listen to a paid or members-only podcast through the private RSS feed address your provider gives you. PodNotes keeps the private addresses it recognizes on each device, out of your synced vault, so you enter such an address once on each device.

## Add a private feed

1. Copy the private feed address from your podcast provider, such as your Supercast or Substack account.
2. In the PodNotes view, select **Add podcast**, paste the address into the search field, and select the one result. See [Add a podcast](/podcasts/#add-a-podcast).

PodNotes stores the address in Obsidian's secret storage on this device. Your vault, including PodNotes' `data.json`, holds a placeholder such as `podnotes-private-feed:Members%20Show` and a reference to the stored address. The addresses PodNotes recognizes are in [Which addresses PodNotes keeps private](/private-feeds/#which-addresses-podnotes-keeps-private).

PodNotes cannot sign in to providers that require a browser login. If PodNotes cannot store the address, it does not add the podcast, and a notice says so, such as `Could not store the private feed address for "Members Show" on this device.`

## Use a private feed on another device

The podcast syncs to your other devices, but its address does not. On each other device, enter the address once:

1. On a device that already has PodNotes, update it to 2.22.0 or later before you use PodNotes there. An older PodNotes does not [merge changes](/sync/#changes-on-two-devices), so it can overwrite the library that sync brings.
2. Let your sync service bring your vault to the device. It must include PodNotes' plugin folder, as [What syncs](/sync/#what-syncs) describes. With Obsidian Sync, turn on **Active community plugin list** and **Installed community plugins** under **Vault configuration sync** on every device. On a new device, these two settings also bring PodNotes itself.
3. If PodNotes is still not on the device, install it. The podcast then appears on the device. Do not add it again from its address.
4. Copy the private feed address from your podcast provider, such as your Supercast account. PodNotes does not show the address, so copy it there again.
5. In the PodNotes view, open the podcast. Its page shows **Feed didn't load** and **Address not on this device**.
6. Select **Set feed address**. The podcast's menu, from its **Podcast options** button, has the same item. Setting the address needs a connection.
7. Paste the address into **Feed address**.
8. Select **Save**.

PodNotes stores the address on this device and loads the feed. From then on, the podcast and its timestamp links work on this device too.

PodNotes does not check that the address belongs to the same show, so paste the address of that podcast. If you try to add the podcast again from its address instead, a notice says, for example, `The private feed address for "Members Show" is not available on this device.` Use **Set feed address** instead.

## After you update to PodNotes 2.22.0

PodNotes 2.22.0 recognizes the hosts in [Private feed hosts](/private-feeds/#private-feed-hosts), for example a Supercast address such as `https://myshow.supercast.com/feed/abc123.rss`. The first time PodNotes 2.22.0 starts, it moves the address of each matching podcast out of `data.json` into secret storage and shows "Moved private feed URLs out of data.json." The podcast keeps working on that device.

Update PodNotes on every device first. An older PodNotes cannot load these podcasts, and because it does not [merge changes](/sync/#changes-on-two-devices), it can overwrite the changes from your other devices. Then, on each other device, enter the address of each moved podcast once with [Set feed address](/private-feeds/#use-a-private-feed-on-another-device).

Notes and links that you created before the update keep the address in their text. Those links still play on every device, because they hold the address itself. PodNotes does not rewrite them.

## Which addresses PodNotes keeps private

PodNotes keeps a feed address private when it has any of these:

- A user name or a password, as in `https://user:password@example.com/feed.rss`.
- A query parameter named `auth`, `token`, `key`, `secret`, `pass`, `password`, `apikey`, `api-key`, `api_key`, `access-token`, `access_token`, `sig`, `signature`, `jwt`, `credential`, or `credentials`, in any case.
- The private feed form of one of the hosts in [Private feed hosts](/private-feeds/#private-feed-hosts).

In these docs, a private feed is a feed with such an address. PodNotes does not recognize other addresses, even when they hold a token in the path, such as `https://example.com/feeds/a1b2c3/rss`, or when they use a provider's custom domain. Such an address stays in `data.json`, syncs to every device, and works there with no setup.

## Private feeds in notes and links

PodNotes keeps the address of a private feed that you added out of the notes it creates, as these rules describe:

- Episode notes, podcast notes, timestamps, and transcripts of a podcast you added use its placeholder instead. `{{feedurl}}` gives the placeholder, and links work on each device where you set the address.
- When an episode's description or other text quotes the address, PodNotes replaces it with the placeholder, as long as the address is on this device. It also finds the address in other spellings: with `http` instead of `https`, with `feed:` or `podcast:` before it, starting at the host without `https://`, with HTML character references such as `&amp;` or `&#58;`, or percent-encoded, as in a redirect link.
- An episode from a private feed that you have not added, such as one you opened from a link that holds the address, plays, but its notes get no link back to it. `{{feedurl}}` and `{{episodelink}}` are empty, the note has no `feedUrl` or `guid` property, and timestamps are plain text. To get links, add the podcast.

A link that holds the private address itself, such as one from before PodNotes 2.22.0, plays on every device. On a device where you set the address, it opens the podcast you added, and new timestamps from it use the placeholder.

## Move private feeds with settings and OPML files

- A settings file holds each private podcast with its reference, never its address, and replaces quoted copies of the address in the same spellings as notes. An address that PodNotes does not recognize stays in the file as it is. Settings files and copies of `data.json` from before the update keep what they held. After you import it on a device that has the addresses, the podcasts work. On any other device, use **Set feed address**, or import an OPML file that lists the podcasts.
- An OPML export holds each private feed's address in plain text, and a notice warns you. PodNotes exports a podcast whose address is not on this device with an empty address. Delete the OPML file after you import it elsewhere.
- An OPML import gives a private podcast its address back when this device lacks it and the file lists a private feed with the podcast's exact title.

See [Import and export](/import_export/).

## Limits of private feeds

- PodNotes moves private addresses out of `data.json` on the first start after an update, during a settings import, and when sync delivers a `data.json` that holds one. If it cannot store an address in secret storage then, the podcast works only until you restart Obsidian, and a notice says "Could not store the private feed address on this device." After the restart, use **Set feed address**.
- **Set feed address** accepts only an address from [Which addresses PodNotes keeps private](/private-feeds/#which-addresses-podnotes-keeps-private). For any other HTTP or HTTPS address, it says "Enter a private feed address." For an address that is not HTTP or HTTPS, it says "Enter the feed's http or https address." For a feed it cannot load, it says "Could not load the feed at that address." Offline, the page's button is turned off, and the menu item shows the notice "Setting a feed address needs a connection."
- When you remove a private podcast and add it again, it gets a new reference. Your other devices then need **Set feed address** again.
- When PodNotes starts on a `data.json` that no longer lists a private podcast, for example after your sync service brings back an older copy, it deletes this device's copy of that podcast's address. When the podcast comes back, use **Set feed address** again.
- A settings file from PodNotes 2.21.1 or earlier holds a private feed's placeholder without its reference, or the address itself for a host that 2.21.1 did not recognize, such as Supercast. After you import it, a podcast whose address the file held works at once. The others show **Address not on this device**, so set their addresses with **Set feed address**. Either way, the podcast gets a new reference, so your other devices need **Set feed address** again.

## Reference

### Private feed hosts

PodNotes recognizes these private feed addresses. A subdomain is any name that ends with a dot and the domain, such as `myshow.substack.com` for `substack.com`.

| Provider | Host | Private address |
| --- | --- | --- |
| Supercast | `supercast.com`, `supercast.tech`, or a subdomain | A path `/feed/<key>.rss`, or a path that starts with `/feeds/<token>` |
| Substack | `substack.com` or a subdomain | A path `/feed/podcast/<id>/private/<token>.rss` or `/feed/podcast/<id>/s/<id>/private/<token>.rss` |
| Supporting Cast | A subdomain of `supportingcast.fm` | A path `/content/<token>.rss` |
| Transistor | `subscribers.transistor.fm` | Any path below the host, such as `/a1b2c3` |
| Pinecast | `pinecast.com` | A path that starts with `/feed/<show>/sub/<subscriber>` |
| Captivate | `private.captivate.fm` | Any path below the host, such as `/a1b2c3` |
| RedCircle | `feeds.redcircle.com` | A path that starts with `/<id>/pf/<token>` |
| RedCircle | `api.podcache.net` | A path that starts with `/shows/<id>/pf/<token>` |
| Castos | A subdomain of `castos.com` | A `uuid` query parameter with a value |
