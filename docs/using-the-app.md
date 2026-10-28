# Host and participant guide

## Set up the room

Connect Music Assistant and choose a speaker in **Settings**. Open **Host desk**, share its join QR/link, and open **Room display** on a TV or other shared browser. Full screen is available where the browser supports it.

The speaker list updates automatically from Music Assistant. **Updating…** keeps the previous selection visible while checking again; the help text identifies last-known, expired or failed observations and the last-check time. **Ready** requires fresh inventory and selected-queue checks, not just a saved speaker name. Last-known choices remain visible if a refresh fails, but are not presented as verified. Choosing a target checks it again before saving; discovery never changes the target or starts audio automatically.

The room is always ready. New participants enter a display name and choose a four-digit PIN; returning participants select their name/avatar and enter their PIN on a new browser. Remembered browsers continue automatically. Each user has one playlist across devices and one place in the listening order. New arrivals enter at the end; the first person gets the first turn. Joining never starts music.

In the listening order, a soft light travels along the current participant’s card border, including while choosing a song or while playback is paused or stopped. Reduced-motion preferences use a static outline.

On mobile, the compact listening order starts with **Now**, followed by **Next**. Cards rotate as turns advance; scroll horizontally to see the remaining participants. This presentation does not change the saved turn order or desktop layout.

On **Host desk**, drag any participant card into a new position. Neighbouring cards slide aside to preview the new order; dropping saves it. Drag near either edge of the list to scroll through longer orders. With a keyboard, focus a card and press **Space**, use the arrow keys to choose its position, then **Enter** or **Space** to drop; **Escape** cancels. Reordering does not replace the current listener or interrupt their song. Advancing a turn stops only playback still owned by this app, then gives the next person control. To delete a user, open **Settings → Users → Manage → Delete user**; this also removes their place in the order. Names and turn order are public; private song lists are not.

## Prepare selections

Open **Your music** after joining:

1. Search artists or tracks in **Find music**. Browse an artist’s albums, then choose a song.
2. If several services provide a result, select the intended source/version. The app does not silently substitute a different recording.
3. Use **Add to list** to save a choice for later. Preparation remains available while another participant is playing.
4. Use **Upload a song** for an audio file on the device. Review its details and add it to the private list.

**Your playlist** and search share one card: stacked on phones, or side by side on desktop with search on the left and a wider playlist pane on the right. The number of upcoming tracks appears beneath the playlist title. The saved list stays visible while browsing, with its own scrolling area and compact rows. Reorder inline with **Edit order**, or use a song’s **⋯** menu to move it to the top or remove it; no separate list screen is needed.

See [private lists](private-lists.md) and [uploaded audio](uploaded-audio.md). Without a Music Assistant connection, the app offers a simulated demo catalogue. The host, desktop participant, and room-display pages identify **Demo mode — no audio**; playback and volume controls are simulated and produce no sound on every device.

## Play a turn

Only the current participant can start a track or reveal its details. Participant playback controls are available only during their turn. Choose **Play** from a search result or **Play first selection** (**Play pick** on phones) in the player to start the first entry in **Your playlist**. The list’s **Move to top** action changes which saved track comes first without starting playback. Playing takes over the chosen Music Assistant speaker or group with one track, replacing its existing queue and disabling repeat, shuffle, and autoplay.

The shared display shows **Track details hidden.** until playback reaches **70%**, or the current participant selects **Reveal details** earlier. Auto-reveal is enabled by default; switch it off in **Settings → Playback → Automatically reveal at 70%** for manual-only reveal. A subtle marker on the progress bar indicates the threshold and disappears after either kind of reveal, or when auto-reveal is disabled. Tracks with unknown duration or unavailable progress remain manual. Enabling auto-reveal during a track already beyond 70% reveals it; disabling it does not hide a track already revealed. Host players never show track names, artist names or artwork.

If cover artwork is unavailable, the revealed title and artist appear on the display’s spinning record label. Pause freezes progress. Resume is explicit, including when Music Assistant has parked a long-paused stream. Use **Finish turn** to stop the track controlled by the app and pass to the next person, or **Pass turn** to advance without playing a track. Other Music Assistant and speaker interfaces may independently show track information before reveal.

When a song finishes naturally, the turn automatically moves to the next participant. Music Assistant can take a few seconds to confirm the end. Pausing, stopping, a playback error, or a lost connection does not count as completion. The next participant chooses when to start their song.

The host and current playing participant can adjust volume when the selected speaker supports it. **Mute** sets volume to zero; **Unmute** restores the last nonzero level observed by that player UI (or 35% if none is known). The remembered level resets when the output changes. Group destinations use group volume. Changing speakers requires stopping or finishing the app-owned track first.

Both players offer **Pause / Resume** and **Stop song** controls, separate from finishing or skipping the turn. Stopping keeps the current participant's turn; the participant chooses and starts a selection again. A successfully started saved selection remains in **Previously played** history. The progress bar is read-only: seeking, previous-track, repeat, and shuffle controls are not exposed.

**Host desk** shows playback progress and whether the song is hidden or visible on the room display. Exact times appear after the participant reveals the song. **Stop song — keep turn** is directly available and asks for confirmation. **Skip turn** stops the app-owned song and passes control to the next participant.

### Playback problems

Temporary status-read failures are retried automatically without repeating audio commands. If playback cannot be safely verified, the warning identifies the problem: connection or speaker availability, rejected access, an unsupported Music Assistant response, an unconfirmed Play/Pause/Resume/Stop, or changed queue settings. When recovery is required, the host uses **Settings → Playback recovery → Recover playback controls** after checking the stated cause. Recovery stops only audio the app can still identify as its own and does not pass the turn or start another song. **Details** contains a diagnostic code for reporting the problem.

If another source changes playback, its audio is left untouched and the app does not request recovery unnecessarily. A confirmed protective stop after queue-policy changes also keeps the turn; the participant can select a song again. Saved selections and browsing are retained.

## Returning to the room

There is no Create/Start/End session step. The room and join/display links persist. Returning participants use their name and PIN to access the same playlist, with remembered browsers continuing automatically.

Lists, users, settings, and order survive restart, while playback and reveal reset. Include the app in Home Assistant backups. To return on another device, select yourself and enter your PIN. The host can replace forgotten PINs in Settings without deleting songs or changing playback. Lists are automatic; there is no recovery-key or list-switching workflow.

Settings has four sections: **Playback** for the active speaker/group and automatic reveal; **Users** for name/avatar rows and account actions; **Music Assistant** for connection setup; and **Access & network** for guest links and uploaded-file connectivity. Initial setup opens Music Assistant; configured installations open Playback. The status summary stays visible, and switching sections keeps unfinished form edits.

To permanently remove someone and their playlist, use **Host → Settings → Users → Manage → Delete user** and confirm. This deletes their history and uploads, signs out their devices and removes any listening-order seat. A fresh registration can reuse the deleted name and starts with an empty playlist.
