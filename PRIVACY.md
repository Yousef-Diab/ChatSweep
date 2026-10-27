# ChatSweep privacy policy

_Last updated: 2026-10-27_

ChatSweep is a browser extension that cleans up your chat history on chatgpt.com and claude.ai. It has no server,
and its developers never see your data.

- **What it reads:** from the AI site you're logged into, using your existing browser session:
  - your list of chats (id, title, dates, and whether a chat is in a Project, linked to a custom GPT, starred or pinned);
  - the email (ChatGPT) or organization name (Claude) of the logged-in account, shown in the panel as "Connected as …";
  - the full content of a chat, only when you ask for a backup of the chats about to be swept.
- **Where it's stored:** only in your browser's extension storage on your device. This covers your rules and presets,
  the cached chat list for the preview, your schedule, and the progress of a running sweep. Uninstalling the extension
  removes all of it.
- **Backups:** saved as a zip file through your browser's normal download. They are never sent anywhere else.
- **What it sends:** only the archive and delete requests you confirm, sent directly to the site (chatgpt.com or
  claude.ai), as if you had clicked the buttons yourself.
- **Sign-in:** ChatSweep never sees your password. On ChatGPT, it uses the session access token the site already
  gives your browser, keeps it in memory only, and uses it only for your own requests to chatgpt.com. It is never
  stored or sent anywhere else. On Claude, the site's own session cookie is used; ChatSweep doesn't read it.
- **What it never does:** collect analytics, show ads, sell or share data with third parties, use your data for
  anything other than cleaning up your chats, or load remote code.

**Limited Use:** ChatSweep's use of information complies with the Chrome Web Store User Data Policy, including the
Limited Use requirements. Data is used only to provide ChatSweep's single purpose (cleaning up your own chat history)
and is never transferred or sold.

ChatSweep is not affiliated with OpenAI or Anthropic.

Questions: open an issue at https://github.com/Yousef-Diab/ChatSweep/issues
