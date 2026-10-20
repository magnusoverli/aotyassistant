# Host and participant guide

## Set up the room

Connect Music Assistant and choose a speaker in **Settings**. Open **Host desk**, share its join QR/link, and open **Room display** on a TV or other shared browser. Full screen is available where the browser supports it.

The room is always ready. Participants join with a nickname and enter the end of the listening order; the first person gets the first turn. Joining never starts music.

**Manage people** lets the host drag any participant card into a new position or use **Remove**. Drag near either edge of the list to scroll through longer orders. With a keyboard, focus a card and press **Space**, use the arrow keys to choose its position, then **Enter** or **Space** to drop; **Escape** cancels. Reordering does not replace the current listener or interrupt their song. Advancing a turn stops only playback still owned by this app, then gives the next person control. Names and turn order are public; private song lists are not.

## Prepare selections

Open **Music** after joining:

1. Search artists or tracks in **Find music**. Browse an artist’s albums, then choose a song.
2. If several services provide a result, select the intended source/version. The app does not silently substitute a different recording.
3. Use **Add to list** to save a choice for later. Preparation remains available while another participant is playing.
4. Use **Upload a song** for an audio file on the device. Review its details and add it to the private list.

See [private lists](private-lists.md) and [uploaded audio](uploaded-audio.md). Without a Music Assistant connection, the app offers a simulated demo catalogue; it does not play real audio.

## Play a turn

Only the current participant can choose and start a song or reveal it. Participant playback controls are available only during their turn. Choose **Play** from a search result or **Play next** in the player to start the first entry in **Saved list**. The list’s **Make next** action changes which saved song is selected without starting playback. Playing takes over the chosen Music Assistant destination with one song, replacing its existing queue and disabling repeat, shuffle, and autoplay.

The shared display hides the title, artist, and cover until the current participant selects **Reveal song**. If cover artwork is unavailable, the revealed title and artist appear on the spinning record’s label. Pause freezes progress. Resume is explicit, including when Music Assistant has parked a long-paused stream. Use **Finish turn** to stop the song controlled by the app and pass to the next person, or **Pass turn** to advance without playing a song.

When a song finishes naturally, the turn automatically moves to the next participant. Music Assistant can take a few seconds to confirm the end. Pausing, stopping, a playback error, or a lost connection does not count as completion. The next participant chooses when to start their song.

The host and current playing participant can adjust volume when the selected speaker supports it. Group destinations use group volume. Changing speakers requires stopping or finishing the app-owned track first.

**Host desk** shows playback progress and whether the song is hidden or visible on the room display. Exact times appear after the participant reveals the song. **More → Stop song — keep turn** stops the app-owned song without passing the turn. The participant chooses and starts a selection again; a successfully started saved selection remains in **Previously played** history. **Skip turn** stops the app-owned song and passes control to the next participant.

## Between gatherings

There is no Create/Start/End session step. The room and join/display links persist. The host can remove people from the rotation; removal does not delete their private lists. Returning participants can rejoin and use the same list when their browser credentials are retained.

Lists, settings, and order survive restart, while playback and reveal reset. Keep a private-list recovery key and include the app in Home Assistant backups.
