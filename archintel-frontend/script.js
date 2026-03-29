// ========================================================================
// ArchIntel — Frontend Application
// ========================================================================
// DATA FLOW:
//   1. User uploads / selects plan  → preview thumbnail in toolbar
//   2. User clicks Analyze          → POST image to /api/parse
//   3. Backend returns JSON (walls, rooms, openings)
//                                   → draw analysis overlay on 2D canvas
//                                     (edges, colored walls, room polygons)
//   4. Frontend builds 3D model from parse JSON via Three.js
//   5. POST walls → /api/materials  → TOPSIS rankings
//   6. POST walls+rankings → /api/explain → LLM explanations
//   7. Render material accordion cards + concerns
// ========================================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ─── CONFIG ──────────────────────────────────────────────────────────────
const API_BASE = 'http://localhost:8000';

// ─── DOM REFS ─────────────────────────────────────────────────────────────
const fileInput          = document.getElementById('file-input');
const btnUpload          = document.getElementById('btn-upload');
const btnAnalyze         = document.getElementById('btn-analyze');
const btnExport          = document.getElementById('btn-export');
const btnResetCamera     = document.getElementById('btn-reset-camera');
const btnToggleRotate    = document.getElementById('btn-toggle-rotate');
const btnExpandBottom    = document.getElementById('btn-expand-bottom');
const bottomToggleHeader = document.getElementById('bottom-toggle-header');
const backendIndicator   = document.getElementById('backend-indicator');
const statusDot          = document.getElementById('status-dot');
const statusText         = document.getElementById('status-text');
const loadingOverlay     = document.getElementById('loading-overlay');
const loadingText        = document.getElementById('loading-text');
const loadingSub         = document.getElementById('loading-sub');
const progressBar        = document.getElementById('progress-bar');
const planButtons        = document.querySelectorAll('.btn-tab');
const layerButtons       = document.querySelectorAll('.layer-btn');

// Preview slot (toolbar)
const previewEmpty  = document.getElementById('preview-empty');
const previewLoaded = document.getElementById('preview-loaded');
const previewImg    = document.getElementById('preview-img');
const previewName   = document.getElementById('preview-name');
const previewDims   = document.getElementById('preview-dims');
const previewClear  = document.getElementById('preview-clear');

// 2D Analysis panel (shows backend output ONLY)
const canvas2d      = document.getElementById('canvas-2d');
const ctx           = canvas2d.getContext('2d');
const emptyState2d  = document.getElementById('empty-state-2d');
const statsBar2d    = document.getElementById('stats-bar-2d');
const statWalls     = document.getElementById('stat-walls');
const statRooms     = document.getElementById('stat-rooms');
const statOpenings  = document.getElementById('stat-openings');
const statScale     = document.getElementById('stat-scale');

// 3D panel
const emptyState3d  = document.getElementById('empty-state-3d');
const legend3d      = document.getElementById('legend-3d');

// Bottom panel
const emptyStateMat = document.getElementById('empty-state-materials');
const materialCards = document.getElementById('material-cards');
const concernsSect  = document.getElementById('concerns-section');
const concernsList  = document.getElementById('concerns-list');

// Fallback panel
const btnFallback    = document.getElementById('btn-fallback');
const fbOverlay      = document.getElementById('fallback-overlay');
const fbPanel        = document.getElementById('fallback-panel');
const fbClose        = document.getElementById('fb-close');
const fbBuildingWidth= document.getElementById('fb-building-width');
const fbImgWidth     = document.getElementById('fb-img-width');
const fbScaleVal     = document.getElementById('fb-scale-val');
const fbAddWall      = document.getElementById('fb-add-wall');
const wallsTbody     = document.getElementById('walls-tbody');
const fbAddRoom      = document.getElementById('fb-add-room');
const roomsList      = document.getElementById('rooms-list');
const fbAddOpening   = document.getElementById('fb-add-opening');
const openingsTbody  = document.getElementById('openings-tbody');
const fbWallCount    = document.getElementById('fb-wall-count');
const fbReset        = document.getElementById('fb-reset');
const fbApply        = document.getElementById('fb-apply');

// ─── APP STATE ────────────────────────────────────────────────────────────
const state = {
    currentFile:   null,   // File from upload or sample plan fetch
    currentImage:  null,   // HTMLImageElement for preview only
    activePlan:    null,   // 'A' | 'B' | 'C'
    parseResult:   null,   // JSON from /api/parse
    materialsResult: null, // JSON from /api/materials
    explanations:  null,   // JSON from /api/explain
    activeLayer:   'edges',// which 2D overlay is displayed: edges|walls|rooms
    useFallback:   false,  // whether manual entry is active
};

// =========================================================================
//  THREE.JS — 3D SCENE
// =========================================================================
const threeContainer = document.getElementById('three-container');
let scene, camera, renderer, controls, wallMeshes = [];

