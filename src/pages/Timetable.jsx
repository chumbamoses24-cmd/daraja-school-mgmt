import { useEffect, useState } from "react";
import client from "../api/client";

const DAYS = { 1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday" };

export default function Timetable() {
  const [classRooms, setClassRooms] = useState([]);
  const [classRoomId, setClassRoomId] = useState("");
  const [slots, setSlots] = useState([]);

  useEffect(() => {
    client.get("/students/classrooms").then((r) => {
      setClassRooms(r.data);
      if (r.data.length) setClassRoomId(String(r.data[0].id));
    });
  }, []);

  useEffect(() => {
    if (classRoomId) client.get(`/timetable?classRoomId=${classRoomId}`).then((r) => setSlots(r.data));
  }, [classRoomId]);

  const byDay = {};
  slots.forEach((s) => {
    byDay[s.dayOfWeek] = byDay[s.dayOfWeek] || [];
    byDay[s.dayOfWeek].push(s);
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-display font-semibold">Timetable</h2>
        <select className="input w-auto" value={classRoomId} onChange={(e) => setClassRoomId(e.target.value)}>
          {classRooms.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {Object.entries(DAYS).map(([num, name]) => (
          <div key={num} className="card p-4">
            <h3 className="font-display font-semibold mb-3 text-sm uppercase tracking-wider text-slate/60">{name}</h3>
            <div className="space-y-2">
              {(byDay[num] || []).map((slot) => (
                <div key={slot.id} className="border-l-2 border-ink pl-3 py-1">
                  <p className="text-xs font-mono text-slate/50">{slot.startTime}–{slot.endTime}</p>
                  <p className="text-sm font-medium">{slot.label || slot.classRoom?.name}</p>
                  {slot.teacher && <p className="text-xs text-slate/50">{slot.teacher.firstName} {slot.teacher.lastName}</p>}
                </div>
              ))}
              {(!byDay[num] || byDay[num].length === 0) && <p className="text-xs text-slate/40">No lessons</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
