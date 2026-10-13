import { useState, useEffect } from 'react';
import './App.scss';

function App() {
  const [healthStatus, setHealthStatus] = useState('idle'); // 'idle' | 'loading' | 'success' | 'error'
  const [healthData, setHealthData] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');

  const apiUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

  const checkHealth = async () => {
    setHealthStatus('loading');
    setErrorMessage('');
    try {
      const response = await fetch(`${apiUrl}/health`);
      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }
      const data = await response.json();
      setHealthData(data);
      setHealthStatus('success');
    } catch (err) {
      setHealthStatus('error');
      setErrorMessage(err.message || 'Failed to reach API server');
      setHealthData(null);
    }
  };

  useEffect(() => {
    checkHealth();
  }, []);

  return (
    <div className="app-container">
      <header className="hero">
        <span className="badge">Foundation Setup Phase</span>
        <h1 className="title">Doon Anandam CRM</h1>
        <p className="subtitle">
          Enterprise Customer Relationship Management foundation scaffolded for scalability and production readiness.
        </p>
      </header>

      <section className="cards-grid">
        <div className="card">
          <div className="card-header">
            <span className="card-icon">⚡</span>
            <h3>Frontend</h3>
          </div>
          <p>React 18 + Vite with SCSS styling, modern tokens, and fast HMR development server.</p>
          <span className="pill">Port: 5173</span>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-icon">🛡️</span>
            <h3>Backend</h3>
          </div>
          <p>Node.js &amp; Express using native ES Modules, Helmet security, CORS, and rate limiting.</p>
          <span className="pill">Port: 5000</span>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-icon">🗄️</span>
            <h3>Database</h3>
          </div>
          <p>MongoDB with Mongoose ODM (Architecture ready, connection deferred to next phase).</p>
          <span className="pill">MongoDB Atlas</span>
        </div>
      </section>

      <section className="health-panel">
        <div className="health-header">
          <h2>Backend Health Check</h2>
          <button
            className="check-btn"
            onClick={checkHealth}
            disabled={healthStatus === 'loading'}
          >
            {healthStatus === 'loading' ? 'Checking...' : 'Re-check Status'}
          </button>
        </div>

        {healthStatus === 'loading' && (
          <div className="status-box loading">
            <div className="status-title">⏳ Connecting to Backend...</div>
            <p className="status-detail">Querying {apiUrl}/health</p>
          </div>
        )}

        {healthStatus === 'success' && (
          <div className="status-box success">
            <div className="status-title">✅ API Server Connected</div>
            <p className="status-detail">Endpoint responded successfully with status 200 OK.</p>
            <pre>{JSON.stringify(healthData, null, 2)}</pre>
          </div>
        )}

        {healthStatus === 'error' && (
          <div className="status-box error">
            <div className="status-title">⚠️ API Server Unreachable</div>
            <p className="status-detail">
              {errorMessage}. Ensure the Express server is running on port 5000 (<code>cd server && npm run dev</code>).
            </p>
          </div>
        )}
      </section>

      <footer className="footer">
        Doon Anandam CRM &copy; {new Date().getFullYear()} &bull; Foundation Phase Active
      </footer>
    </div>
  );
}

export default App;
