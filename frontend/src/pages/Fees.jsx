import { useEffect, useState } from "react";
import client from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

const STATUS_STYLES = {
  PAID: "bg-moss/10 text-moss border-moss/30",
  PARTIAL: "bg-amber/10 text-amber border-amber/30",
  UNPAID: "bg-rust/10 text-rust border-rust/30",
};

const emptyStructureForm = { classRoomId: "", term: "1", year: String(new Date().getFullYear()), amount: "", description: "" };
const emptyInvoiceForm = { studentId: "", term: "1", year: String(new Date().getFullYear()), amountDue: "" };

export default function Fees() {
  const { user } = useAuth();
  const isAdmin = user.role === "ADMIN";
  const [invoices, setInvoices] = useState([]);
  const [structures, setStructures] = useState([]);
  const [classRooms, setClassRooms] = useState([]);
  const [students, setStudents] = useState([]);
  const [payForm, setPayForm] = useState({});

  const [showStructureForm, setShowStructureForm] = useState(false);
  const [structureForm, setStructureForm] = useState(emptyStructureForm);
  const [structureError, setStructureError] = useState("");
  const [generatingId, setGeneratingId] = useState(null);
  const [generatedMsg, setGeneratedMsg] = useState("");

  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState(emptyInvoiceForm);
  const [invoiceError, setInvoiceError] = useState("");

  function load() {
    client.get("/fees/invoices").then((r) => setInvoices(r.data));
    if (isAdmin) {
      client.get("/fees/structures").then((r) => setStructures(r.data));
      client.get("/students/classrooms").then((r) => setClassRooms(r.data));
      client.get("/students").then((r) => setStudents(r.data));
    }
  }
  useEffect(load, []);

  async function recordPayment(invoiceId) {
    const amount = Number(payForm[invoiceId]);
    if (!amount) return;
    await client.post("/fees/payments", { invoiceId, amount, method: "Cash" });
    setPayForm({ ...payForm, [invoiceId]: "" });
    load();
  }

  async function handleCreateStructure(e) {
    e.preventDefault();
    setStructureError("");
    try {
      await client.post("/fees/structures", {
        classRoomId: Number(structureForm.classRoomId),
        term: Number(structureForm.term),
        year: Number(structureForm.year),
        amount: Number(structureForm.amount),
        description: structureForm.description || undefined,
      });
      setStructureForm(emptyStructureForm);
      setShowStructureForm(false);
      load();
    } catch (err) {
      setStructureError(err.response?.data?.error?.formErrors?.join(", ") || "Could not create fee structure");
    }
  }

  async function handleGenerateInvoices(structureId) {
    setGeneratingId(structureId);
    setGeneratedMsg("");
    try {
      const { data } = await client.post("/fees/invoices/generate", { feeStructureId: structureId });
      setGeneratedMsg(`Created ${data.created} invoice(s).`);
      load();
    } catch (err) {
      setGeneratedMsg(err.response?.data?.error || "Could not generate invoices");
    } finally {
      setGeneratingId(null);
      setTimeout(() => setGeneratedMsg(""), 4000);
    }
  }

  async function handleCreateInvoice(e) {
    e.preventDefault();
    setInvoiceError("");
    try {
      await client.post("/fees/invoices", {
        studentId: Number(invoiceForm.studentId),
        term: Number(invoiceForm.term),
        year: Number(invoiceForm.year),
        amountDue: Number(invoiceForm.amountDue),
      });
      setInvoiceForm(emptyInvoiceForm);
      setShowInvoiceForm(false);
      load();
    } catch (err) {
      setInvoiceError(err.response?.data?.error?.formErrors?.join(", ") || "Could not create invoice");
    }
  }

  return (
    <div className="space-y-10">
      {isAdmin && (
        <div>
          <h2 className="text-2xl font-display font-semibold mb-6">Fee structures</h2>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-slate/60">Create a fee amount for a class/term, then generate invoices for every student in that class at once.</p>
            <button className="btn-secondary text-sm whitespace-nowrap" onClick={() => setShowStructureForm((v) => !v)}>
              {showStructureForm ? "Cancel" : "+ New fee structure"}
            </button>
          </div>

          {showStructureForm && (
            <form onSubmit={handleCreateStructure} className="card p-6 mb-4 grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Class</label>
                <select className="input" required value={structureForm.classRoomId} onChange={(e) => setStructureForm({ ...structureForm, classRoomId: e.target.value })}>
                  <option value="">Select a class</option>
                  {classRooms.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Amount (KES)</label>
                <input className="input" type="number" required value={structureForm.amount} onChange={(e) => setStructureForm({ ...structureForm, amount: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Term</label>
                <select className="input" value={structureForm.term} onChange={(e) => setStructureForm({ ...structureForm, term: e.target.value })}>
                  <option value="1">Term 1</option>
                  <option value="2">Term 2</option>
                  <option value="3">Term 3</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Year</label>
                <input className="input" type="number" required value={structureForm.year} onChange={(e) => setStructureForm({ ...structureForm, year: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1">Description (optional)</label>
                <input className="input" placeholder="e.g. Term 2 tuition" value={structureForm.description} onChange={(e) => setStructureForm({ ...structureForm, description: e.target.value })} />
              </div>
              {structureError && <p className="text-rust text-sm col-span-2">{structureError}</p>}
              <button className="btn-primary col-span-2" type="submit">Save fee structure</button>
            </form>
          )}

          <div className="card overflow-x-auto mb-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate/50 uppercase text-xs tracking-wider border-b border-line bg-line/20">
                  <th className="py-2 px-4">Class</th>
                  <th className="py-2 px-4">Term</th>
                  <th className="py-2 px-4">Amount</th>
                  <th className="py-2 px-4">Description</th>
                  <th className="py-2 px-4"></th>
                </tr>
              </thead>
              <tbody>
                {structures.map((s) => (
                  <tr key={s.id} className="border-b border-line/60">
                    <td className="py-2 px-4">{s.classRoom?.name}</td>
                    <td className="py-2 px-4">T{s.term} {s.year}</td>
                    <td className="py-2 px-4 font-mono">{s.amount.toLocaleString()}</td>
                    <td className="py-2 px-4 text-slate/60">{s.description || "—"}</td>
                    <td className="py-2 px-4">
                      <button className="btn-secondary text-xs" disabled={generatingId === s.id} onClick={() => handleGenerateInvoices(s.id)}>
                        {generatingId === s.id ? "Generating…" : "Generate invoices"}
                      </button>
                    </td>
                  </tr>
                ))}
                {structures.length === 0 && (
                  <tr><td colSpan={5} className="py-4 px-4 text-center text-slate/50">No fee structures yet — add one above.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {generatedMsg && <p className="text-sm text-moss">{generatedMsg}</p>}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-display font-semibold">{isAdmin ? "Invoices & Payments" : "Fee Statement"}</h2>
          {isAdmin && (
            <button className="btn-secondary text-sm whitespace-nowrap" onClick={() => setShowInvoiceForm((v) => !v)}>
              {showInvoiceForm ? "Cancel" : "+ Single invoice"}
            </button>
          )}
        </div>

        {showInvoiceForm && (
          <form onSubmit={handleCreateInvoice} className="card p-4 mb-4 flex gap-3 items-end flex-wrap">
            <div>
              <label className="block text-xs font-medium mb-1">Student</label>
              <select className="input" required value={invoiceForm.studentId} onChange={(e) => setInvoiceForm({ ...invoiceForm, studentId: e.target.value })}>
                <option value="">Select student</option>
                {students.map((s) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Amount due (KES)</label>
              <input className="input" type="number" required value={invoiceForm.amountDue} onChange={(e) => setInvoiceForm({ ...invoiceForm, amountDue: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Term</label>
              <select className="input" value={invoiceForm.term} onChange={(e) => setInvoiceForm({ ...invoiceForm, term: e.target.value })}>
                <option value="1">Term 1</option>
                <option value="2">Term 2</option>
                <option value="3">Term 3</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Year</label>
              <input className="input w-24" type="number" required value={invoiceForm.year} onChange={(e) => setInvoiceForm({ ...invoiceForm, year: e.target.value })} />
            </div>
            <button className="btn-primary" type="submit">Create invoice</button>
            {invoiceError && <p className="text-rust text-sm">{invoiceError}</p>}
          </form>
        )}

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
    </div>
  );
}
