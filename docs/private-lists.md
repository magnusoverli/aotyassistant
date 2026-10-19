# Private lists and recovery

**Saved list** contains a participant’s ordered song selections. Access is tied to private browser credentials, not a nickname. Other participants, the host, and the public display do not receive its contents or counts.

## Save and arrange

- **Add to list** saves the selected recording/source. The next choice is at the top.
- **Edit order** provides drag handles and up/down controls. **Make next** moves a choice to the front.
- **Remove** moves a choice to **History → Removed**. Choose **Add back** to restore it.
- **Play next** in the player starts the first saved choice during the current participant’s turn. List controls only manage selections and order.
- Successful playback keeps the choice in **History → Previously played**. This means playback started, not necessarily that the song finished.

The app never autoplays a list or sends the whole list to Music Assistant. Failed or uncertain playback keeps the entry for explicit review.

**Saved** means the server acknowledged durable storage. **Saving** and **Save not confirmed** do not. A pending edit is retained in that browser for explicit retry/review, not automatically replayed. If another tab changed the list, the latest saved list is loaded before retrying the change.

Lists allow 200 upcoming choices, 1,000 retained entries including history, and 10 authorized devices. Capacity errors leave existing work intact. Save-operation retries are retained for seven days.

## Keep access when changing devices

Open **List access → Create recovery key**. Keep the key private: anyone with it can access the saved list. On another browser/device, open **Recover a saved list**, enter the key, and select **Recover list**. Use **Revoke other devices** to remove other browsers’ access if needed.

- A nickname does not recover a list.
- Removing a person from the listening order does not delete their music.
- Clearing cookies/site data, using a different browser, or changing the guest address can lose browser access. Use the recovery key.
- Without browser credentials or a recovery key, there is no host-assisted recovery path.
- A recovery key cannot restore files deleted from the server or lost without a backup.

## Connection changes

Speaker changes retain saved choices and private browsing. Reauthorizing the same Music Assistant server, or verifying a new address for that same server, retains saved catalogue identity.

Disconnecting and replacing a server does not delete old choices, but they remain unavailable rather than being silently matched to another catalogue. Provider removals or unavailable recordings also leave saved entries visible. Refresh expired search results and select the intended recording again; saved list entries are independently durable.

Uploaded files use the same privacy, history, and recovery rules. Reversible removal retains the audio; [permanent deletion](uploaded-audio.md#storage-and-deletion) is a separate action.
