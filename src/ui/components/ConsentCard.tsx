/**
 * First-run data disclosure (Chrome Web Store Disclosure Requirements, enforced from 2026-08-01):
 * the user must see what ChatSweep reads and stores, and agree, before it touches any chat data.
 * Nothing (not even the session check) runs until this is accepted.
 */
export function ConsentCard(props: { onAgree: () => void }) {
  return (
    <section className="card space-y-3">
      <h2 className="text-sm font-semibold">Before you start</h2>
      <p>ChatSweep works through the ChatGPT or Claude tab you're logged into. To do its job it will:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>Read your chat list</strong> (titles, dates, and whether a chat is starred, pinned or in a Project) and
          the name of the account or workspace you're logged into.
        </li>
        <li>
          <strong>Store</strong> that list, your rules and sweep progress in this browser only, so the preview and resume
          work.
        </li>
        <li>
          <strong>Read full conversations</strong> only when you ask for a backup, and save them as a zip in your
          Downloads.
        </li>
        <li>
          <strong>Archive or delete</strong> only the chats you confirm, by sending those requests straight to ChatGPT or
          Claude.
        </li>
      </ul>
      <p className="label">
        Nothing is sent to ChatSweep's developers or anyone else. No analytics, no ads, no tracking. Uninstalling removes
        everything ChatSweep stored.
      </p>
      <button className="btn btn-primary w-full" onClick={props.onAgree}>
        I agree, continue
      </button>
    </section>
  );
}
