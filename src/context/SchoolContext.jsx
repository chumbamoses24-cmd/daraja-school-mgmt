import { createContext, useContext, useEffect, useState } from "react";
import client from "../api/client";

const SchoolContext = createContext({ schoolName: "Daraja", refreshSchool: () => {} });

export function SchoolProvider({ children }) {
  const [schoolName, setSchoolName] = useState("Daraja");

  function refreshSchool() {
    client
      .get("/settings")
      .then((r) => setSchoolName(r.data.schoolName))
      .catch(() => {}); // fine to silently keep the fallback name if this fails
  }

  useEffect(() => {
    refreshSchool();
  }, []);

  useEffect(() => {
    document.title = `${schoolName} — School Management`;
  }, [schoolName]);

  return <SchoolContext.Provider value={{ schoolName, refreshSchool }}>{children}</SchoolContext.Provider>;
}

export function useSchool() {
  return useContext(SchoolContext);
}
