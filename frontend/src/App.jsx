import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Layers, Cuboid, Building2, Map, Maximize, Activity } from 'lucide-react';
import FloorPlanViewer from './components/FloorPlanViewer';
import './index.css';

const API_BASE = 'http://localhost:8000/api';

function App() {
  const [plans, setPlans] = useState([]);
  const [activePlan, setActivePlan] = useState(null);
  const [parsedData, setParsedData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch available plans on mount
  useEffect(() => {
    async function fetchPlans() {
      try {
        const res = await axios.get(`${API_BASE}/plans`);
        setPlans(res.data.plans);
        if (res.data.plans.length > 0) {
          setActivePlan(res.data.plans[0].id);
        }
      } catch (err) {
        setError('Failed to connect to ArchIntel API. Is the backend running?');
        setLoading(false);
      }
    }
    fetchPlans();
  }, []);

  // Fetch parsed geometry when activePlan changes
  useEffect(() => {
    if (!activePlan) return;
    
    let isCancelled = false;
    
    async function parsePlan() {
      setLoading(true);
      setError(null);
      try {
        const res = await axios.get(`${API_BASE}/parse/${activePlan}`);
        if (!isCancelled) {
          setParsedData(res.data.data);
          setLoading(false);
        }
      } catch (err) {
        if (!isCancelled) {
          setError('Failed to parse floor plan. Check backend logs.');
          setLoading(false);
        }
      }
    }
    parsePlan();
    
    return () => { isCancelled = true; };
  }, [activePlan]);

  return (
    <div className="app-container">
      {/* 3D Canvas Layer */}
      <FloorPlanViewer parsedData={parsedData} />

      {/* UI Overlay Layer */}
      <div className="ui-overlay">
        
        {/* Header Branding */}
        <header className="header">
          <div className="brand">
            <Layers size={28} />
            <span>ArchIntel</span>
          </div>
        </header>

        {/* Sidebar Controls */}
        <aside className="sidebar glass-panel">
          <h2 className="panel-title">Floor Plans</h2>
          <div className="plan-selector">
            {plans.map(plan => (
              <button 
                key={plan.id}
                className={`plan-btn ${activePlan === plan.id ? 'active' : ''}`}
                onClick={() => setActivePlan(plan.id)}
              >
                <span>{plan.id.toUpperCase()}</span>
                <Map size={18} />
              </button>
            ))}
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.08)', margin: '16px 0' }} />

          <h2 className="panel-title">Structural Properties</h2>
          
          {loading ? (
            <div style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>
              Analyzing geometry...
            </div>
          ) : parsedData ? (
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{parsedData.geometry_stats.load_bearing_walls}</div>
                <div className="stat-label">Load-Bearing</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{parsedData.geometry_stats.partition_walls}</div>
                <div className="stat-label">Partitions</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{parsedData.scale.px_per_meter}</div>
                <div className="stat-label">PX / M</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{parsedData.geometry_stats.building_area_m2}</div>
                <div className="stat-label">Area (M²)</div>
              </div>
            </div>
          ) : null}

          <div className="legend glass-panel" style={{ padding: '12px', marginTop: '8px' }}>
            <div className="legend-item">
              <div className="legend-color load-bearing" />
              <span>Load-Bearing Structure</span>
            </div>
            <div className="legend-item">
              <div className="legend-color partition" />
              <span>Interior Partitions</span>
            </div>
          </div>
        </aside>

        {/* Loading / Error States */}
        {loading && (
          <div className="loading-overlay">
            <div className="spinner"></div>
            <div>Constructing 3D Geometry...</div>
          </div>
        )}
        
        {error && (
          <div className="glass-panel" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', padding: '24px', color: '#fb7185', background: 'rgba(50,15,20,0.8)', border: '1px solid #e11d48', zIndex: 100 }}>
            <h3>Error</h3>
            <p>{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
