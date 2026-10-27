# ChatSweep privacy policy

ChatSweep has no server, and the developers never see your data.

- **What it reads:** the list of your chats (id, title, dates, and whether a chat is in a Project, linked to a custom GPT, or pinned) from the AI provider you're logged into, using your existing browser session.
- **Where it's stored:** only in your browser's extension storage (`chrome.storage.local`) on your device. This covers your rules, the cached chat list for the preview, and the progress of a running sweep. Uninstalling the extension removes all of it.
- **Backups:** when you ask for a backup, the full text of the chats about to be swept is fetched from the provider and saved as a zip file through your browser's normal download. It is never sent anywhere else.
- **What it sends:** only the archive/delete requests you confirm, sent directly to the provider (e.g. chatgpt.com), as if you had clicked the buttons yourself.
- **What it never does:** collect analytics, send data to third parties, store or transmit your access token, or load remote code.
