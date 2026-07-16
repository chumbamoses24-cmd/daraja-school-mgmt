import { useEffect, useState } from "react";
import client from "../api/client";

export default function Messages() {
  const [tab, setTab] = useState("inbox");
  const [inbox, setInbox] = useState([]);
  const [sent, setSent] = useState([]);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ recipientId: "", subject: "", body: "" });
  const [sentOk, setSentOk] = useState(false);

  function load() {
    client.get("/messages/inbox").then((r) => setInbox(r.data));
    client.get("/messages/sent").then((r) => setSent(r.data));
  }
  useEffect(load, []);
  useEffect(() => {
    client.get("/auth/users").then((r) => setUsers(r.data)).catch(() => {});
  }, []);

  async function markRead(id) {
    await client.post(`/messages/${id}/read`);
    load();
  }

  async function handleSend(e) {
    e.preventDefault();
    await client.post("/messages", { ...form, recipientId: Number(form.recipientId) });
    setForm({ recipientId: "", subject: "", body: "" });
    setSentOk(true);
    setTimeout(() => setSentOk(false), 2000);
    load();
  }

  const list = tab === "inbox" ? inbox : sent;

  return (
    <div className="grid grid-cols-3 gap-6">
      <div className="col-span-2">
        <div className="flex gap-4 mb-6 border-b border-line">
          {["inbox", "sent"].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`pb-3 px-1 text-sm font-medium capitalize border-b-2 -mb-px ${tab === t ? "border-ink text-ink" : "border-transparent text-slate/50"}`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="space-y-3">
          {list.map((m) => (
            <div key={m.id} className={`card p-4 ${tab === "inbox" && !m.readAt ? "border-l-2 border-l-amber" : ""}`}>
              <div className="flex justify-between items-start mb-1">
                <p className="font-medium">{m.subject}</p>
                <p className="text-xs text-slate/40 font-mono">{new Date(m.sentAt).toLocaleDateString()}</p>
              </div>
              <p className="text-xs text-slate/50 mb-2">
                {tab === "inbox" ? `From ${m.sender.firstName} ${m.sender.lastName}` : `To ${m.recipient.firstName} ${m.recipient.lastName}`}
              </p>
              <p className="text-sm text-slate/80">{m.body}</p>
              {tab === "inbox" && !m.readAt && (
                <button className="text-xs underline underline-offset-2 text-ink mt-2" onClick={() => markRead(m.id)}>
                  Mark as read
                </button>
              )}
            </div>
          ))}
          {list.length === 0 && <p className="text-slate/50 text-sm">Nothing here yet.</p>}
        </div>
      </div>

      <div>
        <h3 className="font-display text-lg font-semibold mb-4">New message</h3>
        <form onSubmit={handleSend} className="card p-4 space-y-3">
          <select className="input" required value={form.recipientId} onChange={(e) => setForm({ ...form, recipientId: e.target.value })}>
            <option value="">Select recipient</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.firstName} {u.lastName} ({u.role})</option>)}
          </select>
          <input className="input" required placeholder="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          <textarea className="input" required rows={5} placeholder="Message" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          <button className="btn-primary w-full" type="submit">Send</button>
          {sentOk && <p className="text-moss text-sm">Message sent.</p>}
        </form>
        {users.length === 0 && (
          <p className="text-xs text-slate/40 mt-2">Recipient list requires admin access to the directory; ask an admin to message you first, then reply.</p>
        )}
      </div>
    </div>
  );
}
