import { useEffect, useState } from "react";
import client from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

const STATUS_STYLES = {
  PAID: "bg-moss/10 text-moss border-moss/30",
  PARTIAL: "bg-amber/10 text-amber border-amber/30",
  UNPAID: "bg-rust/10 text-rust border-rust/30",
};

export default function Fees() {
  const { user } = useAuth();
  const isAdmin = user.role === "ADMIN";
  const [invoices, setInvoices] = useState([]);
  const [payForm, setPayForm] = useState({});

  function load() {
    client.get("/fees/invoices").then((r) => setInvoices(r.data));
  }
  useEffect(load, []);

  async function recordPayment(invoiceId) {
    const amount = Number(payForm[invoiceId]);
    if (!amount) return;
    await client.post("/fees/payments", { invoiceId, amount, method: "Cash" });
    setPayForm({ ...payForm, [invoiceId]: "" });
    load();
  }

  return (
    <div>
      <h2 className="text-2xl font-display font-semibold mb-6">{isAdmin ? "Fees & Payments" : "Fee Statement"}</h2>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate/50 uppercase text-xs tracking-wider border-b border-line bg-line/20">
              <th className="py-3 px-4">Student</th>
              <th className="py-3 px-4">Term</th>
              <th className="py-3 px-4">Amount Due</th>
              <th className="py-3 px-4">Paid</th>
              <th className="py-3 px-4">Balance</th>
              <th className="py-3 px-4">Status</th>
              {isAdmin && <th className="py-3 px-4">Record payment</th>}
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id} className="border-b border-line/60">
                <td className="py-3 px-4">{inv.student.firstName} {inv.student.lastName}</td>
                <td className="py-3 px-4">T{inv.term} {inv.year}</td>
                <td className="py-3 px-4 font-mono">{inv.amountDue.toLocaleString()}</td>
                <td className="py-3 px-4 font-mono">{inv.amountPaid.toLocaleString()}</td>
                <td className="py-3 px-4 font-mono">{(inv.amountDue - inv.amountPaid).toLocaleString()}</td>
                <td className="py-3 px-4"><span className={`pill border ${STATUS_STYLES[inv.status]}`}>{inv.status}</span></td>
                {isAdmin && (
                  <td className="py-3 px-4">
                    {inv.status !== "PAID" && (
                      <div className="flex gap-2">
                        <input
                          className="input w-24"
                          type="number"
                          placeholder="Amount"
                          value={payForm[inv.id] || ""}
                          onChange={(e) => setPayForm({ ...payForm, [inv.id]: e.target.value })}
                        />
                        <button className="btn-secondary" onClick={() => recordPayment(inv.id)}>Record</button>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr><td colSpan={isAdmin ? 7 : 6} className="py-6 text-center text-slate/50">No invoices found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