function initThreeJS() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05060a);

    const w = threeContainer.clientWidth || 1;
    const h = threeContainer.clientHeight || 1;

    camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
    camera.position.set(8, 8, 8);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    threeContainer.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.5;

    // Lights
    scene.add(new THREE.AmbientLight(0xb0bcd0, 0.5));
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(8, 15, 10);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    scene.add(dir);
    scene.add(new THREE.HemisphereLight(0x8899cc, 0x222233, 0.3));

    // Grid for sense of scale
    const grid = new THREE.GridHelper(20, 40, 0x1a1f30, 0x12151f);
    grid.material.opacity = 0.5;
    grid.material.transparent = true;
    scene.add(grid);

    function animate() {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
    }
    animate();

    new ResizeObserver(() => {
        const w = threeContainer.clientWidth, h = threeContainer.clientHeight;
        if (!w || !h) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    }).observe(threeContainer);
}

initThreeJS();

// =========================================================================
//  UTILITY HELPERS
// =========================================================================
function setStatus(text, type = 'ready') {
    statusText.textContent = text;
    statusDot.className = 'status-dot status-' + type;
}

function showLoading(main, sub = '', pct = 0) {
    loadingText.textContent = main;
    loadingSub.textContent  = sub;
    progressBar.style.width = pct + '%';
    loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
    loadingOverlay.classList.add('hidden');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Backend health check ─────────────────────────────────────────────────
async function checkBackend() {
    try {
        // mode:no-cors won't throw on CORS, will throw on connection refused
        await fetch(API_BASE + '/docs', { method: 'HEAD', mode: 'no-cors' });
        backendIndicator.className = 'backend-indicator connected';
        backendIndicator.title = 'Backend connected at ' + API_BASE;
    } catch {
        backendIndicator.className = 'backend-indicator disconnected';
        backendIndicator.title = 'Backend not reachable — start FastAPI first';
    }
}
checkBackend();
setInterval(checkBackend, 15000);

// =========================================================================
//  PLAN PREVIEW (toolbar thumbnail — shows raw plan image immediately)
// =========================================================================

// The preview section in the toolbar just shows the raw floor plan image
// so the user can see which plan they've selected. It does NOT trigger
// analysis and does NOT appear in the 2D Analysis panel.

function showPreview(img, label) {
    previewImg.src = img.src;
    previewName.textContent = label;
    previewDims.textContent = img.naturalWidth + ' × ' + img.naturalHeight + ' px';
    previewEmpty.style.display = 'none';
    previewLoaded.classList.remove('hidden');

    // Enable the Analyze button now that a plan is loaded
    btnAnalyze.disabled = false;
    setStatus('Plan loaded — click Analyze to process', 'ready');
}

function clearPreview() {
    previewEmpty.style.display = '';
    previewLoaded.classList.add('hidden');
    previewImg.src = '';
    state.currentFile = null;
    state.currentImage = null;
    state.activePlan = null;
    btnAnalyze.disabled = true;
    planButtons.forEach(b => b.classList.remove('active'));
    setStatus('Ready', 'ready');
}

previewClear.addEventListener('click', clearPreview);

// ─── Upload from disk ─────────────────────────────────────────────────────
btnUpload.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    state.currentFile = file;
    state.activePlan = null;
    planButtons.forEach(b => b.classList.remove('active'));

    const img = new Image();
    img.onload = () => {
        state.currentImage = img;
        showPreview(img, file.name);
    };
    img.src = URL.createObjectURL(file);
    // Reset the input so the same file can be picked again
    fileInput.value = '';
});

// ─── Sample plans (A / B / C) ─────────────────────────────────────────────
// Clicking A, B, or C:
//   1. Loads Plan-X.png from the local folder
//   2. Shows it in the PREVIEW thumbnail only
//   3. Does NOT touch the 2D Analysis panel
//   4. Does NOT run analysis

planButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const plan = btn.dataset.plan;
        state.activePlan = plan;
        planButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        loadSamplePlan(plan);
    });
});

function loadSamplePlan(planLetter) {
    const filename = `Plan-${planLetter}.png`;   // e.g. Plan-A.png

    const img = new Image();
    img.onload = () => {
        state.currentImage = img;
        showPreview(img, `Plan ${planLetter}`);
    };
    img.onerror = () => {
        setStatus(`Cannot load ${filename} — ensure it is in the project folder`, 'error');
    };
    img.src = filename;

    // Fetch as File object so /api/parse can receive it as multipart upload
    fetch(filename)
        .then(r => r.blob())
        .then(blob => {
            state.currentFile = new File([blob], filename, { type: 'image/png' });
        })
        .catch(() => {/* preview still works; Analyze will warn */});
}

