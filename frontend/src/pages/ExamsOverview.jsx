import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import client from "../api/client";

export default function ExamsOverview() {
  const [exams, setExams] = useState([]);
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [expandedLevels, setExpandedLevels] = useState(new Set());

  useEffect(() => {
    client.get("/grades/exams").then((r) => setExams(r.data));
  }, []);

  // Group exam records (one per class) by the exam sitting they belong to: name + term + year.
  const groups = {};
  exams.forEach((ex) => {
    const key = `${ex.name}|${ex.term}|${ex.year}`;
    if (!groups[key]) groups[key] = { name: ex.name, term: ex.term, year: ex.year, entries: [] };
    groups[key].entries.push(ex);
  });
  const groupKeys = Object.keys(groups).sort((a, b) => groups[b].year - groups[a].year || groups[b].term - groups[a].term);

  function toggleGroup(key) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }
  function toggleLevel(key) {
    setExpandedLevels((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  return (
    <div>
      <h2 className="text-2xl font-display font-semibold mb-1">Exams</h2>
      <p className="text-slate/60 text-sm mb-6">Every exam sitting, grouped by name/term/year. Expand a level to see its streams, then upload or view marks.</p>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate/50 uppercase text-xs tracking-wider border-b border-line bg-line/20">
              <th className="py-3 px-4">Exam</th>
              <th className="py-3 px-4">Classes</th>
              <th className="py-3 px-4"></th>
            </tr>
          </thead>
          <tbody>
            {groupKeys.map((key) => {
              const group = groups[key];
              const groupOpen = expandedGroups.has(key);

              // Levels within this exam sitting
              const levels = {};
              group.entries.forEach((ex) => {
                const level = ex.classRoom?.level || ex.classRoom?.name || "Unknown";
                if (!levels[level]) levels[level] = [];
                levels[level].push(ex);
              });
              const levelNames = Object.keys(levels).sort();

              return (
                <>
                  <tr key={key} className="border-b border-line/60 hover:bg-line/10 cursor-pointer" onClick={() => toggleGroup(key)}>
                    <td className="py-3 px-4 font-medium">{group.name}</td>
                    <td className="py-3 px-4 text-slate/60">Term {group.term}, {group.year} · {levelNames.length} level(s)</td>
                    <td className="py-3 px-4 text-right text-slate/40">{groupOpen ? "▾" : "▸"}</td>
                  </tr>

                  {groupOpen &&
                    levelNames.map((levelName) => {
                      const levelKey = `${key}|${levelName}`;
                      const levelOpen = expandedLevels.has(levelKey);
                      const streams = levels[levelName];

                      return (
                        <>
                          <tr
                            key={levelKey}
                            className="border-b border-line/60 bg-line/5 hover:bg-line/15 cursor-pointer"
                            onClick={() => toggleLevel(levelKey)}
                          >
                            <td className="py-2 px-4 pl-8 text-slate/70" colSpan={2}>{levelName} · {streams.length} stream(s)</td>
                            <td className="py-2 px-4 text-right text-slate/30">{levelOpen ? "▾" : "▸"}</td>
                          </tr>

                          {levelOpen &&
                            streams.map((ex) => (
                              <tr key={ex.id} className="border-b border-line/60">
                                <td className="py-2 px-4 pl-14 text-slate/60" colSpan={2}>
                                  {ex.classRoom.name}
                                  {ex.status === "PUBLISHED" && <span className="pill border border-moss/30 bg-moss/10 text-moss ml-2 text-xs">Published</span>}
                                  {ex.status === "LOCKED" && <span className="pill border border-ink/30 bg-ink/10 text-ink ml-2 text-xs">Locked</span>}
                                </td>
                                <td className="py-2 px-4 text-right">
                                  <Link to={`/marks/${ex.classRoomId}/${ex.id}`} className="btn-secondary text-xs">
                                    Upload / View marks
                                  </Link>
                                </td>
                              </tr>
                            ))}
                        </>
                      );
                    })}
                </>
              );
            })}
            {groupKeys.length === 0 && (
              <tr><td colSpan={3} className="py-6 text-center text-slate/50">No exams created yet — head to Grades to create one.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
