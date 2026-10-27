import { defineContentScript } from 'wxt/utils/define-content-script';
import { emitUi, listen, type ContentRequest } from '../src/messaging';
import { ClaudeProvider } from '../src/providers/claude';

/**
 * Runs on claude.ai. Like the ChatGPT script, it has no UI: it only makes same-origin API
 * calls when the side panel or background worker asks, using the user's existing session.
 */
export default defineContentScript({
  matches: ['https://claude.ai/*'],
  runAt: 'document_idle',
  main() {
    const provider = new ClaudeProvider();

    listen<ContentRequest>('content', async (msg) => {
      switch (msg.type) {
        case 'session':
          return provider.getSession();
        case 'list':
          return provider.listChats((p) =>
            emitUi({ target: 'ui', type: 'list-progress', provider: 'claude', loaded: p.loaded, total: p.total }),
          );
        case 'act':
          await provider.apply(msg.action, msg.id);
          return null;
        case 'export':
          return provider.exportChat(msg.id);
      }
    });
  },
});
