# Private selections and persistence

**Your playlist** is your one automatic, persistent list of track choices, shared across your devices. Its subtitle shows the number of upcoming tracks, excluding played or removed songs. On phones the card is headed simply **Playlist**, without the count or save status; a save that needs attention still shows **Needs attention** with **Retry save** in the list. There is no list creation, selection, switching, or recovery workflow. An empty list is ready for searching and adding songs immediately after joining. Other participants, the host, and the room display do not receive its contents or counts.

## Save and arrange

- **Add to list** saves the selected recording and its verified equivalent sources. The next choice is at the top.
- Drag a song’s row to reorder the list; on a touch screen, press and hold the song first. Dragging a choice to the top makes it the next pick without playing it.
- The **✕** on a row moves the choice to **Removed**, shown below the upcoming tracks in the playlist’s scrolling area. Choose **Add back** to restore it.
- The **⇄** on a catalogue row opens the album's songs, with the current one marked **In your list**. The chosen song takes the same place in your playlist. The old song leaves the list; if it was played before, its history stays in **Previously played**. Album choices need Music Assistant.
- For an uploaded song, **⇄** opens a dialog to upload and review a new file instead. Choose **Replace song** to save it in the same position. The original stays in **Removed**, or **Previously played** if it has history, and its file is kept for separate deletion. Upload replacements work even while Music Assistant or the original file is unavailable. See [uploaded audio](uploaded-audio.md#replace-an-uploaded-song).
- **Clear list** beside **Your playlist** starts again from scratch. After you confirm, it removes every upcoming song and the whole history (**Previously played** and **Removed**), and permanently deletes your uploaded songs. It can't be undone. Your place in the listening order is kept, and an uploaded song that is playing must stop or finish first. The button appears only when there is something to clear.
- **Play first selection** in the player starts the first saved choice during the current participant’s turn. List controls only manage selections and order.
- Successful playback keeps the choice in **Previously played**. **Previously played** and **Removed** are always listed below the upcoming tracks with their counts, even when empty; each is collapsed until you open it and shows 50 songs at a time. This means playback started, not necessarily that the song finished.

The app never sends the whole list to Music Assistant. [Automatic play](using-the-app.md#automatic-play) can start the next participant’s first upcoming choice or continue the current participant’s playlist after a natural ending, exactly as **Play first selection** would. Continuing a playlist keeps their turn and waits when the playlist is empty or the next track cannot play. Failed or uncertain playback keeps the entry for explicit review; an automatic start that never reached the speaker leaves the entry first in the list.

**Saved** means the server acknowledged durable storage. **Saving** and **Save not confirmed** do not. A pending edit is retained in that browser for explicit retry/review, not automatically replayed. If another tab changed the list, the latest saved list is loaded before retrying the change.

Lists allow 200 upcoming choices and 1,000 retained entries including history. Capacity errors leave existing work intact. Save-operation retries are retained for seven days.

## Import a list from SuShe Online

[SuShe Online](https://github.com/magnusoverli/sushe-online) can share one of your album lists as a link that works for one week. In SuShe Online, open the list's menu and choose **Share to Listening Room**, then copy the link. In Doom Room, choose **Import** beside **Your playlist** and paste it. A whole chat message that contains the link works too.

- SuShe Online shares one song per album: your primary track pick, or your only pick. Albums without a pick and disqualified albums are left out, and the summary says how many.
- Songs are added after anything already in your playlist, **last album first**, so the top of the SuShe list plays last. Songs already in your playlist are not added twice, so importing the same link again only adds what is new.
- Each song is looked up in Music Assistant: on the album the link names, or by searching your library and services. A match needs the same title and artist and a similar length, and a live, remixed or acoustic recording is never taken for the original. Remove a wrong match with **✕**.
- Faster services are tried first. Music Assistant limits each service's requests: its shared Spotify login allows one every 2 seconds, while Tidal allows 4 a second. So Tidal, Qobuz, Deezer and Apple Music albums and a search of your library and those services come before anything on Spotify. With Tidal connected, most songs never touch Spotify.
- Songs someone else already imported are found instantly. Music Assistant also remembers albums and tracks it looked up, for days to months, so lists that share albums get faster.
- The import runs on the server: you can close the window, lock your phone or reload the page. Choose **Import** again to see its progress or summary.
- Songs that weren't found are listed with **Find artist**, which searches for the song's artist so you can choose it from an album yourself, or [upload a file](uploaded-audio.md).
- **Stop** ends an import; songs added so far are kept. A full playlist (200 songs) also stops it, and so do several lookups failing in a row, for example while a music service is limiting requests. Importing again later skips the songs already added.
- Importing needs a Music Assistant connection. Imported songs are private like any other choice: the host, other participants and the display see nothing.

Doom Room opens the link like any public web address. The two apps share no accounts or settings, and any SuShe Online server works. Only `https` links on the public internet are opened, never addresses on your home network. A link that stopped working or expired says so; share the list again in SuShe Online for a new week.

## Continue as yourself

New users enter a display name and choose a four-digit PIN (including leading zeroes). On another device, select your name/avatar and enter that PIN. Remembered browsers continue automatically. Multiple devices share the same playlist and one place in the listening order. Use **Menu → Log out** on any page to sign out of that browser and return to the user picker. Your playlist, listening-order place and other signed-in devices are kept.

User deletion is managed in **Host → Settings → Users** and also removes their place in the listening order.

- A matching display name never grants access to another participant’s songs.
- Clearing browser credentials or changing the guest address requires selecting yourself and entering your PIN again.
- Forgotten PINs can be replaced under **Host → Settings → Users**. Reset signs out remembered devices while keeping the playlist, listening order and current playback intact.
- A load or storage failure is reported as an error, not treated as permission to replace saved songs with an empty list.
- A leftover list cookie from an earlier installation does not block initial setup when no saved file exists for it. Missing or unreadable data for an already-linked participant still fails safely instead of being replaced.
- Existing authorized lists and uploaded-file references are preserved when upgrading. Legacy list records are read compatibly and written in schema 2 without obsolete recovery fields when adopted or saved. Unassociated old files are not deleted or merged by nickname.

Existing remembered browsers are invited to choose their first PIN. Stored private bindings preserve existing list IDs, entries and upload references; a browser with an authorized older list can also retain it during registration. Unknown legacy files cannot be assigned to a person by matching names.

PINs provide casual privacy on the trusted LAN. Host controls, including PIN reset, retain the app's existing unauthenticated LAN model. PIN verifiers use salted asynchronous scrypt; five incorrect attempts trigger an initial one-minute cooldown. Independent, one-year browser sessions use HttpOnly cookies with hashed credentials stored in `users.json`. Back up that file together with room state, preparations and uploads.

## Permanently delete a user

In **Host → Settings → Users**, choose **Manage** beside the person's name/avatar, then **Delete user**. Confirm the named user to permanently remove their account, playlist, history and uploaded files. All their devices are signed out. Any remaining listening-order seat is removed; deleting the current listener stops their playback and advances the turn.

Deletion cannot be undone in the app. Existing backups remain separate copies.

A new user can reuse a deleted user's name, including in the same browser. This creates a new identity with an empty playlist; the old browser cookies do not restore or attach the deleted music. Retrying the original deleted registration is still rejected.

If deletion is interrupted, access stays revoked and the user is hidden from the participant picker. Host Settings shows **deletion needs retry**; choose **Retry Delete user** to finish cleanup. An in-progress upload must finish before cleanup can complete. Minimal opaque deletion records prevent old credentials or registration retries from restoring the deleted user.

## Connection changes

Speaker changes retain saved choices and private browsing. Reauthorizing the same Music Assistant server, or verifying a new address for that same server, retains saved catalogue identity.

Disconnecting and replacing a server does not delete old choices, but they remain unavailable rather than being silently matched to another catalogue. Provider removals or unavailable recordings also leave saved entries visible. Refresh expired search results and select the intended recording again; saved list entries are independently durable.

Uploaded files use the same ownership, persistence and history rules. Reversible removal retains the audio; [permanent deletion](uploaded-audio.md#storage-and-deletion) is a separate action.
