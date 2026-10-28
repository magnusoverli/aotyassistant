# Private selections and persistence

**Your playlist** is your one automatic, persistent list of track choices, shared across your devices. Its subtitle shows the number of upcoming tracks, excluding played or removed songs. There is no list creation, selection, switching, or recovery workflow. An empty list is ready for searching and adding songs immediately after joining. Other participants, the host, and the room display do not receive its contents or counts.

## Save and arrange

- **Add to list** saves the selected recording and its verified equivalent sources. The next choice is at the top.
- **Edit order** provides drag handles and up/down controls. **Move to top** moves a choice to the front without playing it.
- **Remove** moves a choice to **History → Removed**. Choose **Add back** to restore it.
- **Play first selection** in the player starts the first saved choice during the current participant’s turn. List controls only manage selections and order.
- Successful playback keeps the choice in **History → Previously played**. This means playback started, not necessarily that the song finished.

The app never autoplays a list or sends the whole list to Music Assistant. Failed or uncertain playback keeps the entry for explicit review.

**Saved** means the server acknowledged durable storage. **Saving** and **Save not confirmed** do not. A pending edit is retained in that browser for explicit retry/review, not automatically replayed. If another tab changed the list, the latest saved list is loaded before retrying the change.

Lists allow 200 upcoming choices and 1,000 retained entries including history. Capacity errors leave existing work intact. Save-operation retries are retained for seven days.

## Continue as yourself

New users enter a display name and choose a four-digit PIN (including leading zeroes). On another device, select your name/avatar and enter that PIN. Remembered browsers continue automatically. Multiple devices share the same playlist and one place in the listening order. Use **Switch user** in the participant navigation to sign out of that browser.

Removing someone from the listening order does not delete their user, songs, uploads or history. They remain in the user picker and can explicitly join again. Opening or refreshing a removed user's page never rejoins automatically.

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

This is separate from removing someone from the listening order, which keeps their account and music. Deletion cannot be undone in the app. Existing backups remain separate copies.

A new user can reuse a deleted user's name, including in the same browser. This creates a new identity with an empty playlist; the old browser cookies do not restore or attach the deleted music. Retrying the original deleted registration is still rejected.

If deletion is interrupted, access stays revoked and the user is hidden from the participant picker. Host Settings shows **deletion needs retry**; choose **Retry Delete user** to finish cleanup. An in-progress upload must finish before cleanup can complete. Minimal opaque deletion records prevent old credentials or registration retries from restoring the deleted user.

## Connection changes

Speaker changes retain saved choices and private browsing. Reauthorizing the same Music Assistant server, or verifying a new address for that same server, retains saved catalogue identity.

Disconnecting and replacing a server does not delete old choices, but they remain unavailable rather than being silently matched to another catalogue. Provider removals or unavailable recordings also leave saved entries visible. Refresh expired search results and select the intended recording again; saved list entries are independently durable.

Uploaded files use the same ownership, persistence and history rules. Reversible removal retains the audio; [permanent deletion](uploaded-audio.md#storage-and-deletion) is a separate action.
