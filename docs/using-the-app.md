# Host and participant guide

## Set up the room

Connect Music Assistant and choose a speaker in **Settings**. Open **Host desk**, share its join QR/link, and open **Room display** on a TV or other shared browser. Full screen is available where the browser supports it.

The room display keeps one layout in every state. The record rests, dimmed, while nothing plays, spins during a song and shows the cover when the song is revealed. On wide displays, the artwork and track-details block share a bottom edge near the bottom of the screen. The title, artist, album, progress and join code keep their places; only their contents change.

### Animated display background

**Settings → Appearance → Animated BMF background** controls the logo animation behind the room display. It starts enabled and looping, in room gold at 12% opacity and 80% width. The logo sits just below the listening order and is compressed vertically by 8%, keeping its chosen width. Change growth order, origin, randomness, sprouts, timing, looping, hold, fade, opacity and width in the preview. **Letter grow time** supports 0.2–60 seconds for slower reveals. Rounded, softly irregular mask edges and varied growth pulses give the entrance an organic appearance. Leave the pattern seed blank for a new pattern each round, or enter a number for repeatable growth.

**Replay preview** restarts the local preview. **Save and replay on display** persists the settings and restarts the animation on connected room displays, including displays on other devices. **Reset to defaults** changes the preview; save to apply it. Uncheck **Enable BMF display background** and save to turn it off. With looping off, it grows once and stays visible. Reduced-motion preferences show the completed logo without animation.

### Room logo

Add your room's logo in **Settings → Appearance → Upload logo**. It appears at the top right of the room display in every state, and above the join form on guests' phones. The app draws it as one shape in the room's gold, so any logo suits the display: margins are trimmed, and light-on-dark or dark-on-light artwork is converted automatically. Use a PNG, JPEG, WebP or SVG file up to 10 MB; a transparent PNG or an SVG works best. SVG files that link to other files are refused. **Replace logo** swaps it, and **Remove logo** returns both pages to how they looked without one. Open pages update by themselves.

The speaker list updates automatically from Music Assistant. **Updating…** keeps the previous selection visible while checking again; the help text identifies last-known, expired or failed observations and the last-check time. **Ready** requires fresh inventory and selected-queue checks, not just a saved speaker name. Last-known choices remain visible if a refresh fails, but are not presented as verified. Choosing a target checks it again before saving; discovery never changes the target or starts audio automatically.

The room is always ready. New participants enter a display name and choose a four-digit PIN; returning participants select their name/avatar and enter their PIN on a new browser. Remembered browsers continue automatically. Each user has one playlist across devices and one place in the listening order. New arrivals enter at the end; the first person gets the first turn. Joining never starts music.

In the listening order, a soft light travels along the current participant’s card border, including while choosing a song or while playback is paused or stopped. Reduced-motion preferences use a static outline.

On mobile, the compact listening order starts with **Now**, followed by **Next**. Cards rotate as turns advance; scroll horizontally to see the remaining participants. Your own card stays highlighted. This presentation does not change the saved turn order or desktop layout.

On **Host desk**, drag any participant card into a new position. Neighbouring cards slide aside to preview the new order; dropping saves it. Drag near either edge of the list to scroll through longer orders. On a touch screen, press and hold a card to pick it up; an ordinary swipe scrolls the order. With a keyboard, focus a card and press **Space**, use the arrow keys to choose its position, then **Enter** or **Space** to drop; **Escape** cancels. Reordering does not replace the current listener or interrupt their song. Advancing a turn stops only playback still owned by this app, then gives the next person control. To delete a user, open **Settings → Users → Manage → Delete user**; this also removes their place in the order. Names and turn order are public; private song lists are not.

## Prepare selections

Open **Your music** after joining:

