import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import client from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

// Resizes/compresses an image file client-side and returns a base64 data URI, so uploads stay small.
function resizeImageToDataUrl(file, maxDimension, type = "image/jpeg") {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDimension) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else if (height >= width && height > maxDimension) {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (type === "image/jpeg") {
          ctx.fillStyle = "#fff"; // JPEG has no transparency
          ctx.fillRect(0, 0, width, height);
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL(type, 0.85));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function Profile() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState(user?.firstName || "");
  const [lastName, setLastName] = useState(user?.lastName || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [photo, setPhoto] = useState("");
  const [signature, setSignature] = useState("");
  const [imageError, setImageError] = useState("");

  // Photo/signature are base64 and kept out of localStorage, so load them from the server.
  useEffect(() => {
    client
      .get("/auth/me")
      .then((r) => {
        setPhoto(r.data.photo || "");
        setSignature(r.data.signature || "");
      })
      .catch(() => {});
  }, []);

  async function handleImage(e, kind) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImageError("");
    if (!file.type.startsWith("image/")) {
      setImageError("Please choose an image file.");
      return;
    }
    try {
      if (kind === "photo") setPhoto(await resizeImageToDataUrl(file, 300, "image/jpeg"));
      else setSignature(await resizeImageToDataUrl(file, 500, "image/png"));
    } catch {
      setImageError("Could not process that image.");
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await client.put("/auth/me", { firstName, lastName, phone, photo, signature });
      const updated = { ...user, firstName: data.firstName, lastName: data.lastName, phone: data.phone };
      localStorage.setItem("user", JSON.stringify(updated));
      setUser(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.response?.data?.error || "Could not update profile.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg">
      <h2 className="text-2xl font-display font-semibold mb-6">My profile</h2>
      <form onSubmit={handleSubmit} className="card p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Email</label>
          <input className="input bg-line/20 text-slate/50" value={user?.email || ""} disabled />
          <p className="text-xs text-slate/40 mt-1">Email can't be changed here — contact an admin if it needs to change.</p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">First name</label>
          <input className="input" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Last name</label>
          <input className="input" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Phone</label>
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0700000000" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Passport photo</label>
          <div className="flex items-center gap-3">
            {photo ? (
              <img src={photo} alt="Passport photo" className="w-24 h-28 rounded object-cover border border-line" />
            ) : (
              <div className="w-24 h-28 rounded border border-dashed border-line flex items-center justify-center text-slate/40 text-xs text-center px-2">
                No photo
              </div>
            )}
            <div className="space-y-2">
              <input className="input" type="file" accept="image/*" onChange={(e) => handleImage(e, "photo")} />
              {photo && (
                <button type="button" className="text-rust text-xs underline" onClick={() => setPhoto("")}>
                  Remove photo
                </button>
              )}
            </div>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Signature</label>
          <div className="flex items-center gap-3">
            {signature ? (
              <img src={signature} alt="Signature" className="w-40 h-20 rounded object-contain bg-white border border-line" />
            ) : (
              <div className="w-40 h-20 rounded border border-dashed border-line flex items-center justify-center text-slate/40 text-xs text-center px-2">
                No signature
              </div>
            )}
            <div className="space-y-2">
              <input className="input" type="file" accept="image/*" onChange={(e) => handleImage(e, "signature")} />
              {signature && (
                <button type="button" className="text-rust text-xs underline" onClick={() => setSignature("")}>
                  Remove signature
                </button>
              )}
            </div>
          </div>
          <p className="text-xs text-slate/40 mt-1">Sign on white paper, take a clear photo, and upload it. Click "Save changes" to keep both images.</p>
        </div>
        {imageError && <p className="text-rust text-sm">{imageError}</p>}
        {error && <p className="text-rust text-sm">{error}</p>}
        <div className="flex items-center gap-3">
          <button className="btn-primary" type="submit" disabled={loading}>
            {loading ? "Saving…" : "Save changes"}
          </button>
          {saved && <span className="text-moss text-sm">Saved.</span>}
        </div>
      </form>
    </div>
  );
}
