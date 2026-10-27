import { defineContentScript } from 'wxt/utils/define-content-script';
import { emitUi, listen, type ContentRequest } from '../src/messaging';
import { ChatGptProvider } from '../src/providers/chatgpt';

/**
 * Runs on chatgpt.com. It has no UI; it only performs same-origin API calls on request from
 * the side panel (listing) and the background worker (archive/delete), using the session the
 * user is already logged in with.
 */
export default defineContentScript({
  matches: ['https://chatgpt.com/*'],
  runAt: 'document_idle',
  main() {
    const provider = new ChatGptProvider();

    listen<ContentRequest>('content', async (msg) => {
      switch (msg.type) {
        case 'session':
          return provider.getSession();
        case 'list':
          return provider.listChats((p) =>
            emitUi({ target: 'ui', type: 'list-progress', provider: 'chatgpt', loaded: p.loaded, total: p.total }),
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