// =========================================================================
//  2D ANALYSIS CANVAS — BACKEND OUTPUT ONLY
// =========================================================================
// This canvas is ONLY populated after /api/parse returns.
// It draws the backend's parsed data: detected edges, coloured wall lines,
// room polygon fills, and opening markers.
// The raw floor plan image is NOT shown here — only the analysis output.

const LAYER_MODES = { edges: 0, walls: 1, rooms: 2 };
let currentLayer = 'walls'; // default layer after analysis

function render2DAnalysis(parseData) {
    const panel   = document.getElementById('analysis-body');
    const maxW    = panel.clientWidth  - 24;
    const maxH    = panel.clientHeight - 24;

    // Determine canvas size from bounding box of all wall coordinates
    const walls    = parseData.walls    || [];
    const rooms    = parseData.rooms    || [];
    const openings = parseData.openings || [];

    // If backend provides an annotated_image_url, show that directly
    if (parseData.annotated_image_url) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const scale = Math.min(maxW / img.width, maxH / img.height, 1);
            canvas2d.width  = img.width  * scale;
            canvas2d.height = img.height * scale;
            ctx.clearRect(0, 0, canvas2d.width, canvas2d.height);
            ctx.drawImage(img, 0, 0, canvas2d.width, canvas2d.height);
            canvas2d.classList.add('visible');
            emptyState2d.classList.add('hidden');
        };
        img.src = API_BASE + parseData.annotated_image_url;
        return;
    }

    // ── Fallback: draw analysis overlay from JSON coordinates ──
    // Find overall bounding box of all detected geometry
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    walls.forEach(w => {
        [w.start, w.end].forEach(p => {
            minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
            minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
        });
    });

    if (!isFinite(minX)) {
        // No geometry — show message in canvas
        canvas2d.width  = maxW;
        canvas2d.height = maxH;
        ctx.fillStyle   = '#1a1f2e';
        ctx.fillRect(0, 0, canvas2d.width, canvas2d.height);
        ctx.fillStyle = '#8b95a5';
        ctx.font = '14px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No geometry detected in parse result', maxW / 2, maxH / 2);
        canvas2d.classList.add('visible');
        emptyState2d.classList.add('hidden');
        return;
    }

    // Add padding around the geometry
    const pad   = 30;
    const geoW  = (maxX - minX) || 1;
    const geoH  = (maxY - minY) || 1;
    const scale = Math.min((maxW - pad * 2) / geoW, (maxH - pad * 2) / geoH, 1);

    canvas2d.width  = Math.min(geoW * scale + pad * 2, maxW);
    canvas2d.height = Math.min(geoH * scale + pad * 2, maxH);

    // Coordinate transform: geometry pixel → canvas pixel
    function tx(px) { return (px - minX) * scale + pad; }
    function ty(py) { return (py - minY) * scale + pad; }

    // ── Draw dark background ──
    ctx.fillStyle = '#0d1018';
    ctx.fillRect(0, 0, canvas2d.width, canvas2d.height);

    if (currentLayer === 'rooms' || currentLayer === 'walls') {
        // Draw room polygon fills
        const roomPalette = [
            'rgba(59,91,219,0.10)', 'rgba(99,102,241,0.10)',
            'rgba(16,185,129,0.08)', 'rgba(245,158,11,0.08)',
            'rgba(168,85,247,0.08)', 'rgba(236,72,153,0.08)',
        ];
        rooms.forEach((room, i) => {
            const poly = room.polygon;
            if (!poly || poly.length < 3) return;
            ctx.beginPath();
            ctx.moveTo(tx(poly[0][0]), ty(poly[0][1]));
            for (let j = 1; j < poly.length; j++) ctx.lineTo(tx(poly[j][0]), ty(poly[j][1]));
            ctx.closePath();
            ctx.fillStyle = roomPalette[i % roomPalette.length];
            ctx.fill();
            // Room border (subtle)
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = 0.5;
            ctx.stroke();

            // Room label (if available)
            if (room.label) {
                const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
                const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
                ctx.fillStyle = 'rgba(193,199,208,0.6)';
                ctx.font = `${Math.max(9, 11 * scale)}px Inter, sans-serif`;
                ctx.textAlign = 'center';
                ctx.fillText(room.label, tx(cx), ty(cy));
            }
        });
    }

    if (currentLayer === 'edges' || currentLayer === 'walls') {
        // Draw wall lines — blue for load-bearing, grey for partition
        walls.forEach(wall => {
            const [x1, y1] = wall.start;
            const [x2, y2] = wall.end;
            const thick = Math.max(2, (wall.thickness_px || 6) * scale * 0.35);

            ctx.beginPath();
            ctx.moveTo(tx(x1), ty(y1));
            ctx.lineTo(tx(x2), ty(y2));
            ctx.lineWidth = thick;
            ctx.lineCap   = 'square';

            if (wall.type === 'load_bearing') {
                ctx.strokeStyle = '#4c6ef5';
                // Glow effect for load-bearing
                ctx.shadowBlur  = 6;
                ctx.shadowColor = 'rgba(59,91,219,0.5)';
            } else {
                ctx.strokeStyle = '#868e96';
                ctx.shadowBlur  = 0;
            }
            ctx.stroke();
            ctx.shadowBlur = 0;

            // Wall ID label at midpoint
            if (wall.id && scale > 0.4) {
                const mx = tx((x1 + x2) / 2);
                const my = ty((y1 + y2) / 2);
                ctx.fillStyle = wall.type === 'load_bearing' ? '#6b8cff' : '#9ca8b6';
                ctx.font = `bold ${Math.max(8, 9 * scale)}px JetBrains Mono, monospace`;
                ctx.textAlign = 'center';
                ctx.fillText(wall.id, mx, my - 5 * scale);
            }

            // Length dimension line (if meter value available)
            if (wall.length_m && scale > 0.45) {
                const mx = tx((x1 + x2) / 2);
                const my = ty((y1 + y2) / 2);
                ctx.fillStyle = 'rgba(193,199,208,0.55)';
                ctx.font = `${Math.max(7, 8 * scale)}px JetBrains Mono, monospace`;
                ctx.textAlign = 'center';
                ctx.fillText(wall.length_m.toFixed(1) + 'm', mx, my + 11 * scale);
            }
        });
    }

    // Draw openings (doors/windows) as glowing green dots
    openings.forEach(opening => {
        const pos = opening.position;
        if (!pos) return;
        ctx.beginPath();
        ctx.arc(tx(pos[0]), ty(pos[1]), 4 * Math.max(scale, 0.5), 0, Math.PI * 2);
        ctx.fillStyle   = '#10b981';
        ctx.shadowBlur  = 8;
        ctx.shadowColor = 'rgba(16,185,129,0.6)';
        ctx.fill();
        ctx.shadowBlur  = 0;
    });

    // Draw corner nodes
    if (currentLayer !== 'edges') {
        const corners = new Set();
        walls.forEach(w => {
            corners.add(`${w.start[0]},${w.start[1]}`);
            corners.add(`${w.end[0]},${w.end[1]}`);
        });
        corners.forEach(key => {
            const [px, py] = key.split(',').map(Number);
            ctx.beginPath();
            ctx.arc(tx(px), ty(py), 2.5, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.fill();
        });
    }

    canvas2d.classList.add('visible');
    emptyState2d.classList.add('hidden');
}

