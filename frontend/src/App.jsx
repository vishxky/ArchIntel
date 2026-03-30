import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { Layers, Map, Upload, AlertCircle, FileText, IndianRupee, Cpu, Box, Loader2, Download, Zap, Image as ImageIcon, BoxSelect } from 'lucide-react';
import FloorPlanViewer from './components/FloorPlanViewer';
import './index.css';

const API_BASE = 'http://localhost:8000/api';

function App() {
  const [plans, setPlans] = useState([]);
  const [activePlan, setActivePlan] = useState(null);
  const [parsedData, setParsedData] = useState(null);
  const [costData, setCostData] = useState(null);
  
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  
  const [selectedWall, setSelectedWall] = useState(null);
  const [explanation, setExplanation] = useState(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [showDebugImage, setShowDebugImage] = useState(false);
  
  const [activeTab, setActiveTab] = useState('materials');
  const fileInputRef = useRef(null);
  const viewerRef = useRef(null);

  useEffect(() => {
    async function fetchPlans() {
      try {
        const res = await axios.get(`${API_BASE}/plans`);
        setPlans(res.data.plans);
        if (res.data.plans.length > 0) setActivePlan(res.data.plans[0].id);
      } catch (err) {
        setError('Failed to connect to ArchIntel API.');
      }
    }
    fetchPlans();
  }, []);

  useEffect(() => {
    if (!activePlan) return;
    let cancelled = false;
    
    async function fetchAll() {
      setLoading(true); setError(null);
      setSelectedWall(null); setExplanation(null); setCostData(null);
      
      try {
        const [parseRes, costRes] = await Promise.all([
          axios.get(`${API_BASE}/parse/${activePlan}`),
          axios.get(`${API_BASE}/cost/${activePlan}`).catch(() => ({ data: { data: null } }))
        ]);
        
        if (!cancelled) {
          setParsedData(parseRes.data.data);
          setCostData(costRes.data?.data);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError('Failed to process floor plan API requests.');
          setLoading(false);
        }
      }
    }
    fetchAll();
    return () => { cancelled = true; };
  }, [activePlan]);

  const handleWallClick = useCallback(async (wall) => {
    if (selectedWall?.id === wall.id) {
      setSelectedWall(null);
      setExplanation(null);
      return;
    }
    
    setSelectedWall(wall);
    setExplainLoading(true);
    setExplanation(null);
    
    if (activeTab === 'cost') setActiveTab('materials');

    try {
      const res = await axios.get(`${API_BASE}/explain/${activePlan}/${wall.id}`);
      if (res.data.success) {
        setExplanation(res.data);
      }
    } catch (err) {
      setExplanation({ explanation: 'AI Generation failed. Fallback triggered.', provider: 'error' });
    } finally {
      setExplainLoading(false);
    }
  }, [selectedWall, activePlan, activeTab]);

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    setUploading(true);
    try {
      const res = await axios.post(`${API_BASE}/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const listRes = await axios.get(`${API_BASE}/plans`);
      setPlans(listRes.data.plans);
      setActivePlan(res.data.plan_id);
    } catch (err) {
      alert("Failed to upload image. Must be PNG/JPG.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const getSourceImageUrl = () => {
    if (!activePlan) return '';
    return `${API_BASE}/image/${activePlan}?t=${new Date().getTime()}`;
  };

  const getDebugImageUrl = () => {
    if (!activePlan) return '';
    return `${API_BASE}/debug_image/${activePlan}?t=${new Date().getTime()}`;
  };

  const exportGLB = () => {
    if (viewerRef.current?.exportGLB) {
      viewerRef.current.exportGLB(`${activePlan}_3dmodel.glb`);
    } else {
      alert("GLB export feature is not ready yet.");
    }
  };

  const exportPDF = () => {
    if (!costData || !costData.walls) return;
    
    const doc = new jsPDF();
    doc.setFont("helvetica", "normal");
    
    // Header
    doc.setFontSize(18);
    doc.setTextColor(0, 0, 0);
    doc.text("ArchIntel - Architectural Estimate Report", 14, 22);
    
    doc.setFontSize(12);
    doc.setTextColor(80, 80, 80);
    doc.text(`Plan Name: ${activePlan || 'Unknown'}`, 14, 32);
    doc.text(`Total Estimated Budget: INR ${costData.total_cost?.toLocaleString('en-IN')}`, 14, 40);
    
    // Table
    const tableColumn = ["Sl. No.", "Item Name", "Cost per unit", "Quantity", "Total Amount", "Justification"];
    const tableRows = [];
    
    costData.walls.forEach((w, index) => {
      tableRows.push([
        index + 1,
        `Wall ${w.wall_id}: ${w.material}`,
        `Rs. ${w.unit_rate?.toLocaleString('en-IN')} / cu.m.`,
        `${w.volume_m3} cu.m.`,
        `Rs. ${Math.round(w.cost).toLocaleString('en-IN')}`,
        w.justification || "Selected via AI Optimization"
      ]);
    });
    
    autoTable(doc, {
      head: [tableColumn],
      body: tableRows,
      startY: 50,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [0, 112, 243] }, // Vercel blue
    });
    
    doc.save(`${activePlan || 'project'}_estimate.pdf`);
  };

  return (
    <div className="dashboard">
      
      {/* LEFT SIDEBAR */}
      <aside className="sidebar">
        
        <div className="brand">
          <img src="/archintel-logo.png" alt="ArchIntel Logo" />
          <h1>ArchIntel</h1>
        </div>
        
        <div className="section-title">Blueprint Selection</div>
        <div className="plan-list">
          {plans.map(p => (
            <button 
              key={p.id} 
              className={`btn ${activePlan === p.id ? 'active' : ''}`}
              onClick={() => setActivePlan(p.id)}
            >
              {p.id.replace('_', ' ')}
            </button>
          ))}
        </div>
        
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="spinner" /> : <Upload size={16} />} 
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/png, image/jpeg" style={{ display: 'none' }} />
          
          <button className="btn" onClick={exportGLB} title="Download GLB" disabled={!parsedData}>
            <Download size={16} /> Export
          </button>
        </div>

        <div className="divider" />
        
        {/* ANALYSIS TABS */}
        <div className="tabs">
          <button className={`tab ${activeTab === 'materials' ? 'active' : ''}`} onClick={() => setActiveTab('materials')}>MATERIALS</button>
          <button className={`tab ${activeTab === 'ai' ? 'active' : ''}`} onClick={() => setActiveTab('ai')}>AI REPORT</button>
          <button className={`tab ${activeTab === 'cost' ? 'active' : ''}`} onClick={() => setActiveTab('cost')}>ESTIMATE</button>
        </div>

        <div className="detail-content">
          
          {loading ? (
            <div className="loading-full" style={{ height: '200px' }}>
              <div className="spinner" />
              <div style={{ fontSize: '12px' }}>ANALYZING...</div>
            </div>
          ) : !parsedData ? (
             <div className="empty-state">
               <AlertCircle size={24} />
               No structural data available for this plan.
             </div>
          ) : (
            <>
              {/* MATERIALS VIEWER */}
              {activeTab === 'materials' && (
                <>
                  <div className="stat-grid">
                    <div className="stat-card">
                      <div className="section-title" style={{ marginBottom: 4 }}>Volume</div>
                      <div className="stat-val">{parsedData.geometry_stats?.total_volume_m3 || 0}m³</div>
                    </div>
                    <div className="stat-card">
                      <div className="section-title" style={{ marginBottom: 4 }}>Area</div>
                      <div className="stat-val">{parsedData.geometry_stats?.building_area_m2 || 0}m²</div>
                    </div>
                  </div>
                  
                  <div className="card">
                    <div className="section-title">Wall Inspector</div>
                    <div className="wall-grid">
                      {parsedData.walls?.map(w => (
                        <div 
                          key={w.id} 
                          className={`wall-chip ${selectedWall?.id === w.id ? 'active' : ''}`} 
                          onClick={() => handleWallClick(w)}
                        >
                          {w.id}
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  {selectedWall && (
                    <div className="card" style={{ borderColor: 'var(--primary)' }}>
                      <div className="section-title" style={{ color: 'var(--primary)' }}>Wall {selectedWall.id} Report</div>
                      <table style={{ marginBottom: 16 }}>
                        <tbody>
                          <tr><td>TYPE</td><td>{selectedWall.is_load_bearing ? 'Load-Bearing' : 'Partition'}</td></tr>
                          <tr><td>LENGTH</td><td>{selectedWall.length_m} m</td></tr>
                          <tr><td>THICKNESS</td><td>{(selectedWall.thickness_m * 100).toFixed(1)} cm</td></tr>
                        </tbody>
                      </table>
                      
                      <div className="section-title">TOPSIS Ranking</div>
                      {selectedWall.topsis_results && selectedWall.topsis_results.rankings ? (
                        <table>
                          <tbody>
                            {selectedWall.topsis_results.rankings.slice(0, 3).map((res, i) => (
                              <tr key={res.name}>
                                <td style={{ color: i === 0 ? 'var(--primary)' : 'inherit' }}>{res.name}</td>
                                <td>{(res.score * 100).toFixed(1)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div className="text-body" style={{ fontStyle: 'italic' }}>No material data available.</div>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* AI REPORT */}
              {activeTab === 'ai' && (
                <div className="card" style={{ flex: 1 }}>
                  {!selectedWall ? (
                    <div className="empty-state">
                      <Zap size={24} />
                      <p>Select a Wall from the "Materials" tab or the 3D viewer to generate an intelligent structural report.</p>
                    </div>
                  ) : explainLoading ? (
                    <div className="loading-full" style={{ height: '100px' }}>
                      <div className="spinner" />
                    </div>
                  ) : explanation ? (
                    <>
                      <div className="section-title" style={{ color: 'var(--primary)' }}>{explanation.provider.toUpperCase()} ENGINE</div>
                      <div className="text-body" style={{ whiteSpace: 'pre-line' }}>{explanation.explanation}</div>
                    </>
                  ) : null}
                </div>
              )}

              {/* COST ESTIMATE */}
              {activeTab === 'cost' && (
                <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    Total Project Estimate
                    <button className="btn" style={{ width: 'auto', padding: '4px 12px', fontSize: '10px' }} onClick={exportPDF}>
                      EXPORT PDF
                    </button>
                  </div>
                  <div className="stat-val" style={{ color: '#00e676', fontSize: '28px', marginBottom: 20 }}>
                    ₹ {costData?.total_cost?.toLocaleString('en-IN') || 0}
                  </div>
                  
                  <div className="section-title">Material Breakdown</div>
                  <div style={{ overflowY: 'auto', flex: 1 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>WALL</th>
                          <th>MATERIAL</th>
                          <th style={{ textAlign: 'right' }}>COST</th>
                        </tr>
                      </thead>
                      <tbody>
                        {costData?.walls?.map(w => (
                          <tr key={w.wall_id}>
                            <td>{w.wall_id}</td>
                            <td style={{ fontSize: '10px' }}>{w.material}</td>
                            <td style={{ textAlign: 'right', color: '#69f0ae' }}>₹{Math.round(w.cost).toLocaleString('en-IN')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </aside>

      {/* RIGHT MAIN VIEW */}
      <main className="main-view">
        {/* 2D Image View */}
        <section className="pane">
          <div className="pane-header" style={{ justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ImageIcon size={14} /> 2D Source
            </span>
            <button 
              className={`btn ${showDebugImage ? 'active' : ''}`} 
              style={{ width: 'auto', padding: '4px 8px', fontSize: '10px' }}
              onClick={() => setShowDebugImage(!showDebugImage)}
            >
              {showDebugImage ? 'VIEW ORIGINAL' : 'VIEW AI OVERLAY'}
            </button>
          </div>
          <div className="pane-content">
            {activePlan && !uploading && !loading ? (
              <img 
                src={showDebugImage ? getDebugImageUrl() : getSourceImageUrl()} 
                alt="Source Map" 
                style={showDebugImage ? { filter: 'none' } : {}}
              />
            ) : (
              <div className="loading-full">
                {loading || uploading ? <div className="spinner" /> : <AlertCircle size={32} />}
              </div>
            )}
          </div>
        </section>
        
        {/* 3D Model View */}
        <section className="pane">
          <div className="pane-header">
            <BoxSelect size={14} /> 3D Extrusion
          </div>
          <div className="pane-content">
             <FloorPlanViewer 
                ref={viewerRef}
                parsedData={parsedData} 
                selectedWallId={selectedWall?.id}
                onWallClick={handleWallClick}
              />
          </div>
        </section>
      </main>

    </div>
  );
}

export default App;
