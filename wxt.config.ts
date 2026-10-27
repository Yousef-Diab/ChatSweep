import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // MV3 everywhere (WXT defaults Firefox to MV2).
  manifestVersion: 3,
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: ({ browser }) => ({
    name: 'ChatSweep',
    description:
      'Rule-based cleanup for your AI chat history. Keep what matters, archive or delete the rest.',
    // Keep this list minimal: reviewers and users read it.
    // alarms: scheduled checks (which only queue chats for review; they never sweep on their own).
    // sidePanel is Chromium-only; on Firefox WXT turns the sidepanel entrypoint into a sidebar_action.
    permissions: browser === 'firefox' ? ['storage', 'alarms'] : ['storage', 'sidePanel', 'alarms'],
    host_permissions: ['https://chatgpt.com/*'],
    action: {
      default_title: 'Open ChatSweep',
    },
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'chatsweep@chatsweep.dev',
          // 142 = first version (desktop 140, Android 142) that understands data_collection_permissions.
          strict_min_version: '142.0',
          // AMO requires a data-collection declaration; ChatSweep collects nothing.
          data_collection_permissions: { required: ['none'] },
        },
      },
    }),
  }),
});