1. Search for an artist or a song title in **Find music**. Matching artists are listed first, then songs. Tap an artist to see their albums, then an album to see its songs.
2. If several services provide a result, select the intended source/version. The app does not silently substitute a different recording.
3. Use **Add to list** to save a choice for later. Preparation remains available while another participant is playing.
4. Use **Upload a song** for an audio file on the device. Review its details and add it to the private list.
5. Use **Import** beside **Your playlist** to add a list shared from SuShe Online, one song per album. See [importing a list](private-lists.md#import-a-list-from-sushe-online).

**Your playlist** and search share one card: stacked on phones, or side by side on desktop with search on the left and a wider playlist pane on the right. The number of upcoming tracks appears beneath the playlist title. The list has its own scrolling area with compact rows, followed by **Previously played** and **Removed**. On phones, while you browse results below the list, a one-line playlist bar at the top shows the track count and your next pick, confirms each added song, and **View list** returns to the list. Drag a song’s row to a new place to reorder the list: with a mouse, press and move; on a touch screen, press and hold the song, then drag (a plain swipe scrolls the list). The other songs slide aside to show where it will land. The **✕** at the end of a row removes the song, and the **⇄** beside it replaces the song in the same place: choose another song from the album for catalogue tracks, or upload and review a new file for uploaded tracks. **Clear list** beside the playlist title empties the list and its history after a confirmation, to start from scratch. There is no separate edit mode or list screen.

See [private lists](private-lists.md) and [uploaded audio](uploaded-audio.md). Without a Music Assistant connection, the app offers a simulated demo catalogue. The host, desktop participant, and room-display pages identify **Demo mode — no audio**; playback and volume controls are simulated and produce no sound on every device.

## Play a turn

Only the current participant can start a track or reveal its details. Participant playback controls are available only during their turn, and search results show **Play** only then. Choose **Play** from a search result or **Play first selection** (**Play pick** on phones) in the player to start the first entry in **Your playlist**.

On phones, while someone else has the turn, the player shows whose turn it is, whether they are choosing or playing, how many turns until yours, your next pick and the speaker. When your turn starts, the player shows its controls and its border lights up, the browser tab title starts with **● Your turn**, and phones that support it vibrate briefly. If you have scrolled away from the player, a bar at the bottom of the screen says **It’s your turn** with **Go to player**; the same bar reports a lost connection. Dragging a song to the top changes which saved track comes first without starting playback. Playing takes over the chosen Music Assistant speaker or group with one track, replacing its existing queue and disabling repeat, shuffle, and autoplay.

The shared display shows **Track details hidden.** until playback reaches **70%**, or the current participant selects **Reveal details** earlier. Auto-reveal is enabled by default; switch it off in **Settings → Playback → Automatically reveal at 70%** for manual-only reveal. A subtle marker on the progress bar indicates the threshold and disappears after either kind of reveal, or when auto-reveal is disabled. Tracks with unknown duration or unavailable progress remain manual. Enabling auto-reveal during a track already beyond 70% reveals it; disabling it does not hide a track already revealed. Host players never show track names, artist names or artwork.

Hiding tracks is optional. Switch off **Settings → Playback → Hide track details until revealed** (Secret playback, on by default) and the room display shows each song's title, artist and artwork as soon as it starts. Participants no longer see **Reveal details**, and the 70% marker and automatic reveal no longer apply, so that setting is greyed out. Switching Secret playback off during a hidden song reveals it right away. Switching it back on never hides a song already shown; the next song starts hidden. The host desk is unchanged.

If cover artwork is unavailable, the revealed title and artist appear on the display’s spinning record label. Pause freezes progress. Resume is explicit, including when Music Assistant has parked a long-paused stream. Use **Finish turn** to stop the track controlled by the app and pass to the next person, or **Pass turn** to advance without playing a track. Both ask for confirmation, because a passed turn cannot be taken back. Other Music Assistant and speaker interfaces may independently show track information before reveal.

The display smooths progress locally between playback updates. Before reveal, it eases toward received positions without exposing elapsed time or duration; afterward it uses a bounded local clock and gently corrects ordinary timing differences. Stale updates stop animation rather than implying continued playback. This visual smoothing does not trigger reveal or advance turns.

Reveal follows the current participant's user identity across signed-in devices. Everyone can prepare their own playlist while waiting; only the current participant can play or reveal their track. The host has separate transport controls and no reveal button. A reveal request shows **Revealing…** until confirmed; **Details revealed** means the server has already accepted the reveal, including automatic reveal.

When a song finishes naturally, the turn automatically moves to the next participant. Music Assistant can take a few seconds to confirm the end. Pausing, stopping, a playback error, or a lost connection does not count as completion. The next participant chooses when to start their song, unless automatic play is on.

### Automatic play

Switch on **Settings → Playback → Play the next song automatically** to keep the music going between turns. It is off by default. When a song finishes naturally and the turn passes, the next participant’s first song in **Your playlist** starts by itself, as if they had chosen **Play first selection**: it moves to **Previously played**, starts hidden on the room display, and is revealed in the usual way. The round continues in listening order for as long as each participant has a song ready.

Nothing starts, and the participant chooses as usual, when their playlist is empty, a previous play attempt needs review, the song’s source isn’t connected, or the speaker isn’t ready. A song that can’t be found stays first in their playlist. **Finish turn**, **Skip turn** and **Pass turn** never start the next song, and switching the setting on doesn’t start music by itself. While an automatic start is in progress, the participant’s playlist shows **Your first song is starting…**. To stop the music, use **Stop song** or switch the setting off.

The host and current playing participant can adjust volume when the selected speaker supports it. **Mute** sets volume to zero; **Unmute** restores the last nonzero level observed by that player UI (or 35% if none is known). The remembered level resets when the output changes. Group destinations use group volume.

Both players offer **Pause / Resume** and **Stop song** controls, separate from finishing or skipping the turn. Stopping keeps the current participant's turn; the participant chooses and starts a selection again. A successfully started saved selection remains in **Previously played** history. The progress bar is read-only: seeking, previous-track, repeat, and shuffle controls are not exposed.

**Host desk** shows playback progress and whether the song is hidden or visible on the room display. Exact times appear after the participant reveals the song. **Stop song — keep turn** is directly available and asks for confirmation. **Skip turn** stops the app-owned song and passes control to the next participant; it asks for confirmation, including while the participant is still choosing. The host player has **Pause / Resume** and **Stop song** but no Play button, because only the current participant starts their song.

### Change speakers during a song

Open **Settings → Playback**, choose another **Speaker or group**, and confirm the move. **Moving playback…** stays visible until Music Assistant confirms the song on the new speaker. The same song continues from its playback position, with the participant's turn, revealed details and playlist history kept. This uses Music Assistant's native queue transfer, not a crossfade or a new Play. A short interruption and small position rounding are possible; timing depends on the speaker, music source and network.

Moving playback requires **Music Assistant 2.10.8 or later** and a supported playback API. The destination keeps its own volume. The move replaces its existing queue and may change active grouping when you choose a group member. A paused song can move to an idle, ungrouped speaker without starting audio; otherwise resume it first or choose another target. Connection and file-playback address settings remain locked during app-owned playback.

If the move cannot be confirmed, do not repeat it: the song may be on either speaker. **Recover playback controls** checks both exact queue identities and stops only verified app-owned audio; the turn does not advance. If playback moved but the speaker choice could not be saved, controls stay on the new speaker. **Refresh speakers** retries saving that choice without moving audio again; do this before restarting the app.

### Playback problems

Temporary status-read failures are retried automatically without repeating audio commands. If playback cannot be safely verified, the warning identifies the problem: connection or speaker availability, rejected access, an unsupported Music Assistant response, an unconfirmed Play/Pause/Resume/Stop, or changed queue settings. When recovery is required, the host uses **Settings → Playback recovery → Recover playback controls** after checking the stated cause. Recovery stops only audio the app can still identify as its own and does not pass the turn or start another song. **Details** contains a diagnostic code for reporting the problem.

If another source changes playback, its audio is left untouched and the app does not request recovery unnecessarily. A confirmed protective stop after queue-policy changes also keeps the turn; the participant can select a song again. Saved selections and browsing are retained.

## Returning to the room

There is no Create/Start/End session step. The room and join/display links persist. Returning participants use their name and PIN to access the same playlist, with remembered browsers continuing automatically.

Lists, users, settings, and order survive restart, while playback and reveal reset. Include the app in Home Assistant backups. To return on another device, select yourself and enter your PIN. The host can replace forgotten PINs in Settings without deleting songs or changing playback. Lists are automatic; there is no recovery-key or list-switching workflow.

Settings has five sections: **Playback** for the active speaker/group, automatic reveal and automatic play; **Users** for name/avatar rows and account actions; **Music Assistant** for connection setup; **Access & network** for guest links and uploaded-file connectivity; and **Appearance** for the animated display background and room logo. Initial setup opens Music Assistant; configured installations open Playback. Use the section navigation on the left (above the content on smaller screens); switching sections keeps unfinished form edits. Connection and speaker status appear in their respective sections.

To permanently remove someone and their playlist, use **Host → Settings → Users → Manage → Delete user** and confirm. This deletes their history and uploads, signs out their devices and removes any listening-order seat. A fresh registration can reuse the deleted name and starts with an empty playlist.