// Layer toggle button wiring
layerButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        if (btn.disabled) return;
        layerButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentLayer = btn.dataset.layer;
        // Re-render with the new layer
        if (state.parseResult) render2DAnalysis(state.parseResult);
    });
});

// =========================================================================
//  3D MODEL (Three.js)
// =========================================================================
const matLoad = new THREE.MeshStandardMaterial({ color: 0x3b5bdb, roughness: 0.55, metalness: 0.1 });
const matPart = new THREE.MeshStandardMaterial({ color: 0x868e96, roughness: 0.70, metalness: 0.05 });
const matFloor= new THREE.MeshStandardMaterial({ color: 0xe0e0e0, roughness: 0.90, metalness: 0.0 });

function createWallMesh(p1, p2, thickness, height, material) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const geom = new THREE.BoxGeometry(len + thickness, height, thickness);
    const mesh = new THREE.Mesh(geom, material);
    mesh.position.set((p1.x + p2.x) / 2, height / 2, (p1.y + p2.y) / 2);
    mesh.rotation.y = -Math.atan2(dy, dx);
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
}

function build3DModel(parseData) {
    wallMeshes.forEach(m => { scene.remove(m); m.geometry.dispose(); });
    wallMeshes = [];

    const walls = parseData.walls || [];
    if (!walls.length) return;

    const pxpm = parseData.px_per_meter || estimateScale(walls);
    const H = 3.0;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    walls.forEach(w => {
        minX = Math.min(minX, w.start[0], w.end[0]);
        maxX = Math.max(maxX, w.start[0], w.end[0]);
        minY = Math.min(minY, w.start[1], w.end[1]);
        maxY = Math.max(maxY, w.start[1], w.end[1]);
    });
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;

    walls.forEach(w => {
        const p1 = { x: (w.start[0] - cx) / pxpm, y: (w.start[1] - cy) / pxpm };
        const p2 = { x: (w.end[0]   - cx) / pxpm, y: (w.end[1]   - cy) / pxpm };
        const t  = (w.thickness_px || 8) / pxpm;
        const m  = w.type === 'load_bearing' ? matLoad : matPart;
        const mesh = createWallMesh(p1, p2, t, H, m);
        mesh.userData = { wallId: w.id, wallType: w.type };
        scene.add(mesh);
        wallMeshes.push(mesh);
    });

    // Floor slab
    const fw = (maxX - minX) / pxpm + 1, fd = (maxY - minY) / pxpm + 1;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(fw, 0.1, fd), matFloor);
    floor.position.set(0, -0.05, 0);
    floor.receiveShadow = true;
    scene.add(floor);
    wallMeshes.push(floor);

    // Reposition camera
    const maxDim = Math.max(fw, fd);
    camera.position.set(maxDim * 0.9, maxDim * 0.9, maxDim * 0.9);
    controls.target.set(0, H / 3, 0);
    controls.update();

    legend3d.classList.remove('hidden');
    emptyState3d.classList.add('hidden');
    btnExport.disabled = false;
}

