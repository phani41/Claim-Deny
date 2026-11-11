import { useEffect, useState } from "react";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "/api";

function LegacyApp() {
  const [apiStatus, setApiStatus] = useState("Checking API...");

  useEffect(() => {
    let active = true;
    fetch(apiBaseUrl + "/health")
      .then((response) => {
        if (!response.ok) throw new Error("API returned " + response.status);
        return response.json();
      })
      .then((result) => {
        if (active) setApiStatus("API is " + result.status);
      })
      .catch(() => {
        if (active) setApiStatus("API is unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main>
      <p className="eyebrow">HLT-06 · local setup</p>
      <h1>Claim Denial &amp; Appeal-Letter Assistant</h1>
      <p className="intro">
        Secure claim review, evidence tracking, and appeal preparation for provider revenue-cycle teams.
      </p>
      <p className="status" role="status">{apiStatus}</p>
    </main>
  );
}

export { default } from "./router.jsx";
