import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Layers, Map, AlertTriangle, Award, Shield, DollarSign } from 'lucide-react';
import FloorPlanViewer from './components/FloorPlanViewer';
import './index.css';

const API_BASE = 'http://localhost:8000/api';

function App() {
  const [plans, setPlans] = useState([]);
  const [activePlan, setActivePlan] = useState(null);
  const [parsedData, setParsedData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedWall, setSelectedWall] = useState(null);

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
    let cancelled = false;
    
    async function parsePlan() {
      setLoading(true);
      setError(null);
      setSelectedWall(null);
      try {
        const res = await axios.get(`${API_BASE}/parse/${activePlan}`);
        if (!cancelled) {
          setParsedData(res.data.data);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError('Failed to parse floor plan.');
          setLoading(false);
        }
      }
    }
    parsePlan();
    return () => { cancelled = true; };
  }, [activePlan]);

  const handleWallClick = (wall) => {
    setSelectedWall(prev => prev?.id === wall.id ? null : wall);
  };

  return (
    <div className="app-container">
      {/* 3D Canvas */}
      <FloorPlanViewer 
        parsedData={parsedData} 
        selectedWallId={selectedWall?.id}
        onWallClick={handleWallClick}
      />

      {/* UI Overlay */}
      <div className="ui-overlay">
        
        {/* Brand */}
        <header className="header">
          <div className="brand">
            <Layers size={28} />
            <span>ArchIntel</span>
          </div>
        </header>

        {/* Left Sidebar */}
        <aside className="sidebar glass-panel">
          <h2 className="panel-title">Floor Plans</h2>
          <div className="plan-selector">
            {plans.map(plan => (
              <button 
                key={plan.id}
                className={`plan-btn ${activePlan === plan.id ? 'active' : ''}`}
                onClick={() => setActivePlan(plan.id)}
              >
                <span>{plan.id.replace('_', ' ').toUpperCase()}</span>
                <Map size={16} />
              </button>
            ))}
          </div>

          <div className="divider" />

          <h2 className="panel-title">Structure Overview</h2>
          
          {loading ? (
            <div className="loading-text">Analyzing geometry...</div>
          ) : parsedData ? (
            <>
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
                  <div className="stat-value">{parsedData.geometry_stats.building_area_m2}</div>
                  <div className="stat-label">Area (m²)</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{parsedData.walls.length}</div>
                  <div className="stat-label">Total Walls</div>
                </div>
              </div>
              
              <div className="legend">
                <div className="legend-item">
                  <div className="legend-color load-bearing" />
                  <span>Load-Bearing Structure</span>
                </div>
                <div className="legend-item">
                  <div className="legend-color partition" />
                  <span>Interior Partition</span>
                </div>
              </div>

              <div className="hint-text">
                Click a wall in the 3D view to see material recommendations
              </div>
            </>
          ) : null}
        </aside>

        {/* Material Analysis Panel — appears when a wall is selected */}
        {selectedWall && selectedWall.topsis_results && (
          <div className="material-panel glass-panel">
            <div className="material-panel-header">
              <h2 className="panel-title">Material Analysis</h2>
              <button className="close-btn" onClick={() => setSelectedWall(null)}>✕</button>
            </div>

            {/* Wall Identity */}
            <div className="wall-identity">
              <span className={`wall-badge ${selectedWall.type}`}>
                {selectedWall.type === 'load_bearing' ? '🔵 Load-Bearing' : '⚪ Partition'}
              </span>
              <span className="wall-id">{selectedWall.id}</span>
            </div>

            {/* Dimensions */}
            <div className="wall-dims">
              <div><strong>Length:</strong> {selectedWall.length_m}m</div>
              <div><strong>Thickness:</strong> {(selectedWall.thickness_m * 1000).toFixed(0)}mm</div>
              <div><strong>Orient:</strong> {selectedWall.orientation}</div>
              <div><strong>Reason:</strong> <em>{selectedWall.reason}</em></div>
            </div>

            {/* Concern Flags */}
            {selectedWall.concerns && selectedWall.concerns.length > 0 && (
              <div className="concern-box">
                <AlertTriangle size={16} />
                {selectedWall.concerns.map((c, i) => (
                  <div key={i} className="concern-text">{c.message}</div>
                ))}
              </div>
            )}

            {/* Weight Profile */}
            <div className="weight-profile">
              <div className="weight-label">{selectedWall.topsis_results.weight_profile.label}</div>
              <div className="weight-bars">
                {Object.entries(selectedWall.topsis_results.weight_profile.weights).map(([key, val]) => (
                  <div key={key} className="weight-bar-row">
                    <span className="weight-name">
                      {key === 'cost' ? <DollarSign size={12}/> : key === 'strength' ? <Shield size={12}/> : <Award size={12}/>}
                      {key}
                    </span>
                    <div className="weight-bar-track">
                      <div className="weight-bar-fill" style={{ width: `${val * 100}%` }} />
                    </div>
                    <span className="weight-pct">{Math.round(val * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Top 3 Materials */}
            <h3 className="panel-title" style={{ marginTop: 12 }}>Top 3 Recommendations</h3>
            <div className="material-rankings">
              {selectedWall.topsis_results.rankings.map((mat) => (
                <div key={mat.rank} className={`material-card rank-${mat.rank}`}>
                  <div className="material-rank">#{mat.rank}</div>
                  <div className="material-info">
                    <div className="material-name">{mat.name}</div>
                    <div className="material-use">{mat.best_use}</div>
                  </div>
                  <div className="material-score">{(mat.score * 100).toFixed(1)}%</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="loading-overlay">
            <div className="spinner" />
            <div>Constructing 3D Geometry...</div>
          </div>
        )}
        
        {/* Error State */}
        {error && (
          <div className="error-panel glass-panel">
            <h3>⚠ Connection Error</h3>
            <p>{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