function estimateScale(walls) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    walls.forEach(w => {
        minX = Math.min(minX, w.start[0], w.end[0]);
        maxX = Math.max(maxX, w.start[0], w.end[0]);
        minY = Math.min(minY, w.start[1], w.end[1]);
        maxY = Math.max(maxY, w.start[1], w.end[1]);
    });
    return Math.max(maxX - minX, maxY - minY) / 12.0;
}

// =========================================================================
//  API CALLS
// =========================================================================
async function apiParse(file) {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch(API_BASE + '/api/parse', { method: 'POST', body: fd });
    if (!r.ok) throw new Error(`/api/parse → ${r.status} ${r.statusText}`);
    return r.json();
}

async function apiMaterials(walls) {
    const r = await fetch(API_BASE + '/api/materials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walls }),
    });
    if (!r.ok) throw new Error(`/api/materials → ${r.status}`);
    return r.json();
}

async function apiExplain(elements) {
    const r = await fetch(API_BASE + '/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ elements }),
    });
    if (!r.ok) throw new Error(`/api/explain → ${r.status}`);
    return r.json();
}

// =========================================================================
//  MAIN PIPELINE — runs when user clicks Analyze
// =========================================================================
btnAnalyze.addEventListener('click', runAnalysis);

async function runAnalysis() {
    if (!state.currentFile && !state.useFallback) {
        setStatus('No plan loaded — upload or select A/B/C first', 'error');
        return;
    }

    btnAnalyze.disabled = true;

    try {
        setStatus('Analyzing…', 'analyzing');

        let parse;

        if (state.useFallback) {
            // Use manual data instead of calling backend
            showLoading('Stage 1 / 4 — Manual entry', 'Using manual coordinates instead of OpenCV', 10);
            parse = getFallbackDataAsJson();
            await sleep(500); // UI visual beat
        } else {
            // ── Stage 1: Parse ──────────────────────────────────────────────
            showLoading('Stage 1 / 4 — Parsing floor plan', 'OpenCV: edge detection + wall extraction', 10);
            try {
                parse = await apiParse(state.currentFile);
            } catch (err) {
                hideLoading();
                setStatus('Parse failed — is the backend running at ' + API_BASE + '?', 'error');
                btnAnalyze.disabled = false;
                return;
            }
        }
        
        state.parseResult = parse;

        // Enable layer toggles and update stats
        layerButtons.forEach(b => { b.disabled = false; });
        updateStats(parse);

        // ── Stage 2/3: 2D overlay + 3D model ───────────────────────────
        showLoading('Stage 2 / 4 — Rendering analysis & 3D model', 'Drawing parsed geometry…', 38);
        await sleep(120);

        currentLayer = 'walls';
        layerButtons.forEach(b => b.classList.toggle('active', b.dataset.layer === 'walls'));
        render2DAnalysis(parse);
        build3DModel(parse);

        // ── Stage 4: Materials (TOPSIS) ─────────────────────────────────
        showLoading('Stage 3 / 4 — Running TOPSIS material analysis', 'Calculating rankings per element…', 62);
        let mats = null;
        try { mats = await apiMaterials(parse.walls); }
        catch (e) { console.warn('Materials API skipped:', e.message); }
        state.materialsResult = mats;

        // ── Stage 5: LLM Explanations ────────────────────────────────────
        showLoading('Stage 4 / 4 — Generating AI explanations', 'LLM explaining each material choice…', 82);
        let expl = null;
        if (mats) {
            try {
                const combined = (parse.walls || []).map(w => ({
                    ...w,
                    topsis: (mats.recommendations || []).find(r => r.wall_id === w.id) || null,
                }));
                expl = await apiExplain(combined);
            } catch (e) { console.warn('Explain API skipped:', e.message); }
        }
        state.explanations = expl;

        // ── Render material cards ────────────────────────────────────────
        showLoading('Rendering results…', '', 96);
        await sleep(100);
        renderMaterialCards(parse, mats, expl);

        hideLoading();
        setStatus('Analysis complete ✓', 'done');

    } catch (err) {
        console.error(err);
        hideLoading();
        setStatus('Error: ' + err.message, 'error');
    } finally {
        btnAnalyze.disabled = false;
    }
}

