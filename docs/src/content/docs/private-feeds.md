---
title: Use private feeds
slug: private-feeds
description: Add a paid or members-only podcast by its private feed address, use it on several devices, and keep the address out of your vault.
---

Listen to a paid or members-only podcast through the private RSS feed address your provider gives you. PodNotes keeps that address on each device, out of your synced vault, so you enter it once on each device.

## Add a private feed

1. Copy the private feed address from your podcast provider, such as your Supercast or Substack account.
2. In PodNotes, add the podcast with that address, as in [Add a podcast](/podcasts/#add-a-podcast).

PodNotes stores the address in Obsidian's secret storage on this device. Your vault, including PodNotes' `data.json`, holds a placeholder such as `podnotes-private-feed:Members%20Show` and a reference to the stored address. [Which addresses PodNotes keeps private](#which-addresses-podnotes-keeps-private) lists the addresses it recognizes.

PodNotes cannot sign in to providers that require a browser login. If PodNotes cannot store the address, it does not add the podcast, and a notice says so, such as "Could not store the private feed address for "Members Show" on this device."

## Use a private feed on another device

The podcast syncs to your other devices, but its address does not. On each other device, enter the address once:

1. Install or update PodNotes on the device, and let sync finish.
2. In the PodNotes view, open the podcast. Its page shows **Feed didn't load** and **Address not on this device**.
3. Select **Set feed address**. The podcast's menu has the same item.
4. Paste the private feed address into **Feed address**, and select **Save**.

PodNotes stores the address on this device and loads the feed. From then on, the podcast and its timestamp links work on this device too.

PodNotes does not check that the address belongs to the same show, so paste the address of that podcast. Adding the podcast a second time from its address does not work. A notice then says, for example, "The private feed address for "Members Show" is not available on this device."

## Which addresses PodNotes keeps private

PodNotes keeps a feed address private when it has any of these:

- A user name or a password, as in `https://user:password@example.com/feed.rss`.
- A query parameter named `auth`, `token`, `key`, `secret`, `pass`, `password`, `apikey`, `api-key`, `api_key`, `access-token`, `access_token`, `sig`, `signature`, `jwt`, `credential`, or `credentials`, in any case.
- The private feed form of one of the hosts in [Private feed hosts](#private-feed-hosts).

PodNotes does not recognize other addresses, even when they hold a token in the path, such as `https://example.com/feeds/a1b2c3/rss`, or when they use a provider's custom domain. Such an address stays in `data.json`, syncs to every device, and works there with no setup.

## After you update to PodNotes 2.22.0

PodNotes 2.22.0 recognizes the hosts in [Private feed hosts](#private-feed-hosts). On its first start, PodNotes moves the address of each matching podcast out of `data.json` into secret storage and shows "Moved private feed URLs out of data.json." The podcast keeps working on that device.

Update PodNotes on every device, because an older PodNotes cannot play these podcasts and can overwrite your library. Then, on each other device, enter the address of each moved podcast once with [Set feed address](#use-a-private-feed-on-another-device).

Notes and links that you created before the update keep the address in their text. PodNotes does not rewrite them.

## Private feeds in notes and links

PodNotes never writes a private feed's address into a note it creates:

- Episode notes, feed notes, timestamps, and transcripts of a podcast you added use its placeholder instead. `{{feedurl}}` gives the placeholder, and links work on each device where you set the address.
- When an episode's description or other text quotes the address, PodNotes replaces it with the placeholder.
- An episode from a private feed that you have not added, such as one you opened from a link that holds the address, plays, but its notes get no link back to it. `{{feedurl}}` and `{{episodelink}}` are empty, the note has no `feedUrl` or `guid` property, and timestamps are plain text. To get links, add the podcast.

A link that holds the private address of a podcast you added opens that podcast on a device where you set its address. New timestamps from it use the placeholder.

## Move private feeds with settings and OPML files

- A settings file holds each private podcast with its reference, never its address. After you import it on a device that has the addresses, the podcasts work. On any other device, use **Set feed address**, or import an OPML file that lists the podcasts.
- An OPML export holds each private feed's address in plain text, and a notice warns you. PodNotes exports a podcast whose address is not on this device with an empty address. Delete the OPML file after you import it elsewhere.
- An OPML import gives a private podcast its address back when this device lacks it and the file lists a private feed with the podcast's exact title.

See [Import and export](/import_export/).

## Limits of private feeds

- When PodNotes moves an address out of `data.json`, as on the first start after an update or during a settings import, and cannot store it in secret storage, the podcast works until you restart Obsidian. A notice says "Could not store the private feed address on this device." After the restart, use **Set feed address**.
- **Set feed address** accepts only an address from [Which addresses PodNotes keeps private](#which-addresses-podnotes-keeps-private). For any other address, it says "Enter a private feed address." For a feed it cannot load, it says "Could not load the feed at that address."
- When you remove a private podcast and add it again, it gets a new reference. Your other devices then need **Set feed address** again.
- When PodNotes starts on a `data.json` that no longer lists a private podcast, for example after your sync service brings back an older copy, it deletes this device's copy of that podcast's address. When the podcast comes back, use **Set feed address** again.
- A settings file from PodNotes 2.21.1 or earlier holds no reference. After you import it, **Set feed address** fails with a notice that it could not store the private feed address. Remove the podcast and add it again with its address.

## Reference

### Private feed hosts

PodNotes recognizes these private feed addresses. A subdomain is any name that ends with the domain, such as `myshow.substack.com`.

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
