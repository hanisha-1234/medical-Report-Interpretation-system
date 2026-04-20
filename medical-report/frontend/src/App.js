import React, { useState } from "react";
import axios from "axios";
import "./App.css";

const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:5000";

function App() {
  const [file, setFile] = useState(null);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  const analyzeReport = async () => {
    if (!file) {
      alert("Please upload a report.");
      return;
    }

    const formData = new FormData();
    formData.append("newReport", file);

    try {
      setLoading(true);
      setReport(null);

      const res = await axios.post(
        `${API_BASE}/analyze-report`,
        formData,
        {
          headers: { "Content-Type": "multipart/form-data" }
        }
      );

      setReport(res.data.report);
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || "AI processing failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <h1>🩺 MediClarify</h1>
      <h3>AI Medical Report Explainer</h3>

      <div className="upload-section">
        <input
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={(e) => setFile(e.target.files[0])}
        />

        {file && <p>Selected: {file.name}</p>}

        <button onClick={analyzeReport} disabled={loading}>
          {loading ? "Analyzing..." : "Analyze Report"}
        </button>
      </div>

      {loading && <p>🔄 Extracting and analyzing medical report...</p>}

      {report && (
        <div className="summary-card">
          <h2>📋 Medical Report Summary</h2>

          <p><strong>Transcription:</strong> {report.transcription}</p>
          <p><strong>Simple Explanation:</strong> {report.simple_summary}</p>

          <h3>Key Findings</h3>
          <ul>
            {report.key_findings?.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>

          <h3>Medications</h3>

{report.medications && report.medications.length > 0 ? (
  <ul>
    {report.medications.map((item, i) => (
      <li key={i}>{item}</li>
    ))}
  </ul>
) : (
  <p>No medications mentioned in this report.</p>
)}

          <h3>Recommendations</h3>
          <p>{report.recommendations}</p>

          <p>
            <strong>Confidence Score:</strong>{" "}
            {report.confidence_score || "N/A"}
          </p>
        </div>
      )}
    </div>
  );
}

export default App;