// ========================================================================
//  STATS BAR
// ========================================================================
function updateStats(parseData) {
    const nW = (parseData.walls    || []).length;
    const nR = (parseData.rooms    || []).length;
    const nO = (parseData.openings || []).length;
    const pxpm = parseData.px_per_meter;

    statWalls.textContent    = nW + ' Wall'    + (nW !== 1 ? 's' : '');
    statRooms.textContent    = nR + ' Room'    + (nR !== 1 ? 's' : '');
    statOpenings.textContent = nO + ' Opening' + (nO !== 1 ? 's' : '');
    statScale.textContent    = pxpm ? `Scale: ${pxpm.toFixed(1)} px/m` : 'Scale: estimated';

    statsBar2d.classList.remove('hidden');
}

// ========================================================================
//  MATERIAL ACCORDION CARDS
// ========================================================================
function renderMaterialCards(parseData, mats, expl) {
    materialCards.innerHTML = '';
    emptyStateMat.classList.add('hidden');
    materialCards.classList.remove('hidden');

    const walls  = parseData.walls || [];
    const recs   = (mats  && mats.recommendations)  || [];
    const expls  = (expl  && expl.explanations)      || [];
    const concerns = [];

    walls.forEach((wall, idx) => {
        const rec = recs.find(r => r.wall_id === wall.id) || null;
        const ex  = expls.find(e => e.wall_id === wall.id) || null;

        const pxpm    = parseData.px_per_meter || 50;
        const lenM    = wall.length_m    || (wall.length_px    ? wall.length_px    / pxpm : null);
        const thickM  = wall.thickness_m || (wall.thickness_px ? wall.thickness_px / pxpm : null);

        // Structural concerns (computed in code, not delegated to LLM)
        if (wall.type === 'load_bearing' && lenM   && lenM   > 5.0)
            concerns.push(`Wall ${wall.id}: span ${lenM.toFixed(1)} m exceeds 5 m — consider adding a column at midpoint.`);
        if (wall.type === 'load_bearing' && thickM && thickM < 0.15)
            concerns.push(`Wall ${wall.id}: thickness ${(thickM*1000).toFixed(0)} mm is below the 150 mm structural minimum.`);

        const typeBadge = wall.type === 'load_bearing'
            ? '<span class="wall-type-badge badge-load-bearing">Load-bearing</span>'
            : '<span class="wall-type-badge badge-partition">Partition</span>';

        const dimText = lenM ? lenM.toFixed(1) + ' m' : (wall.id || '—');

        let rankingHtml = '';
        if (rec && rec.rankings && rec.rankings.length) {
            rec.rankings.forEach(mat => {
                const pct = Math.round(mat.score * 100);
                rankingHtml += `
                <div class="material-row">
                    <span class="material-rank">#${mat.rank}</span>
                    <span class="material-name">${mat.name}</span>
                    <div class="material-score-bar">
                        <div class="material-score-fill" style="width:${pct}%"></div>
                    </div>
                    <span class="material-score-val">${mat.score.toFixed(2)}</span>
                </div>`;
            });
        } else {
            rankingHtml = '<p style="color:var(--text-400);font-size:0.79rem;padding:6px 0;">TOPSIS data not available for this element.</p>';
        }

        const explHtml = (ex && ex.text) ? `
            <div class="explanation-block">
                <div class="explanation-label">
                    <i data-lucide="message-square"></i> AI Structural Explanation
                </div>
                <div class="explanation-text">${ex.text}</div>
            </div>` : '';

        const card = document.createElement('div');
        card.className = 'material-card animate-in';
        card.style.animationDelay = (idx * 0.05) + 's';
        card.innerHTML = `
            <div class="material-card-header" onclick="this.parentElement.classList.toggle('expanded')">
                <div class="wall-label">
                    ${typeBadge}
                    <span class="wall-name">${wall.id || 'W' + (idx+1)}</span>
                    <span class="wall-dim">${dimText}</span>
                </div>
                <div class="expand-icon"><i data-lucide="chevron-down"></i></div>
            </div>
            <div class="material-card-body">
                <div class="material-rankings">${rankingHtml}</div>
                ${explHtml}
            </div>`;

        materialCards.appendChild(card);
    });

    lucide.createIcons();

    // Show concerns
    if (concerns.length) {
        concernsSect.classList.remove('hidden');
        concernsList.innerHTML = concerns.map(c =>
            `<div class="concern-item"><div class="concern-bullet"></div>${c}</div>`
        ).join('');
    } else {
        concernsSect.classList.add('hidden');
    }
}

