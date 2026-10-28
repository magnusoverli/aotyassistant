# Private selections and persistence

**Your playlist** is the participant browser’s one automatic, persistent list of track choices. Its subtitle shows the number of upcoming tracks, excluding played or removed songs. There is no list creation, selection, switching, or recovery workflow. An empty list is ready for searching and adding songs immediately after joining. Access is tied to private browser credentials, not a display name. Other participants, the host, and the room display do not receive its contents or counts.

## Save and arrange

- **Add to list** saves the selected recording and its verified equivalent sources. The next choice is at the top.
- **Edit order** provides drag handles and up/down controls. **Move to top** moves a choice to the front without playing it.
- **Remove** moves a choice to **History → Removed**. Choose **Add back** to restore it.
- **Play first selection** in the player starts the first saved choice during the current participant’s turn. List controls only manage selections and order.
- Successful playback keeps the choice in **History → Previously played**. This means playback started, not necessarily that the song finished.

The app never autoplays a list or sends the whole list to Music Assistant. Failed or uncertain playback keeps the entry for explicit review.

**Saved** means the server acknowledged durable storage. **Saving** and **Save not confirmed** do not. A pending edit is retained in that browser for explicit retry/review, not automatically replayed. If another tab changed the list, the latest saved list is loaded before retrying the change.

Lists allow 200 upcoming choices and 1,000 retained entries including history. Capacity errors leave existing work intact. Save-operation retries are retained for seven days.

## Keep the same browser identity

Use the same browser and guest address. Refreshes, additional tabs and server restarts reuse the same list. Removing a participant from the listening order does not delete their songs or uploads; rejoining from that browser reuses its existing list. If only the list cookie is missing, a still-valid room membership can reattach the same server-side list automatically.

- A matching display name never grants access to another participant’s songs.
- Clearing all browser credentials, using a different browser, or changing the guest origin can lose access. There is no cross-device transfer or host-assisted list recovery feature.
- A load or storage failure is reported as an error, not treated as permission to replace saved songs with an empty list.
- A leftover list cookie from an earlier installation does not block initial setup when no saved file exists for it. Missing or unreadable data for an already-linked participant still fails safely instead of being replaced.
- Existing authorized lists and uploaded-file references are preserved when upgrading. Legacy list records are read compatibly and written in schema 2 without obsolete recovery fields when adopted or saved. Unassociated old files are not deleted or merged by nickname.

## Connection changes

Speaker changes retain saved choices and private browsing. Reauthorizing the same Music Assistant server, or verifying a new address for that same server, retains saved catalogue identity.

Disconnecting and replacing a server does not delete old choices, but they remain unavailable rather than being silently matched to another catalogue. Provider removals or unavailable recordings also leave saved entries visible. Refresh expired search results and select the intended recording again; saved list entries are independently durable.

Uploaded files use the same ownership, persistence and history rules. Reversible removal retains the audio; [permanent deletion](uploaded-audio.md#storage-and-deletion) is a separate action.