// ========================================================================
//  UI CONTROLS
// ========================================================================
btnResetCamera.addEventListener('click', () => {
    camera.position.set(8, 8, 8);
    controls.target.set(0, 1, 0);
    controls.update();
});

btnToggleRotate.addEventListener('click', () => {
    controls.autoRotate = !controls.autoRotate;
    btnToggleRotate.classList.toggle('active', controls.autoRotate);
});

// Collapse/expand bottom panel
btnExpandBottom.addEventListener('click', toggleBottom);
bottomToggleHeader.addEventListener('click', e => {
    if (e.target === btnExpandBottom || btnExpandBottom.contains(e.target)) return;
    toggleBottom();
});

function toggleBottom() {
    const shell = document.querySelector('.app-shell');
    const collapsed = shell.classList.toggle('bottom-collapsed');
    const icon = btnExpandBottom.querySelector('svg, i');
    if (icon) icon.style.transform = collapsed ? 'rotate(180deg)' : '';
}

// GLB Export
btnExport.addEventListener('click', async () => {
    try {
        const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
        const exporter = new GLTFExporter();
        exporter.parse(scene,
            result => {
                const blob = new Blob([result], { type: 'application/octet-stream' });
                const a = Object.assign(document.createElement('a'), {
                    href: URL.createObjectURL(blob),
                    download: 'archintel-model.glb',
                });
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            },
            err => { console.error(err); setStatus('GLB export failed', 'error'); },
            { binary: true }
        );
    } catch (e) {
        console.error(e);
        setStatus('Exporter not available', 'error');
    }
});

// ========================================================================
console.log('%c ArchIntel Frontend Ready ', 'background:#3b5bdb;color:#fff;padding:4px 10px;border-radius:4px;font-weight:bold;font-size:13px');
console.log('Backend expected at:', API_BASE);
console.log('Upload a plan or click A / B / C, then click Analyze.');

// ========================================================================
//  FALLBACK MANUAL ENTRY LOGIC
// ========================================================================
let wallIdCounter = 1;

function updateFallbackScale() {
    const bw = parseFloat(fbBuildingWidth.value) || 12;
    const iw = parseFloat(fbImgWidth.value) || 800;
    const pxpm = iw / bw;
    fbScaleVal.textContent = pxpm.toFixed(1);
}
fbBuildingWidth.addEventListener('input', updateFallbackScale);
fbImgWidth.addEventListener('input', updateFallbackScale);

function updateWallCount() {
    const count = wallsTbody.children.length;
    fbWallCount.textContent = count + ' wall' + (count !== 1 ? 's' : '') + ' defined';
    fbApply.disabled = count === 0;
}

// Open/Close panel
btnFallback.addEventListener('click', () => {
    fbOverlay.classList.remove('hidden');
    fbPanel.classList.remove('hidden');
    updateFallbackScale();
    updateWallCount();
    // Pre-fill a sample wall if empty
    if (wallsTbody.children.length === 0) addFallbackWall();
});

function closeFallback() {
    fbOverlay.classList.add('hidden');
    fbPanel.classList.add('hidden');
}
fbClose.addEventListener('click', closeFallback);
fbOverlay.addEventListener('click', closeFallback);

// Add Wall
function addFallbackWall() {
    const id = 'W' + (wallIdCounter++);
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td class="cell-id">${id}</td>
        <td><input type="number" class="w-sx" value="0"></td>
        <td><input type="number" class="w-sy" value="0"></td>
        <td><input type="number" class="w-ex" value="100"></td>
        <td><input type="number" class="w-ey" value="0"></td>
        <td><input type="number" class="w-thick" value="10"></td>
        <td>
            <select class="w-type">
                <option value="load_bearing">Load-bearing</option>
                <option value="partition">Partition</option>
            </select>
        </td>
        <td class="cell-del">
            <button class="btn-del-row" title="Delete Wall"><i data-lucide="trash-2"></i></button>
        </td>
    `;
    tr.querySelector('.btn-del-row').addEventListener('click', () => {
        tr.remove();
        updateWallCount();
    });
    wallsTbody.appendChild(tr);
    lucide.createIcons();
    updateWallCount();
}
fbAddWall.addEventListener('click', addFallbackWall);

// Add Room
function addFallbackRoom() {
    const div = document.createElement('div');
    div.className = 'fb-room-card';
    div.innerHTML = `
        <div class="fb-room-card-header">
            <span class="fb-room-id">R*</span>
            <input type="text" class="r-label" placeholder="Room label (e.g. Bedroom)">
            <button class="btn-del-row r-del" title="Delete Room"><i data-lucide="trash-2"></i></button>
        </div>
        <div class="fb-room-corners">
            <div class="fb-corner"><span class="fb-corner-label">Corner 1</span><div class="fb-corner-inputs"><input type="number" class="rx1" placeholder="X"><input type="number" class="ry1" placeholder="Y"></div></div>
            <div class="fb-corner"><span class="fb-corner-label">Corner 2</span><div class="fb-corner-inputs"><input type="number" class="rx2" placeholder="X"><input type="number" class="ry2" placeholder="Y"></div></div>
            <div class="fb-corner"><span class="fb-corner-label">Corner 3</span><div class="fb-corner-inputs"><input type="number" class="rx3" placeholder="X"><input type="number" class="ry3" placeholder="Y"></div></div>
            <div class="fb-corner"><span class="fb-corner-label">Corner 4</span><div class="fb-corner-inputs"><input type="number" class="rx4" placeholder="X"><input type="number" class="ry4" placeholder="Y"></div></div>
        </div>
    `;
    div.querySelector('.r-del').addEventListener('click', () => div.remove());
    roomsList.appendChild(div);
    lucide.createIcons();
}
fbAddRoom.addEventListener('click', addFallbackRoom);

// Add Opening
function addFallbackOpening() {
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td class="cell-id">D*</td>
        <td>
            <select class="o-type">
                <option value="door">Door</option>
                <option value="window">Window</option>
            </select>
        </td>
        <td><input type="text" class="o-wall" placeholder="W1" style="width:60px;"></td>
        <td><input type="number" class="o-px" value="0"></td>
        <td><input type="number" class="o-py" value="0"></td>
        <td class="cell-del">
            <button class="btn-del-row" title="Delete Opening"><i data-lucide="trash-2"></i></button>
        </td>
    `;
    tr.querySelector('.btn-del-row').addEventListener('click', () => tr.remove());
    openingsTbody.appendChild(tr);
    lucide.createIcons();
}
fbAddOpening.addEventListener('click', addFallbackOpening);

// Reset
fbReset.addEventListener('click', () => {
    wallsTbody.innerHTML = '';
    roomsList.innerHTML = '';
    openingsTbody.innerHTML = '';
    wallIdCounter = 1;
    updateWallCount();
});

// Generate JSON & Apply Flow
function getFallbackDataAsJson() {
    const bw = parseFloat(fbBuildingWidth.value) || 12;
    const iw = parseFloat(fbImgWidth.value) || 800;
    const pxpm = iw / bw;

    const data = {
        px_per_meter: pxpm,
        walls: [],
        rooms: [],
        openings: []
    };

    // Gather walls
    Array.from(wallsTbody.children).forEach(tr => {
        const id = tr.querySelector('.cell-id').textContent;
        const sx = parseFloat(tr.querySelector('.w-sx').value) || 0;
        const sy = parseFloat(tr.querySelector('.w-sy').value) || 0;
        const ex = parseFloat(tr.querySelector('.w-ex').value) || 0;
        const ey = parseFloat(tr.querySelector('.w-ey').value) || 0;
        const thick = parseFloat(tr.querySelector('.w-thick').value) || 10;
        const type = tr.querySelector('.w-type').value;

        // Calc length in px and m
        const dx = ex - sx, dy = ey - sy;
        const lenPx = Math.sqrt(dx*dx + dy*dy);
        const lenM = lenPx / pxpm;
        const thickM = thick / pxpm;

        data.walls.push({
            id: id,
            start: [sx, sy],
            end: [ex, ey],
            length_px: lenPx,
            length_m: lenM,
            thickness_px: thick,
            thickness_m: thickM,
            type: type
        });
    });

    // Gather rooms
    Array.from(roomsList.children).forEach(div => {
        const label = div.querySelector('.r-label').value;
        const poly = [];
        for (let i = 1; i <= 4; i++) {
            const x = parseFloat(div.querySelector('.rx' + i).value);
            const y = parseFloat(div.querySelector('.ry' + i).value);
            if (!isNaN(x) && !isNaN(y)) poly.push([x, y]);
        }
        if (poly.length >= 3) {
            data.rooms.push({ label: label || 'Room', polygon: poly });
        }
    });

    // Gather openings
    Array.from(openingsTbody.children).forEach(tr => {
        const type = tr.querySelector('.o-type').value;
        const wallId = tr.querySelector('.o-wall').value;
        const px = parseFloat(tr.querySelector('.o-px').value) || 0;
        const py = parseFloat(tr.querySelector('.o-py').value) || 0;
        
        data.openings.push({
            type: type,
            wall_id: wallId,
            position: [px, py]
        });
    });

    return data;
}

// Apply button logic
fbApply.addEventListener('click', () => {
    state.useFallback = true;
    btnFallback.classList.add('btn-fallback-active');
    btnAnalyze.disabled = false;
    closeFallback();
    
    // Auto-run analysis with manual data
    runAnalysis();
});

