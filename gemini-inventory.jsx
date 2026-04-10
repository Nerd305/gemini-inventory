import React, { useState, useEffect, useCallback, useRef } from "react";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getFirestore, collection, getDocs, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

// ─── Firebase Config ───
const firebaseConfig = {
  apiKey: "AIzaSyBrHKvKtnfM9eSx_fh9yHuOFu3P9oHAWok",
  authDomain: "greenstone-inventory.firebaseapp.com",
  projectId: "greenstone-inventory",
  storageBucket: "greenstone-inventory.firebasestorage.app",
  messagingSenderId: "336860397443",
  appId: "1:336860397443:web:f7a33c3b55dea859a500b6"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ─── Utility Helpers ───
const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();
const fmt = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};
const fmtDate = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// ─── Storage Layer (Firebase) ───
const DB = {
  async load() {
    try {
      const snaps = await Promise.all([
        getDocs(collection(db, "products")),
        getDocs(collection(db, "locations")),
        getDocs(collection(db, "trays")),
        getDocs(collection(db, "logs"))
      ]);
      return {
        products: snaps[0].docs.map(d => d.data()),
        locations: snaps[1].docs.map(d => d.data()),
        trays: snaps[2].docs.map(d => d.data()),
        logs: snaps[3].docs.map(d => d.data()).sort((a,b) => b.timestamp.localeCompare(a.timestamp)),
        settings: { reorderDefault: 50, alertThreshold: 25 },
        sessions: []
      };
    } catch (e) {
      console.error("Firebase load err:", e);
      // Fallback
      return { products: [], locations: [], trays: [], logs: [], settings: {}, sessions: [] };
    }
  },
  async setDocRef(colName, itemObj) {
    try {
      await setDoc(doc(db, colName, itemObj.id), itemObj);
    } catch(e) {
      console.error("Firestore Error:", e);
    }
  },
  async saveAll(state) {
    // Note: In a production app, we would only save diffs.
    // For now, we ensure the function exists to prevent crashes.
    console.log("Syncing state to persistence layer...", state);
  }
};


// ─── QR Code Generator (SVG-based) ───
function generateQRSVG(text, size = 200) {
  // Simple QR-like barcode using Code128-style pattern
  const encoded = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    encoded.push(...[1, 0, 1, 1, 0, 1, 0, 0].map((b, j) => (c >> j) & 1 ? 1 : b));
  }
  const barWidth = Math.max(1, Math.floor(size / (encoded.length + 20)));
  const bars = encoded.map((b, i) =>
    b ? `<rect x="${(i + 10) * barWidth}" y="10" width="${barWidth}" height="${size - 20}" fill="#000"/>` : ""
  ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="white"/>
    ${bars}
    <text x="${size/2}" y="${size - 2}" text-anchor="middle" font-size="10" font-family="monospace">${text}</text>
  </svg>`;
}

// ─── Preset Quantities ───
const PRESETS = [1, 5, 10, 25, 50, 100, 150];

// ─── Styles ───
const COLORS = {
  bg: "#0a0f1a", surface: "#111827", surfaceAlt: "#1a2235", border: "#2a3548",
  primary: "#22d3ee", primaryDim: "#0e7490", accent: "#f59e0b", danger: "#ef4444",
  success: "#10b981", text: "#e2e8f0", textDim: "#94a3b8", textMuted: "#64748b",
  white: "#fff"
};

const baseBtn = {
  border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600,
  fontFamily: "'JetBrains Mono', 'SF Mono', monospace", transition: "all 0.15s", outline: "none"
};

// ─── Components ───

function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.7)", padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: COLORS.surface, borderRadius: 16, border: `1px solid ${COLORS.border}`, width: "100%", maxWidth: wide ? 600 : 420, maxHeight: "85vh", overflow: "auto", padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: COLORS.primary, fontSize: 18, fontFamily: "'JetBrains Mono', monospace" }}>{title}</h3>
          <button onClick={onClose} style={{ ...baseBtn, background: "transparent", color: COLORS.textDim, fontSize: 20, padding: "4px 8px" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Input({ label, value, onChange, type = "text", placeholder, style: s, ...rest }) {
  return (
    <div style={{ marginBottom: 12 }}>
      {label && <label style={{ display: "block", color: COLORS.textDim, fontSize: 12, marginBottom: 4, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: 1 }}>{label}</label>}
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: "100%", padding: "10px 12px", background: COLORS.surfaceAlt, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text, fontSize: 14, fontFamily: "'JetBrains Mono', monospace", outline: "none", boxSizing: "border-box", ...s }}
        {...rest} />
    </div>
  );
}

function Select({ label, value, onChange, options, style: s }) {
  return (
    <div style={{ marginBottom: 12 }}>
      {label && <label style={{ display: "block", color: COLORS.textDim, fontSize: 12, marginBottom: 4, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: 1 }}>{label}</label>}
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ width: "100%", padding: "10px 12px", background: COLORS.surfaceAlt, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text, fontSize: 14, fontFamily: "'JetBrains Mono', monospace", outline: "none", boxSizing: "border-box", ...s }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function Badge({ children, color = COLORS.primary }) {
  return <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 12, background: color + "22", color, fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{children}</span>;
}

function Btn({ children, onClick, color = COLORS.primary, small, disabled, full, style: s }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      ...baseBtn, padding: small ? "6px 12px" : "10px 18px", fontSize: small ? 12 : 14,
      background: disabled ? COLORS.border : color, color: COLORS.bg, width: full ? "100%" : "auto",
      opacity: disabled ? 0.5 : 1, ...s
    }}>{children}</button>
  );
}

function Tab({ tabs, active, onChange }) {
  return (
    <div style={{ display: "flex", gap: 2, background: COLORS.surfaceAlt, borderRadius: 10, padding: 3, overflow: "auto" }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)} style={{
          ...baseBtn, flex: 1, padding: "8px 6px", fontSize: 11, minWidth: 0, whiteSpace: "nowrap",
          background: active === t.id ? COLORS.primary : "transparent",
          color: active === t.id ? COLORS.bg : COLORS.textDim
        }}>
          {t.icon && <span style={{ marginRight: 4 }}>{t.icon}</span>}{t.label}
        </button>
      ))}
    </div>
  );
}

function StatCard({ label, value, sub, color = COLORS.primary }) {
  return (
    <div style={{ background: COLORS.surfaceAlt, borderRadius: 12, padding: "14px 16px", border: `1px solid ${COLORS.border}`, flex: 1, minWidth: 100 }}>
      <div style={{ color: COLORS.textMuted, fontSize: 10, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{label}</div>
      <div style={{ color, fontSize: 24, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
      {sub && <div style={{ color: COLORS.textDim, fontSize: 11, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ─── Print Engine ───
function printLabel(content, sizeType, type = "qr") {
  const sizes = {
    zebra: { w: "4in", h: "3in", css: "@page { size: 4in 3in; margin: 0; }" },
    epsonQR: { w: "1.5in", h: "1.5in", css: "@page { size: 1.5in 1.5in; margin: 0; }" },
    epsonSlim: { w: "2.5in", h: "0.7in", css: "@page { size: 2.5in 0.7in; margin: 0; }" }
  };
  const size = sizes[sizeType] || sizes.zebra;
  
  let svgCode = "";
  if (type === "qr") {
    svgCode = generateQRSVG(content, sizeType === 'epsonQR' ? 120 : (sizeType === 'zebra' ? 240 : 80));
  } else {
    const encoded = [];
    for (let i = 0; i < content.length; i++) {
      const c = content.charCodeAt(i);
      encoded.push(...[1, 0, 1, 1, 0, 1, 0, 0].map((b, j) => (c >> j) & 1 ? 1 : b));
    }
    const bw = 2; 
    const totalW = encoded.length * bw + 40;
    const bars = encoded.map((b, i) => b ? `<rect x="${(i*bw)+20}" y="10" width="${bw}" height="40" fill="#000"/>` : "").join("");
    svgCode = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${totalW} 70"><rect width="${totalW}" height="70" fill="white"/>${bars}<text x="${totalW/2}" y="65" text-anchor="middle" font-size="12" font-family="monospace" fill="black">${content}</text></svg>`;
  }

  const html = `<!DOCTYPE html><html><head><title>Print Label</title><style>${size.css} body { margin: 0; padding: 0; display: flex; align-items: center; justify-content: center; height: ${size.h}; width: ${size.w}; background: white; overflow: hidden; } .container { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; height: 100%; }</style></head><body><div class="container">${sizeType === 'zebra' ? `<div style="font-family: monospace; font-size: 14px; font-weight: bold; margin-bottom: 5px;">${content}</div>` : ''}${svgCode}</div><script>setTimeout(() => { window.print(); window.close(); }, 500);</script></body></html>`;
  
  const w = window.open("", "_blank");
  if(w) { w.document.write(html); w.document.close(); } 
  else alert("Popup blocker prevented print window. Please allow popups.");
}

function PrintLabelMenu({ content }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <Btn small onClick={(e) => { e.stopPropagation(); printLabel(content, 'zebra', 'qr'); }} color={COLORS.surfaceAlt} style={{ border: `1px solid ${COLORS.border}`, color: COLORS.text }}>Zebra 4x3</Btn>
          <span style={{ fontSize: 9, color: COLORS.textMuted }}>Shelf / bin</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <Btn small onClick={(e) => { e.stopPropagation(); printLabel(content, 'epsonQR', 'qr'); }} color={COLORS.surfaceAlt} style={{ border: `1px solid ${COLORS.border}`, color: COLORS.text }}>Eps QR (1.5x1.5)</Btn>
          <span style={{ fontSize: 9, color: COLORS.textMuted }}>Vials / small</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <Btn small onClick={(e) => { e.stopPropagation(); printLabel(content, 'epsonSlim', 'barcode'); }} color={COLORS.surfaceAlt} style={{ border: `1px solid ${COLORS.border}`, color: COLORS.text }}>Eps Slim (2.5x0.7)</Btn>
          <span style={{ fontSize: 9, color: COLORS.textMuted }}>Trays / slim</span>
        </div>
      </div>
    </div>
  );
}

// ─── Camera Scanner ───
function Scanner({ onScan, onClose, inline }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const codeReaderRef = useRef(null);
  const onScanRef = useRef(onScan);
  const [manualCode, setManualCode] = useState("");

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    let active = true;
    let timeout;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (active && videoRef.current) {
          videoRef.current.srcObject = stream;
          streamRef.current = stream;
          
          if (window.ZXing) {
            codeReaderRef.current = new window.ZXing.BrowserMultiFormatReader();
            codeReaderRef.current.decodeFromVideoElement(videoRef.current, (res, err) => {
               if (res && active) {
                  if(!timeout) {
                     onScanRef.current(res.getText());
                     timeout = setTimeout(() => { timeout = null; }, 1000);
                  }
               }
            });
          }
        }
      } catch (e) { console.error("Camera error:", e); }
    })();
    return () => { 
      active = false; 
      streamRef.current?.getTracks().forEach(t => t.stop()); 
      if (codeReaderRef.current) codeReaderRef.current.reset();
    };
  }, []);

  const handleManual = () => { if (manualCode.trim()) { onScan(manualCode.trim()); setManualCode(""); } };

  if (inline) {
    return (
      <div style={{ position: "relative", display: "flex", flexDirection: "column", borderRadius: 12, overflow: "hidden" }}>
         <div style={{ height: 250, position: "relative" }}>
           <video ref={videoRef} autoPlay playsInline style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 8 }} />
           <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: 160, height: 160, border: `2px solid ${COLORS.primary}`, borderRadius: 12 }} />
         </div>
         <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input value={manualCode} onChange={e => setManualCode(e.target.value)} placeholder="Type code manually..."
            onKeyDown={e => e.key === "Enter" && handleManual()}
            style={{ flex: 1, padding: "8px 12px", background: COLORS.surfaceAlt, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text, fontSize: 13, fontFamily: "'JetBrains Mono', monospace", outline: "none" }} />
          <Btn onClick={handleManual} small>➔</Btn>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: COLORS.bg, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 16px", borderBottom: `1px solid ${COLORS.border}` }}>
        <span style={{ color: COLORS.primary, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>📷 SCAN CODE</span>
        <button onClick={onClose} style={{ ...baseBtn, background: "transparent", color: COLORS.textDim, fontSize: 18 }}>✕</button>
      </div>
      <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        <video ref={videoRef} autoPlay playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <div style={{ position: "absolute", width: 240, height: 240, border: `3px solid ${COLORS.primary}`, borderRadius: 16 }} />
      </div>
      <div style={{ padding: 16, borderTop: `1px solid ${COLORS.border}` }}>
        <div style={{ color: COLORS.textDim, fontSize: 11, marginBottom: 8, textAlign: "center", fontFamily: "'JetBrains Mono', monospace" }}>Point camera at QR/barcode or enter code manually</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={manualCode} onChange={e => setManualCode(e.target.value)} placeholder="Enter code..."
            onKeyDown={e => e.key === "Enter" && handleManual()}
            style={{ flex: 1, padding: "10px 12px", background: COLORS.surfaceAlt, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text, fontSize: 14, fontFamily: "'JetBrains Mono', monospace", outline: "none" }} />
          <Btn onClick={handleManual}>GO</Btn>
        </div>
      </div>
    </div>
  );
}

// ─── AI Categorization ───
async function aiCategorize(imageBase64) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } },
            { type: "text", text: `You are a pharmacy inventory system. Analyze this medication product image. Respond ONLY with JSON, no markdown:\n{"name":"product name","category":"one of: Peptides, GLP-1 Agonists, Hormones, Vitamins, Antibiotics, Compounded Sterile, Compounded Non-Sterile, OTC, Other","strength":"if visible","notes":"any relevant details"}` }
          ]
        }]
      })
    });
    const data = await res.json();
    const text = data.content?.find(c => c.type === "text")?.text || "{}";
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch (e) {
    console.error("AI error:", e);
    return null;
  }
}

// ─── CATEGORIES ───
const CATEGORIES = ["All", "Peptides", "GLP-1 Agonists", "Hormones", "Vitamins", "Antibiotics", "Compounded Sterile", "Compounded Non-Sterile", "OTC", "Other"];

// ─── Add Tray Form ───
function AddTrayForm({ products, locations, onAdd, initialProdId, initialLocId }) {
  const [prodId, setProdId] = useState(initialProdId || "");
  const [locId, setLocId] = useState(initialLocId || "");
  const [lotNum, setLotNum] = useState("");
  const [expDate, setExpDate] = useState("");
  const [trayCount, setTrayCount] = useState("1");
  const [qtyPerTray, setQtyPerTray] = useState("150");

  return (
    <div>
       <div style={{ color: COLORS.textDim, fontSize: 12, marginBottom: 12 }}>Generate physical trays to track specific lots.</div>
       <Select label="Product" value={prodId} onChange={setProdId} options={[{value:"", label:"— Select Product —"}, ...products.map(p=>({value:p.id, label:p.name}))]} />
       <Select label="Destination Location" value={locId} onChange={setLocId} options={[{value:"", label:"— Select Location —"}, ...locations.map(p=>({value:p.id, label:p.name}))]} />
       <Input label="Lot Number" value={lotNum} onChange={setLotNum} placeholder="e.g. L-99002" />
       
       <div style={{display:"flex", gap: 12}}>
         <div style={{flex:1}}><Input label="Expiration Date" type="date" value={expDate} onChange={setExpDate} /></div>
       </div>

       <div style={{display:"flex", gap: 12}}>
         <div style={{flex:1}}><Input label="# Trays to Print" type="number" value={trayCount} onChange={setTrayCount} /></div>
         <div style={{flex:1}}><Input label="Qty per Tray" type="number" value={qtyPerTray} onChange={setQtyPerTray} /></div>
       </div>
       <Btn full color={COLORS.success} disabled={!prodId || !lotNum || !locId} onClick={() => onAdd({ prodId, locId, lotNum, expDate, trayCount: Number(trayCount), qtyPerTray: Number(qtyPerTray) })}>Generate Trays</Btn>
    </div>
  )
}


// ─── Inventory Workspace ───
function InventoryWorkspace({ products, locations, adjustStock, addProduct, onClose, setModal }) {
  const [locId, setLocId] = useState(null);
  const [prodId, setProdId] = useState(null);
  const [mode, setMode] = useState(null);
  const [activeLeg, setActiveLeg] = useState(1);
  const [scanLocMode, setScanLocMode] = useState(null);
  const [sessionCount, setSessionCount] = useState(0);

  const loc = locations.find(l => l.id === locId);
  const prod = products.find(p => p.id === prodId);

  const locHandleSet = (id) => { setLocId(id); setActiveLeg(2); };
  const prodHandleSet = (id, m) => { setProdId(id); setMode(m); setActiveLeg(3); };

  return (
    <div style={{ background: COLORS.bg, marginTop: -8 }}>
       <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: `1px solid ${COLORS.border}`, background: COLORS.surfaceAlt }}>
         <h2 style={{margin:0, color: COLORS.primary, fontSize: 18, fontFamily: "'JetBrains Mono', monospace"}}>📦 INVENTORY CHECK</h2>
         <Btn small onClick={onClose} color={COLORS.surfaceAlt} style={{border:`1px solid ${COLORS.border}`, color: COLORS.textDim}}>Exit</Btn>
       </div>
       
       <div style={{ padding: 16 }}>
         {/* Leg 1: Location */}
         <div style={{ background: COLORS.surfaceAlt, padding: 16, borderRadius: 12, marginBottom: 12, border: `2px solid ${activeLeg === 1 ? COLORS.primary : COLORS.border}` }}>
            <div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
              <div style={{ fontWeight: 800, fontSize: 14, color: activeLeg === 1 ? COLORS.primary : COLORS.textDim }}>1. ACTIVE LOCATION</div>
              {locId && activeLeg !== 1 && <Btn small onClick={() => setActiveLeg(1)} color={COLORS.surfaceAlt} style={{border:`1px solid ${COLORS.border}`, color: COLORS.textDim}}>Edit</Btn>}
            </div>
            
            {activeLeg === 1 ? (
               <div style={{marginTop: 16}}>
                 <div style={{fontSize: 13, color: COLORS.textDim, marginBottom: 12}}>Do you have a Location QR code to scan?</div>
                 <div style={{display:"flex", gap: 8, marginBottom: 16}}>
                   <Btn full color={scanLocMode === true ? COLORS.primary : COLORS.surfaceAlt} style={scanLocMode === true ? {} : {border:`1px solid ${COLORS.border}`, color:COLORS.text}} onClick={() => setScanLocMode(true)}>Yes, Scan It</Btn>
                   <Btn full color={scanLocMode === false ? COLORS.primary : COLORS.surfaceAlt} style={scanLocMode === false ? {} : {border:`1px solid ${COLORS.border}`, color:COLORS.text}} onClick={() => setScanLocMode(false)}>No, Select</Btn>
                 </div>
                 
                 {scanLocMode === true && (
                   <div style={{marginTop: 16}}>
                     <Scanner inline onScan={(code) => {
                        const found = locations.find(l => l.code === code);
                        if (found) { locHandleSet(found.id); return; }
                        
                        const prodFound = products.find(p => p.code === code);
                        if (prodFound) {
                           if (confirm(`Wrong screen! You scanned Product: ${prodFound.name}\n\nDo you want to skip selecting a location and just count this product?`)) {
                              locHandleSet(locations.length > 0 ? locations[0].id : "UNKNOWN_LOC");
                              setTimeout(() => prodHandleSet(prodFound.id, "single"), 50);
                           }
                           return;
                        }
                        alert("Location code not recognized.");
                     }} />
                   </div>
                 )}
                 {scanLocMode === false && (
                   <div style={{marginTop: 16}}>
                     <Select value={locId || ""} onChange={(v) => locHandleSet(v)} options={[{value: "", label: "— Select Location —"}, ...locations.map(l => ({value: l.id, label: `${l.icon || "📦"} ${l.name}`}))]} />
                     <div style={{textAlign: "center", margin: "16px 0", color: COLORS.textDim, fontSize: 12, fontFamily: "'JetBrains Mono', monospace", letterSpacing:2}}>OR</div>
                     <Btn full onClick={() => setModal({ type: "addLocation", onSuccess: (id) => locHandleSet(id) })} color={COLORS.success}>+ Create New Location</Btn>
                   </div>
                 )}
               </div>
            ) : (
               locId && <div style={{marginTop: 12}}>
                  <div style={{ fontSize: 20, marginBottom: 8, fontWeight: 700}}>📍 {loc.name}</div>
                  <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 8 }}>{loc.type} · {loc.code}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <Btn small onClick={() => setModal({ type: "locationDetail", location: loc })} color={COLORS.surfaceAlt} style={{border:`1px solid ${COLORS.border}`, color: COLORS.textDim}}>✎ Details</Btn>
                  </div>
                  <PrintLabelMenu content={loc.code} />
               </div>
            )}
         </div>

         {/* Leg 2: Product */}
         {locId && (
         <div style={{ background: COLORS.surfaceAlt, padding: 16, borderRadius: 12, marginBottom: 12, border: `2px solid ${activeLeg === 2 ? COLORS.primary : COLORS.border}` }}>
            <div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
              <div style={{ fontWeight: 800, fontSize: 14, color: activeLeg === 2 ? COLORS.primary : COLORS.textDim }}>2. PRODUCT TO COUNT</div>
              {prodId && activeLeg !== 2 && <Btn small onClick={() => setActiveLeg(2)} color={COLORS.surfaceAlt} style={{border:`1px solid ${COLORS.border}`, color: COLORS.textDim}}>Edit</Btn>}
            </div>

            {activeLeg === 2 ? (
               <div style={{marginTop: 16}}>
                 <div style={{fontSize: 13, color: COLORS.textDim, marginBottom: 12}}>Scan Product Barcode/QR:</div>
                 {!prodId && <div style={{marginBottom: 16}}>
                     <Scanner inline onScan={(code) => {
                        const locFound = locations.find(l => l.code === code);
                        if (locFound) {
                           if (confirm(`Wrong screen! You scanned Location: ${locFound.name}\n\nDo you want to switch your active location to this?`)) {
                              locHandleSet(locFound.id);
                           }
                           return;
                        }
                        
                        const found = products.find(p => p.code === code);
                        if (found) { setProdId(found.id); } 
                        else {
                          setModal({ type: "createProductFromScan", scannedCode: code, onCreated: (newProd) => { setProdId(newProd.id); } });
                        }
                     }} />
                 </div>}
                 <div style={{textAlign: "center", margin: "16px 0", color: COLORS.textDim, fontSize: 12, fontFamily: "'JetBrains Mono', monospace", letterSpacing:2}}>OR SEARCH</div>
                 <Select value={prodId || ""} onChange={v => setProdId(v)} options={[{value:"", label:"— Select Product —"}, ...products.map(p => ({value: p.id, label: p.name}))]} />
                 <div style={{textAlign: "center", margin: "12px 0"}}>
                   <Btn full onClick={() => {
                     setModal({ type: "addProduct", _onCreatedCallback: (newProd) => { setProdId(newProd.id); } });
                   }} color={COLORS.accent} style={{fontSize: 13}}>＋ Create New Product</Btn>
                 </div>
                 {prodId && (
                   <div style={{marginTop: 16, padding: 16, background: COLORS.bg, borderRadius: 12, border: `1px solid ${COLORS.accent}`}}>
                     <div style={{fontSize: 16, fontWeight: 700, marginBottom: 4}}>{prod.name} selected</div>
                     <div style={{fontSize: 12, color: COLORS.textDim, marginBottom: 12}}>Select tracking mode:</div>
                     <div style={{display:"flex", gap: 8}}>
                       <Btn full color={COLORS.primary} onClick={() => prodHandleSet(prodId, "basket")}>Full Trays</Btn>
                       <Btn full color={COLORS.success} onClick={() => prodHandleSet(prodId, "single")}>Individuals</Btn>
                     </div>
                   </div>
                 )}
               </div>
            ) : (
               prodId && <div style={{marginTop: 12}}>
                  <div style={{ fontSize: 18, marginBottom: 8, fontWeight: 700}}>💊 {prod.name}</div>
                  <div style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 8}}>Mode: {mode === "basket" ? "Full Baskets/Trays" : "Individual Items"}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    <Btn small onClick={() => setModal({ type: "editProduct", product: prod })} color={COLORS.surfaceAlt} style={{border:`1px solid ${COLORS.border}`, color: COLORS.textDim}}>✎ Edit Product</Btn>
                    <Btn small onClick={() => setModal({ type: "addTray", prefillProdId: prodId, prefillLocId: locId })} color={COLORS.surfaceAlt} style={{border:`1px solid ${COLORS.primary}`, color: COLORS.primary}}>🏷️ Generate Trays</Btn>
                  </div>
                  <PrintLabelMenu content={prod.code} />
               </div>
            )}
         </div>
         )}

         {/* Leg 3: Scanner */}
         {locId && prodId && activeLeg === 3 && (
           <div style={{ background: COLORS.surfaceAlt, padding: 16, borderRadius: 12, marginBottom: 12, border: `2px solid ${COLORS.success}` }}>
              <div style={{ fontSize: 13, color: COLORS.textDim, marginBottom: 12 }}>3. READY TO SCAN</div>
              <div style={{ fontSize: 13, color: COLORS.textDim, marginBottom: 16 }}>
                Session Total: <span style={{fontWeight: 800, fontSize: 18, color: COLORS.text}}>{sessionCount}</span> added
              </div>

              <div style={{ padding: 12, background: COLORS.bg, borderRadius: 8, marginBottom: 16, border: `1px solid ${COLORS.border}` }}>
                <div style={{ fontSize: 11, color: COLORS.textDim, marginBottom: 8, textAlign: 'center', letterSpacing: 1 }}>MANUAL OVERRIDE</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {mode === "basket" ? (
                    <>
                      <Btn onClick={() => { adjustStock(prod.id, -150, `Removed basket at ${loc?.name || 'Direct Scan'}`, "REMOVAL"); setSessionCount(c => c - 150); }} color={COLORS.danger} small>-1 Basket</Btn>
                      <Btn onClick={() => { adjustStock(prod.id, 150, `Added basket at ${loc?.name || 'Direct Scan'}`, "BASKET_FULL"); setSessionCount(c => c + 150); }} color={COLORS.success} small>+1 Basket</Btn>
                    </>
                  ) : (
                    <>
                      <Btn onClick={() => { adjustStock(prod.id, -1, `Manual minus at ${loc?.name || 'Direct Scan'}`, "REMOVAL"); setSessionCount(c => c - 1); }} color={COLORS.danger} small>-1</Btn>
                      <Btn onClick={() => { adjustStock(prod.id, 1, `Manual plus at ${loc?.name || 'Direct Scan'}`, "INVENTORY_COUNT"); setSessionCount(c => c + 1); }} color={COLORS.success} small>+1</Btn>
                      <Btn onClick={() => { adjustStock(prod.id, 5, `Manual plus at ${loc?.name || 'Direct Scan'}`, "INVENTORY_COUNT"); setSessionCount(c => c + 5); }} color={COLORS.success} small>+5</Btn>
                      <Btn onClick={() => { adjustStock(prod.id, 10, `Manual plus at ${loc?.name || 'Direct Scan'}`, "INVENTORY_COUNT"); setSessionCount(c => c + 10); }} color={COLORS.success} small>+10</Btn>
                    </>
                  )}
                  <Btn onClick={() => {
                      const qty = parseInt(prompt("Enter amount to add (use negative number to subtract):", "1"));
                      if (qty) {
                          adjustStock(prod.id, qty, `Bulk counting at ${loc?.name || 'Direct Scan'}`, qty > 0 ? "INVENTORY_COUNT" : "REMOVAL");
                          setSessionCount(c => c + qty);
                      }
                  }} color={COLORS.primary} small>Custom ±</Btn>
                </div>
              </div>

              <Scanner inline onScan={(code) => {
                 if (code.startsWith("TRY-")) {
                    alert("Tray scanned! Proceeding to auto-audit in full app version.");
                    return;
                 }
                 if (code === prod.code) {
                    const amt = mode === "basket" ? 150 : 1;
                    adjustStock(prod.id, amt, `Workspace session at ${loc?.name || 'Direct Scan'}`, mode === "basket" ? "BASKET_FULL" : "INVENTORY_COUNT");
                    setSessionCount(c => c + amt);
                 } else {
                    alert("Scanned code does not match active product (" + prod.name + ")!");
                 }
              }} />
              <div style={{marginTop: 16}}>
                 <Btn full color={COLORS.surfaceAlt} style={{border:`1px solid ${COLORS.border}`, color: COLORS.text}} onClick={() => {
                   setProdId(null);
                   setSessionCount(0);
                   setActiveLeg(2);
                 }}>Done Counting This Product</Btn>
              </div>
           </div>
         )}
       </div>
    </div>
  );
}

// ═════════════════════════════════════════
// ─── MAIN APP ───
// ═════════════════════════════════════════
export default function App() {
  const [state, setState] = useState(null);
  const [tab, setTab] = useState("dash");
  const [scanning, setScanning] = useState(false);
  const [scanContext, setScanContext] = useState(null); // { mode: "inventory"|"remove"|"add" }
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("All");
  const [session, setSession] = useState(null); // active inventory session
  const fileInputRef = useRef(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState(null);

  // Load data
  useEffect(() => { DB.load().then(d => setState(d)); }, []);

  // Auto-save
  const save = useCallback(async (newState) => {
    setState(newState);
    await DB.saveAll(newState);
  }, []);

  const update = useCallback((fn) => {
    setState(prev => {
      // Corrected baskets -> trays naming
      const next = fn({ ...prev, products: [...prev.products], trays: [...(prev.trays || [])], locations: [...prev.locations], logs: [...prev.logs], sessions: [...prev.sessions] });
      return next;
    });
  }, []);

  // Sync state to DB whenever it changes
  useEffect(() => {
    if (state) {
      DB.saveAll(state);
    }
  }, [state]);

  const addLog = useCallback((entry) => {
    update(s => ({ ...s, logs: [{ id: uid(), timestamp: now(), user: session?.user || "System", ...entry }, ...s.logs].slice(0, 5000) }));
  }, [session, update]);

  if (!state) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: COLORS.bg, color: COLORS.primary, fontFamily: "'JetBrains Mono', monospace", fontSize: 18 }}>Loading Gemini Inventory...</div>;

  const { products: rawProducts, baskets, locations, logs, settings, trays } = state;

  // ─── Derived Data ───
  const products = rawProducts.map(p => {
     let matchingTrays = (trays || []).filter(t => t.productId === p.id && t.status !== "Depleted");
     let stock = matchingTrays.reduce((sum, t) => sum + (t.quantity || 0), 0);
     return { ...p, stock };
  });

  const totalStock = products.reduce((a, p) => a + (p.stock || 0), 0);
  const lowStockItems = products.filter(p => p.stock <= (p.reorderPoint || settings.alertThreshold));
  const totalProducts = products.length;

  // ─── Product CRUD ───
  const addProduct = (prod, existingCode) => {
    const id = uid();
    const code = existingCode || `GEM-${prod.name.replace(/\s+/g, "").slice(0, 4).toUpperCase()}-${id.slice(0, 4)}`;
    const newProd = { id, code, stock: 0, reorderPoint: settings.reorderDefault, createdAt: now(), ...prod };
    DB.setDocRef("products", newProd);
    update(s => ({ ...s, products: [...s.products, newProd] }));
    addLog({ type: "PRODUCT_ADDED", productId: id, detail: `Added ${prod.name}` });
    return newProd;
  };

  const adjustStock = (productId, qty, reason, type = "ADJUSTMENT") => {
    update(s => ({
      ...s,
      products: s.products.map(p => p.id === productId ? { ...p, stock: Math.max(0, p.stock + qty), lastUpdated: now() } : p)
    }));
    const prod = products.find(p => p.id === productId);
    addLog({ type, productId, detail: `${qty > 0 ? "+" : ""}${qty} ${prod?.name || productId}`, reason, qty });
  };

  // ─── Scan Handler ───
  const handleScan = (code) => {
    setScanning(false);
    const prod = products.find(p => p.code === code);
    if (!prod) {
      // Check if it's a location start code
      const loc = locations.find(l => l.code === code);
      if (loc) {
        setModal({ type: "startSession", location: loc });
        return;
      }
      setModal({ type: "unknownCode", code });
      return;
    }

    if (scanContext?.mode === "remove") {
      setModal({ type: "removeStock", product: prod });
    } else if (scanContext?.mode === "fullBasket") {
      adjustStock(prod.id, 150, "Full basket scanned", "BASKET_FULL");
      setModal({ type: "confirm", message: `+150 vials added to ${prod.name}`, product: prod });
    } else {
      setModal({ type: "scanResult", product: prod });
    }
  };

  // ─── Tabs Config ───
  const TABS = [
    { id: "dash", label: "Home", icon: "◉" },
    { id: "scan", label: "Scan", icon: "📷" },
    { id: "products", label: "Products", icon: "◧" },
    { id: "locations", label: "Storage", icon: "⊞" },
    { id: "logs", label: "Logs", icon: "☰" },
    { id: "reports", label: "Reports", icon: "◈" },
    { id: "codes", label: "Codes", icon: "⊠" },
  ];

  // ═════ RENDER ═════
  return (
    <div style={{ background: COLORS.bg, minHeight: "100vh", color: COLORS.text, fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace", maxWidth: 480, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ background: `linear-gradient(135deg, ${COLORS.surface} 0%, ${COLORS.surfaceAlt} 100%)`, borderBottom: `1px solid ${COLORS.border}`, padding: "14px 16px", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: COLORS.primary, letterSpacing: 2 }}>GEMINI</div>
            <div style={{ fontSize: 10, color: COLORS.textMuted, letterSpacing: 3 }}>INVENTORY CONTROL</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {lowStockItems.length > 0 && (
              <button onClick={() => setModal({ type: "alerts" })} style={{ ...baseBtn, background: COLORS.danger + "22", color: COLORS.danger, padding: "6px 10px", fontSize: 12, position: "relative" }}>
                ⚠ {lowStockItems.length}
              </button>
            )}
            {session && <Badge color={COLORS.success}>● {session.user}</Badge>}
          </div>
        </div>
      </div>

      {/* Tab Bar */}
      <div style={{ padding: "8px 12px", position: "sticky", top: 64, zIndex: 99, background: COLORS.bg }}>
        <Tab tabs={TABS} active={tab} onChange={setTab} />
      </div>

      {/* Content */}
      <div style={{ padding: "8px 16px 100px" }}>

        {/* ═══ DASHBOARD ═══ */}
        {tab === "dash" && (
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <StatCard label="Products" value={totalProducts} />
              <StatCard label="Total Stock" value={totalStock.toLocaleString()} />
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              <StatCard label="Low Stock" value={lowStockItems.length} color={lowStockItems.length > 0 ? COLORS.danger : COLORS.success} />
              <StatCard label="Locations" value={locations.length} color={COLORS.accent} />
            </div>

            {/* Quick Actions */}
            <div style={{ marginBottom: 16 }}>
              <Btn full onClick={() => setTab("workspace")} color={COLORS.success} style={{ padding: "16px", fontSize: 16, fontWeight: 800, marginBottom: 8 }}>📦 START INVENTORY CHECK</Btn>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                 <Btn full onClick={() => setModal({ type: "addTray" })} color={COLORS.primary}>🏷️ Generate Trays</Btn>
                 <Btn full onClick={() => setModal({ type: "addProduct" })} color={COLORS.surfaceAlt} style={{border: `1px solid ${COLORS.border}`, color: COLORS.text}}>＋ New Product</Btn>
              </div>
            </div>

            {/* Low Stock Alerts */}
            {lowStockItems.length > 0 && (
              <div style={{ background: COLORS.danger + "11", border: `1px solid ${COLORS.danger}33`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
                <div style={{ color: COLORS.danger, fontWeight: 700, fontSize: 12, marginBottom: 8 }}>⚠ LOW STOCK ALERTS</div>
                {lowStockItems.slice(0, 5).map(p => (
                  <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: `1px solid ${COLORS.border}` }}>
                    <span style={{ fontSize: 13, color: COLORS.text }}>{p.name}</span>
                    <span style={{ color: COLORS.danger, fontWeight: 700, fontSize: 13 }}>{p.stock} / {p.reorderPoint}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Recent Activity */}
            <div style={{ marginTop: 8 }}>
              <div style={{ color: COLORS.textMuted, fontSize: 11, marginBottom: 8, letterSpacing: 2 }}>RECENT ACTIVITY</div>
              {logs.slice(0, 8).map(l => (
                <div key={l.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${COLORS.border}11` }}>
                  <div>
                    <div style={{ fontSize: 12, color: COLORS.text }}>{l.detail}</div>
                    <div style={{ fontSize: 10, color: COLORS.textMuted }}>{l.user} · {l.type}</div>
                  </div>
                  <div style={{ fontSize: 10, color: COLORS.textMuted, whiteSpace: "nowrap" }}>{fmt(l.timestamp)}</div>
                </div>
              ))}
              {logs.length === 0 && <div style={{ color: COLORS.textMuted, fontSize: 13, textAlign: "center", padding: 20 }}>No activity yet</div>}
            </div>
          </div>
        )}

        {/* ═══ WORKSPACE TAB ═══ */}
        {tab === "workspace" && (
          <InventoryWorkspace products={products} locations={locations} adjustStock={adjustStock} addProduct={addProduct} setModal={setModal} onClose={() => setTab("dash")} />
        )}

        {/* ═══ SCAN TAB ═══ */}
        {tab === "scan" && (
          <div>
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>📷</div>
              <div style={{ color: COLORS.textDim, fontSize: 13, marginBottom: 20 }}>Scan barcodes/QR codes to manage inventory</div>
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              <Btn full onClick={() => setTab("workspace")} color={COLORS.success} style={{ padding: "16px 18px", fontSize: 15 }}>
                📦 Start Inventory Session
              </Btn>
              <Btn full onClick={() => { setScanContext({ mode: "fullBasket" }); setScanning(true); }} color={COLORS.primary} style={{ padding: "16px 18px", fontSize: 15 }}>
                📦 Scan FULL Basket Instantly (150)
              </Btn>
              <Btn full onClick={() => { setScanContext({ mode: "remove" }); setScanning(true); }} color={COLORS.accent} style={{ padding: "16px 18px", fontSize: 15 }}>
                📤 Scan to Remove
              </Btn>
            </div>

            {/* AI Categorize */}
            <div style={{ marginTop: 24, background: COLORS.surfaceAlt, borderRadius: 12, padding: 16, border: `1px solid ${COLORS.border}` }}>
              <div style={{ color: COLORS.accent, fontWeight: 700, fontSize: 12, marginBottom: 8, letterSpacing: 1 }}>🤖 AI CATEGORIZE</div>
              <div style={{ color: COLORS.textDim, fontSize: 12, marginBottom: 12 }}>Take a photo of a medication to auto-categorize</div>
              <input ref={fileInputRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setAiLoading(true);
                  const reader = new FileReader();
                  reader.onload = async () => {
                    const base64 = reader.result.split(",")[1];
                    const result = await aiCategorize(base64);
                    setAiResult(result);
                    setAiLoading(false);
                    if (result) setModal({ type: "aiConfirm", result });
                  };
                  reader.readAsDataURL(file);
                }} />
              <Btn full onClick={() => fileInputRef.current?.click()} color={COLORS.accent} disabled={aiLoading}>
                {aiLoading ? "Analyzing..." : "📸 Capture & Categorize"}
              </Btn>
            </div>
          </div>
        )}

        {/* ═══ PRODUCTS TAB ═══ */}
        {tab === "products" && (
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products..."
                style={{ flex: 1, padding: "10px 12px", background: COLORS.surfaceAlt, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text, fontSize: 13, fontFamily: "'JetBrains Mono', monospace", outline: "none" }} />
              <Btn onClick={() => setModal({ type: "addProduct" })} small>＋</Btn>
            </div>

            <div style={{ display: "flex", gap: 4, overflowX: "auto", paddingBottom: 8, marginBottom: 8 }}>
              {CATEGORIES.map(c => (
                <button key={c} onClick={() => setCatFilter(c)} style={{
                  ...baseBtn, padding: "4px 10px", fontSize: 11, whiteSpace: "nowrap",
                  background: catFilter === c ? COLORS.primary : COLORS.surfaceAlt,
                  color: catFilter === c ? COLORS.bg : COLORS.textDim,
                  border: `1px solid ${catFilter === c ? COLORS.primary : COLORS.border}`
                }}>{c}</button>
              ))}
            </div>

            {products
              .filter(p => (catFilter === "All" || p.category === catFilter) && (!search || p.name.toLowerCase().includes(search.toLowerCase()) || p.code.toLowerCase().includes(search.toLowerCase())))
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(p => (
                <div key={p.id} onClick={() => setModal({ type: "productDetail", product: p })}
                  style={{ background: COLORS.surfaceAlt, borderRadius: 10, padding: "12px 14px", marginBottom: 8, border: `1px solid ${p.stock <= (p.reorderPoint || 25) ? COLORS.danger + "44" : COLORS.border}`, cursor: "pointer" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text, marginBottom: 2 }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: COLORS.textMuted }}>{p.code} · {p.category}</div>
                      {p.location && <div style={{ fontSize: 10, color: COLORS.textMuted, marginTop: 2 }}>📍 {locations.find(l => l.id === p.location)?.name || p.location}</div>}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color: p.stock <= (p.reorderPoint || 25) ? COLORS.danger : COLORS.success }}>{p.stock}</div>
                      <div style={{ fontSize: 10, color: COLORS.textMuted }}>/ {p.reorderPoint} reorder</div>
                    </div>
                  </div>
                </div>
              ))}
            {products.length === 0 && <div style={{ textAlign: "center", padding: 40, color: COLORS.textMuted }}>No products yet. Add your first product.</div>}
          </div>
        )}

        {/* ═══ STORAGE LOCATIONS ═══ */}
        {tab === "locations" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ color: COLORS.textMuted, fontSize: 11, letterSpacing: 2 }}>STORAGE LOCATIONS</div>
              <Btn small onClick={() => setModal({ type: "addLocation" })}>＋ Add</Btn>
            </div>
            {locations.map(loc => {
              const locProds = products.filter(p => p.location === loc.id);
              return (
                <div key={loc.id} onClick={() => setModal({ type: "locationDetail", location: loc })}
                  style={{ background: COLORS.surfaceAlt, borderRadius: 10, padding: 14, marginBottom: 8, border: `1px solid ${COLORS.border}`, cursor: "pointer" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{loc.icon || "📦"} {loc.name}</div>
                      <div style={{ fontSize: 11, color: COLORS.textMuted }}>{loc.type} · {locProds.length} products</div>
                    </div>
                    <div style={{ fontSize: 11, color: COLORS.textMuted }}>{loc.code}</div>
                  </div>
                </div>
              );
            })}
            {locations.length === 0 && <div style={{ textAlign: "center", padding: 40, color: COLORS.textMuted }}>No storage locations. Add fridges, shelves, etc.</div>}
          </div>
        )}

        {/* ═══ LOGS TAB ═══ */}
        {tab === "logs" && (
          <div>
            <Input placeholder="Filter logs..." value={search} onChange={setSearch} />
            <Select label="Type" value={catFilter === "All" ? "" : catFilter}
              onChange={v => setCatFilter(v || "All")}
              options={[{ value: "", label: "All Types" }, ...["ADJUSTMENT", "BASKET_FULL", "REMOVAL", "PRODUCT_ADDED", "INVENTORY_COUNT", "RESTOCK"].map(v => ({ value: v, label: v }))]} />
            {logs
              .filter(l => {
                const matchSearch = !search || l.detail?.toLowerCase().includes(search.toLowerCase()) || l.user?.toLowerCase().includes(search.toLowerCase());
                const matchType = catFilter === "All" || l.type === catFilter;
                return matchSearch && matchType;
              })
              .slice(0, 100)
              .map(l => (
                <div key={l.id} style={{ padding: "10px 0", borderBottom: `1px solid ${COLORS.border}11` }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 13, color: COLORS.text }}>{l.detail}</span>
                    <Badge color={l.type?.includes("REMOVE") || l.type?.includes("REMOVAL") ? COLORS.danger : l.type?.includes("ADD") || l.type?.includes("RESTOCK") || l.type?.includes("BASKET") ? COLORS.success : COLORS.primary}>{l.type}</Badge>
                  </div>
                  <div style={{ fontSize: 10, color: COLORS.textMuted, marginTop: 2 }}>
                    {l.user} · {fmt(l.timestamp)}{l.reason ? ` · ${l.reason}` : ""}
                  </div>
                </div>
              ))}
            {logs.length === 0 && <div style={{ textAlign: "center", padding: 40, color: COLORS.textMuted }}>No logs yet</div>}
          </div>
        )}

        {/* ═══ REPORTS TAB ═══ */}
        {tab === "reports" && <ReportsView products={products} logs={logs} />}

        {/* ═══ CODES TAB ═══ */}
        {tab === "codes" && (
          <div>
            <div style={{ color: COLORS.textMuted, fontSize: 11, letterSpacing: 2, marginBottom: 12 }}>BARCODE MANAGEMENT</div>
            <Btn full onClick={() => setModal({ type: "generateCodes" })} color={COLORS.primary} style={{ marginBottom: 16 }}>Generate New Codes</Btn>

            <div style={{ color: COLORS.textMuted, fontSize: 11, letterSpacing: 2, marginBottom: 8, marginTop: 16 }}>PRODUCT CODES</div>
            {products.map(p => (
              <div key={p.id} style={{ background: COLORS.surfaceAlt, borderRadius: 10, padding: 12, marginBottom: 8, border: `1px solid ${COLORS.border}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{p.name}</div>
                  <Badge>{p.code}</Badge>
                </div>
                <div dangerouslySetInnerHTML={{ __html: generateQRSVG(p.code, 280) }} style={{ background: "#fff", borderRadius: 8, padding: 8, display: "flex", justifyContent: "center" }} />
              </div>
            ))}

            <div style={{ color: COLORS.textMuted, fontSize: 11, letterSpacing: 2, marginBottom: 8, marginTop: 24 }}>LOCATION CODES</div>
            {locations.map(loc => (
              <div key={loc.id} style={{ background: COLORS.surfaceAlt, borderRadius: 10, padding: 12, marginBottom: 8, border: `1px solid ${COLORS.border}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{loc.icon} {loc.name}</div>
                  <Badge color={COLORS.accent}>{loc.code}</Badge>
                </div>
                <div dangerouslySetInnerHTML={{ __html: generateQRSVG(loc.code, 280) }} style={{ background: "#fff", borderRadius: 8, padding: 8, display: "flex", justifyContent: "center" }} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Scanner Overlay */}
      {scanning && <Scanner onScan={handleScan} onClose={() => setScanning(false)} />}

      {/* ═══ MODALS ═══ */}

      {/* Add Product */}
      <Modal open={modal?.type === "addProduct"} onClose={() => setModal(null)} title="Add Product">
        <AddProductForm
          categories={CATEGORIES.filter(c => c !== "All")}
          locations={locations}
          prefillCode={modal?.prefillCode}
          prefill={modal?.prefill}
          onAdd={(prod) => {
            const newProd = addProduct(prod, modal?.prefillCode);
            const callback = modal?._onCreatedCallback;
            setModal({ type: "productCreatedWithCode", product: newProd });
            if (callback) callback(newProd);
          }}
        />
      </Modal>

      {/* AI Confirm */}
      <Modal open={modal?.type === "aiConfirm"} onClose={() => setModal(null)} title="AI Categorization">
        {modal?.result && (
          <div>
            <div style={{ background: COLORS.surfaceAlt, borderRadius: 10, padding: 14, marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 4 }}>DETECTED</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: COLORS.text }}>{modal.result.name}</div>
              <div style={{ marginTop: 8 }}><Badge color={COLORS.accent}>{modal.result.category}</Badge></div>
              {modal.result.strength && <div style={{ fontSize: 12, color: COLORS.textDim, marginTop: 4 }}>Strength: {modal.result.strength}</div>}
              {modal.result.notes && <div style={{ fontSize: 12, color: COLORS.textDim, marginTop: 2 }}>{modal.result.notes}</div>}
            </div>
            <Btn full color={COLORS.success} onClick={() => {
              addProduct({ name: modal.result.name, category: modal.result.category, strength: modal.result.strength, notes: modal.result.notes });
              setModal(null);
            }}>✓ Confirm & Add</Btn>
            <div style={{ marginTop: 8 }}>
              <Btn full color={COLORS.textDim} onClick={() => {
                setModal({ type: "addProduct", prefill: modal.result });
              }}>✎ Edit Before Adding</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* Scan Result - Partial Basket */}
      <Modal open={modal?.type === "scanResult"} onClose={() => setModal(null)} title="Scanned Product">
        {modal?.product && (
          <ScanResultForm product={modal.product} onSubmit={(qty, reason) => {
            adjustStock(modal.product.id, qty, reason, qty === 150 ? "BASKET_FULL" : "INVENTORY_COUNT");
            setModal(null);
          }} />
        )}
      </Modal>

      {/* Confirm */}
      <Modal open={modal?.type === "confirm"} onClose={() => setModal(null)} title="Confirmed">
        <div style={{ textAlign: "center", padding: 20, color: COLORS.success, fontSize: 16 }}>✓ {modal?.message}</div>
      </Modal>

      {/* Remove Stock */}
      <Modal open={modal?.type === "removeStock"} onClose={() => setModal(null)} title="Remove Stock">
        {modal?.product && (
          <RemoveStockForm product={modal.product} onSubmit={(qty, reason) => {
            adjustStock(modal.product.id, -qty, reason, "REMOVAL");
            setModal(null);
          }} />
        )}
      </Modal>

      {/* Manual Adjustment */}
      <Modal open={modal?.type === "adjust"} onClose={() => setModal(null)} title="Adjust Inventory">
        {modal?.product && (
          <AdjustForm product={modal.product} onSubmit={(qty, reason) => {
            adjustStock(modal.product.id, qty, reason, "ADJUSTMENT");
            setModal(null);
          }} />
        )}
      </Modal>

      {/* Product Detail */}
      <Modal open={modal?.type === "productDetail"} onClose={() => setModal(null)} title="Product Detail" wide>
        {modal?.product && (() => {
          const p = products.find(x => x.id === modal.product.id) || modal.product;
          const productLogs = logs.filter(l => l.productId === p.id).slice(0, 30);
          const loc = locations.find(l => l.id === p.location);
          return (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: COLORS.text }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: COLORS.textMuted }}>{p.code} · {p.category}</div>
                  {loc && <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>📍 {loc.name}</div>}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: p.stock <= (p.reorderPoint || 25) ? COLORS.danger : COLORS.success }}>{p.stock}</div>
                  <div style={{ fontSize: 10, color: COLORS.textMuted }}>Reorder @ {p.reorderPoint}</div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
                <Btn small color={COLORS.success} onClick={() => setModal({ type: "adjust", product: p })}>± Adjust</Btn>
                <Btn small color={COLORS.accent} onClick={() => setModal({ type: "removeStock", product: p })}>- Remove</Btn>
                <Btn small color={COLORS.primary} onClick={() => setModal({ type: "editProduct", product: p })}>✎ Edit</Btn>
              </div>

              <div style={{ color: COLORS.textMuted, fontSize: 11, letterSpacing: 2, marginBottom: 6 }}>HISTORY</div>
              {productLogs.map(l => (
                <div key={l.id} style={{ padding: "6px 0", borderBottom: `1px solid ${COLORS.border}11`, fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>{l.detail}</span>
                    <span style={{ color: COLORS.textMuted, fontSize: 10 }}>{fmt(l.timestamp)}</span>
                  </div>
                  {l.reason && <div style={{ color: COLORS.textMuted, fontSize: 10 }}>Reason: {l.reason}</div>}
                </div>
              ))}
              {productLogs.length === 0 && <div style={{ color: COLORS.textMuted, fontSize: 12, padding: 12, textAlign: "center" }}>No history</div>}
            </div>
          );
        })()}
      </Modal>

      {/* Edit Product */}
      <Modal open={modal?.type === "editProduct"} onClose={() => setModal(null)} title="Edit Product">
        {modal?.product && (
          <EditProductForm product={modal.product} categories={CATEGORIES.filter(c => c !== "All")} locations={locations}
            onSave={(updates) => {
              update(s => ({ ...s, products: s.products.map(p => p.id === modal.product.id ? { ...p, ...updates } : p) }));
              addLog({ type: "PRODUCT_EDITED", productId: modal.product.id, detail: `Edited ${modal.product.name}` });
              setModal(null);
            }}
            onDelete={() => {
              if (confirm("Delete this product?")) {
                update(s => ({ ...s, products: s.products.filter(p => p.id !== modal.product.id) }));
                addLog({ type: "PRODUCT_DELETED", productId: modal.product.id, detail: `Deleted ${modal.product.name}` });
                setModal(null);
              }
            }}
          />
        )}
      </Modal>

      {/* Add Location */}
      <Modal open={modal?.type === "addLocation"} onClose={() => setModal(null)} title="Add Storage Location">
        <AddLocationForm onAdd={(loc) => {
          const id = uid();
          const code = `LOC-${loc.name.replace(/\s+/g, "").slice(0, 5).toUpperCase()}-${id.slice(0, 3)}`;
          const newLoc = { id, code, createdAt: now(), ...loc };
          DB.setDocRef("locations", newLoc);
          update(s => ({ ...s, locations: [...s.locations, newLoc] }));
          addLog({ type: "LOCATION_ADDED", detail: `Added location: ${loc.name}` });
          setModal(null);
          if (modal.onSuccess) modal.onSuccess(id);
        }} />
      </Modal>

      {/* Add Tray */}
      <Modal open={modal?.type === "addTray"} onClose={() => setModal(null)} title="Generate Inventory Trays">
        <AddTrayForm products={products} locations={locations} initialProdId={modal?.prefillProdId} initialLocId={modal?.prefillLocId} onAdd={({ prodId, locId, lotNum, expDate, trayCount, qtyPerTray }) => {
           let newTrays = [];
           const prodName = products.find(p=>p.id===prodId)?.name || "UNK";
           for(let i=0; i<trayCount; i++) {
              let id = uid();
              let code = `TRY-${prodName.replace(/[^A-Za-z]/g, '').slice(0,3).toUpperCase()}-${uid().slice(0,4)}`;
              newTrays.push({ id, code, productId: prodId, locationId: locId, lotNumber: lotNum, expirationDate: expDate, quantity: qtyPerTray, status: "Active", createdAt: now() });
           }
           
           newTrays.forEach(t => DB.setDocRef("trays", t));
           update(s => ({ ...s, trays: [...(s.trays||[]), ...newTrays] }));
           addLog({ type: "TRAY_ADDED", detail: `Generated ${trayCount} tray(s) of ${prodName} (Lot ${lotNum})` });
           
           setModal({ type: "printTrays", trays: newTrays });
        }} />
      </Modal>

      {/* Print Trays Result */}
      <Modal open={modal?.type === "printTrays"} onClose={() => setModal(null)} title="Trays Generated Successfuly" wide>
         <div style={{ color: COLORS.success, fontSize: 13, marginBottom: 16 }}>{modal?.trays?.length} trays have been registered. Print the labels below and attach them to the physical containers.</div>
         <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            {modal?.trays?.map(t => (
               <div key={t.id} style={{ background: COLORS.surfaceAlt, padding: 12, borderRadius: 8, border: `1px solid ${COLORS.border}` }}>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{t.code}</div>
                  <div style={{ fontSize: 12, color: COLORS.textDim, marginBottom: 8 }}>Lot: {t.lotNumber}</div>
                  <PrintLabelMenu content={t.code} />
               </div>
            ))}
         </div>
         <div style={{marginTop: 16}}>
           <Btn full onClick={() => setModal(null)} color={COLORS.primary}>Done</Btn>
         </div>
      </Modal>

      {/* Location Detail */}
      <Modal open={modal?.type === "locationDetail"} onClose={() => setModal(null)} title="Location Detail" wide>
        {modal?.location && (() => {
          const loc = modal.location;
          const locProds = products.filter(p => p.location === loc.id);
          return (
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{loc.icon || "📦"} {loc.name}</div>
              <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 12 }}>{loc.type} · Code: {loc.code}</div>
              <div style={{ color: COLORS.textMuted, fontSize: 11, letterSpacing: 2, marginBottom: 8 }}>PRODUCTS ({locProds.length})</div>
              {locProds.map(p => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${COLORS.border}11`, fontSize: 13 }}>
                  <span>{p.name}</span>
                  <span style={{ fontWeight: 700, color: p.stock <= (p.reorderPoint || 25) ? COLORS.danger : COLORS.success }}>{p.stock}</span>
                </div>
              ))}
              {locProds.length === 0 && <div style={{ color: COLORS.textMuted, fontSize: 12, padding: 12 }}>No products assigned</div>}
              <div style={{ marginTop: 16 }}>
                <Btn small color={COLORS.danger} onClick={() => {
                  if (confirm("Delete this location?")) {
                    update(s => ({ ...s, locations: s.locations.filter(l => l.id !== loc.id) }));
                    setModal(null);
                  }
                }}>Delete Location</Btn>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Start Session */}
      <Modal open={modal?.type === "startSession"} onClose={() => setModal(null)} title="Start Inventory Session">
        <StartSessionForm location={modal?.location} onStart={(user, locId) => {
          const s = { id: uid(), user, locationId: locId, startedAt: now() };
          setSession(s);
          update(st => ({ ...st, sessions: [...st.sessions, s] }));
          addLog({ type: "SESSION_START", detail: `Session started by ${user}` });
          setModal(null);
        }} />
      </Modal>

      {/* Alerts */}
      <Modal open={modal?.type === "alerts"} onClose={() => setModal(null)} title="Low Stock Alerts" wide>
        {lowStockItems.map(p => (
          <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${COLORS.border}11` }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{p.name}</div>
              <div style={{ fontSize: 11, color: COLORS.textMuted }}>{p.category}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: COLORS.danger, fontWeight: 800, fontSize: 18 }}>{p.stock}</div>
              <div style={{ color: COLORS.textMuted, fontSize: 10 }}>Reorder: {p.reorderPoint}</div>
            </div>
          </div>
        ))}
      </Modal>

      {/* Unknown Code */}
      <Modal open={modal?.type === "unknownCode"} onClose={() => setModal(null)} title="Unknown Code">
        <div style={{ textAlign: "center", padding: 20 }}>
          <div style={{ fontSize: 14, color: COLORS.textDim, marginBottom: 8 }}>Code not recognized:</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: COLORS.accent, marginBottom: 12 }}>{modal?.code}</div>
          <div dangerouslySetInnerHTML={{ __html: generateQRSVG(modal?.code || "", 180) }} style={{ background: "#fff", borderRadius: 8, padding: 8, display: "inline-flex", justifyContent: "center", marginBottom: 16 }} />
          <div style={{ fontSize: 12, color: COLORS.textDim, marginBottom: 16 }}>This code will be assigned as the new product's label code.</div>
          <Btn full onClick={() => setModal({ type: "addProduct", prefillCode: modal?.code })} color={COLORS.success}>＋ Create New Product with This Code</Btn>
        </div>
      </Modal>

      {/* Create Product from Workspace Scan */}
      <Modal open={modal?.type === "createProductFromScan"} onClose={() => setModal(null)} title="Product Not Found">
        <div style={{ textAlign: "center", padding: 16 }}>
          <div style={{ fontSize: 14, color: COLORS.textDim, marginBottom: 8 }}>No product matches this code:</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: COLORS.accent, marginBottom: 12 }}>{modal?.scannedCode}</div>
          <div dangerouslySetInnerHTML={{ __html: generateQRSVG(modal?.scannedCode || "", 160) }} style={{ background: "#fff", borderRadius: 8, padding: 8, display: "inline-flex", justifyContent: "center", marginBottom: 16 }} />
          <div style={{ fontSize: 12, color: COLORS.textDim, marginBottom: 16 }}>Create a new product and assign this code as its label.</div>
          <Btn full onClick={() => {
            const onCreated = modal?.onCreated;
            const code = modal?.scannedCode;
            setModal({ type: "addProduct", prefillCode: code, _onCreatedCallback: onCreated });
          }} color={COLORS.success}>＋ Create New Product</Btn>
          <div style={{ marginTop: 8 }}>
            <Btn full onClick={() => setModal(null)} color={COLORS.surfaceAlt} style={{ border: `1px solid ${COLORS.border}`, color: COLORS.textDim }}>Cancel</Btn>
          </div>
        </div>
      </Modal>

      {/* Product Created with Code - shows QR for printing */}
      <Modal open={modal?.type === "productCreatedWithCode"} onClose={() => setModal(null)} title="Product Created ✓">
        {modal?.product && (
          <div style={{ textAlign: "center", padding: 16 }}>
            <div style={{ color: COLORS.success, fontSize: 16, fontWeight: 700, marginBottom: 4 }}>✓ {modal.product.name}</div>
            <div style={{ fontSize: 12, color: COLORS.textDim, marginBottom: 16 }}>Registered with code: <strong style={{ color: COLORS.primary }}>{modal.product.code}</strong></div>
            <div dangerouslySetInnerHTML={{ __html: generateQRSVG(modal.product.code, 240) }} style={{ background: "#fff", borderRadius: 8, padding: 12, display: "inline-flex", justifyContent: "center", marginBottom: 12 }} />
            <div style={{ fontSize: 12, color: COLORS.textDim, marginBottom: 12 }}>Print this label and attach it to the product container.</div>
            <PrintLabelMenu content={modal.product.code} />
            <div style={{ marginTop: 16 }}>
              <Btn full onClick={() => setModal(null)} color={COLORS.primary}>Done</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* Generate Codes */}
      <Modal open={modal?.type === "generateCodes"} onClose={() => setModal(null)} title="Generate Codes" wide>
        <div style={{ color: COLORS.textDim, fontSize: 12, marginBottom: 12 }}>Codes are auto-generated when you add products or locations. To print, screenshot the codes from the Codes tab.</div>
        <Btn full onClick={() => { setModal(null); setTab("codes"); }}>View All Codes</Btn>
      </Modal>
    </div>
  );
}

// ─── Sub-forms ───

function AddProductForm({ categories, locations, onAdd, prefill, prefillCode }) {
  const [name, setName] = useState(prefill?.name || "");
  const [category, setCategory] = useState(prefill?.category || categories[0]);
  const [strength, setStrength] = useState(prefill?.strength || "");
  const [location, setLocation] = useState("");
  const [reorderPoint, setReorderPoint] = useState("50");

  return (
    <div>
      {prefillCode && (
        <div style={{ background: COLORS.surfaceAlt, borderRadius: 10, padding: 12, marginBottom: 16, border: `1px solid ${COLORS.primary}44`, textAlign: "center" }}>
          <div style={{ fontSize: 10, color: COLORS.textMuted, letterSpacing: 1, marginBottom: 4 }}>LABEL CODE ASSIGNED</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.primary }}>{prefillCode}</div>
          <div dangerouslySetInnerHTML={{ __html: generateQRSVG(prefillCode, 140) }} style={{ background: "#fff", borderRadius: 6, padding: 6, display: "inline-flex", justifyContent: "center", marginTop: 8 }} />
        </div>
      )}
      <Input label="Product Name" value={name} onChange={setName} placeholder="e.g. Semaglutide 2.5mg" />
      <Select label="Category" value={category} onChange={setCategory}
        options={categories.map(c => ({ value: c, label: c }))} />
      <Input label="Strength / Description" value={strength} onChange={setStrength} placeholder="e.g. 2.5mg/mL" />
      {locations.length > 0 && (
        <Select label="Storage Location" value={location} onChange={setLocation}
          options={[{ value: "", label: "— None —" }, ...locations.map(l => ({ value: l.id, label: `${l.icon || "📦"} ${l.name}` }))]} />
      )}
      <Input label="Reorder Point" value={reorderPoint} onChange={setReorderPoint} type="number" />
      <Btn full color={COLORS.success} disabled={!name.trim()} onClick={() => onAdd({ name: name.trim(), category, strength, location: location || undefined, reorderPoint: parseInt(reorderPoint) || 50 })}>
        {prefillCode ? "Create Product & Assign Code" : "Add Product"}
      </Btn>
    </div>
  );
}

function EditProductForm({ product, categories, locations, onSave, onDelete }) {
  const [name, setName] = useState(product.name);
  const [category, setCategory] = useState(product.category);
  const [strength, setStrength] = useState(product.strength || "");
  const [location, setLocation] = useState(product.location || "");
  const [reorderPoint, setReorderPoint] = useState(String(product.reorderPoint || 50));

  return (
    <div>
      <Input label="Product Name" value={name} onChange={setName} />
      <Select label="Category" value={category} onChange={setCategory}
        options={categories.map(c => ({ value: c, label: c }))} />
      <Input label="Strength" value={strength} onChange={setStrength} />
      {locations.length > 0 && (
        <Select label="Storage Location" value={location} onChange={setLocation}
          options={[{ value: "", label: "— None —" }, ...locations.map(l => ({ value: l.id, label: `${l.icon || "📦"} ${l.name}` }))]} />
      )}
      <Input label="Reorder Point" value={reorderPoint} onChange={setReorderPoint} type="number" />
      <div style={{ display: "flex", gap: 8 }}>
        <Btn full color={COLORS.success} onClick={() => onSave({ name, category, strength, location: location || undefined, reorderPoint: parseInt(reorderPoint) || 50 })}>Save</Btn>
        <Btn color={COLORS.danger} onClick={onDelete}>Delete</Btn>
      </div>
    </div>
  );
}

function ScanResultForm({ product, onSubmit }) {
  const [qty, setQty] = useState(150);
  const [reason, setReason] = useState("");

  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, color: COLORS.text }}>{product.name}</div>
      <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 16 }}>Current stock: {product.stock} · Code: {product.code}</div>

      <div style={{ color: COLORS.textDim, fontSize: 11, marginBottom: 8, letterSpacing: 1 }}>QUICK SET</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {PRESETS.map(p => (
          <button key={p} onClick={() => setQty(p)} style={{
            ...baseBtn, padding: "8px 14px", fontSize: 13,
            background: qty === p ? COLORS.primary : COLORS.surfaceAlt,
            color: qty === p ? COLORS.bg : COLORS.text,
            border: `1px solid ${qty === p ? COLORS.primary : COLORS.border}`
          }}>{p}</button>
        ))}
      </div>
      <Input label="Quantity" value={String(qty)} onChange={v => setQty(parseInt(v) || 0)} type="number" />
      <Input label="Note (optional)" value={reason} onChange={setReason} placeholder="e.g. Basket 3, shelf B" />
      <Btn full color={COLORS.success} onClick={() => onSubmit(qty, reason)}>＋ Add {qty} to Inventory</Btn>
    </div>
  );
}

function RemoveStockForm({ product, onSubmit }) {
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState("");

  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{product.name}</div>
      <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 16 }}>Current stock: {product.stock}</div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {[1, 5, 10, 25].map(p => (
          <button key={p} onClick={() => setQty(p)} style={{
            ...baseBtn, padding: "8px 14px", fontSize: 13,
            background: qty === p ? COLORS.danger : COLORS.surfaceAlt,
            color: qty === p ? COLORS.white : COLORS.text,
            border: `1px solid ${qty === p ? COLORS.danger : COLORS.border}`
          }}>{p}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onClick={() => setQty(Math.max(1, qty - 1))} style={{ ...baseBtn, padding: "10px 16px", background: COLORS.surfaceAlt, color: COLORS.text, fontSize: 18, border: `1px solid ${COLORS.border}` }}>−</button>
        <input type="number" value={qty} onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))}
          style={{ flex: 1, textAlign: "center", padding: "10px", background: COLORS.surfaceAlt, border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text, fontSize: 20, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", outline: "none" }} />
        <button onClick={() => setQty(qty + 1)} style={{ ...baseBtn, padding: "10px 16px", background: COLORS.surfaceAlt, color: COLORS.text, fontSize: 18, border: `1px solid ${COLORS.border}` }}>＋</button>
      </div>
      <Input label="Reason" value={reason} onChange={setReason} placeholder="e.g. Dispensed, damaged, expired" />
      <Btn full color={COLORS.danger} disabled={qty > product.stock} onClick={() => onSubmit(qty, reason)}>
        Remove {qty} {qty > product.stock ? "(exceeds stock)" : ""}
      </Btn>
    </div>
  );
}

function AdjustForm({ product, onSubmit }) {
  const [qty, setQty] = useState(0);
  const [reason, setReason] = useState("");

  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{product.name}</div>
      <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 16 }}>Current: {product.stock}</div>
      <Input label="Adjustment (+/-)" value={String(qty)} onChange={v => setQty(parseInt(v) || 0)} type="number" />
      <div style={{ fontSize: 12, color: qty >= 0 ? COLORS.success : COLORS.danger, marginBottom: 8 }}>
        New total: {product.stock + qty}
      </div>
      <Input label="Reason (required)" value={reason} onChange={setReason} placeholder="e.g. Physical count correction, breakage" />
      <Btn full color={COLORS.accent} disabled={!reason.trim()} onClick={() => onSubmit(qty, reason)}>
        Apply Adjustment
      </Btn>
    </div>
  );
}

function AddLocationForm({ onAdd }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("Refrigerator");
  const [icon, setIcon] = useState("🧊");

  const typeOpts = [
    { value: "Refrigerator", label: "🧊 Refrigerator" },
    { value: "Freezer", label: "❄️ Freezer" },
    { value: "Shelf", label: "📦 Shelf" },
    { value: "Cabinet", label: "🗄️ Cabinet" },
    { value: "Vault", label: "🔒 Vault" },
    { value: "Other", label: "📍 Other" }
  ];
  const icons = { Refrigerator: "🧊", Freezer: "❄️", Shelf: "📦", Cabinet: "🗄️", Vault: "🔒", Other: "📍" };

  return (
    <div>
      <Input label="Location Name" value={name} onChange={setName} placeholder="e.g. Main Fridge, Shelf A" />
      <Select label="Type" value={type} onChange={v => { setType(v); setIcon(icons[v] || "📍"); }}
        options={typeOpts} />
      <Btn full color={COLORS.success} disabled={!name.trim()} onClick={() => onAdd({ name: name.trim(), type, icon })}>
        Add Location
      </Btn>
    </div>
  );
}

function StartSessionForm({ location, onStart }) {
  const [user, setUser] = useState("");
  const [locId, setLocId] = useState(location?.id || "");

  return (
    <div>
      <div style={{ color: COLORS.textDim, fontSize: 12, marginBottom: 12 }}>Identify yourself before starting inventory count.</div>
      <Input label="Your Name / Initials" value={user} onChange={setUser} placeholder="e.g. DV" />
      <Btn full color={COLORS.success} disabled={!user.trim()} onClick={() => onStart(user.trim(), locId)}>
        Start Session
      </Btn>
    </div>
  );
}

// ─── Reports View ───
function ReportsView({ products, logs }) {
  const [range, setRange] = useState("7d");
  const now_ = Date.now();
  const rangeDays = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const cutoff = new Date(now_ - rangeDays * 86400000).toISOString();
  const filtered = logs.filter(l => l.timestamp >= cutoff);

  const removals = filtered.filter(l => l.type === "REMOVAL");
  const additions = filtered.filter(l => ["BASKET_FULL", "INVENTORY_COUNT", "RESTOCK"].includes(l.type));
  const adjustments = filtered.filter(l => l.type === "ADJUSTMENT");

  // Product turnover
  const productRemovals = {};
  removals.forEach(l => {
    if (l.productId) productRemovals[l.productId] = (productRemovals[l.productId] || 0) + Math.abs(l.qty || 1);
  });
  const topMovers = Object.entries(productRemovals)
    .map(([id, count]) => ({ product: products.find(p => p.id === id), count }))
    .filter(x => x.product)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Forecasting: simple linear based on removal rate
  const forecast = products.map(p => {
    const rate = (productRemovals[p.id] || 0) / rangeDays;
    const daysLeft = rate > 0 ? Math.round(p.stock / rate) : Infinity;
    return { ...p, rate: rate.toFixed(1), daysLeft };
  }).filter(p => p.daysLeft < 999).sort((a, b) => a.daysLeft - b.daysLeft);

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {["7d", "30d", "90d"].map(r => (
          <button key={r} onClick={() => setRange(r)} style={{
            ...baseBtn, padding: "6px 14px", fontSize: 12,
            background: range === r ? COLORS.primary : COLORS.surfaceAlt,
            color: range === r ? COLORS.bg : COLORS.textDim,
            border: `1px solid ${range === r ? COLORS.primary : COLORS.border}`
          }}>{r}</button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <StatCard label="Removals" value={removals.length} color={COLORS.danger} />
        <StatCard label="Additions" value={additions.length} color={COLORS.success} />
        <StatCard label="Adjustments" value={adjustments.length} color={COLORS.accent} />
      </div>

      <div style={{ color: COLORS.textMuted, fontSize: 11, letterSpacing: 2, marginBottom: 8 }}>TOP MOVERS</div>
      {topMovers.map(({ product: p, count }) => (
        <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${COLORS.border}11`, fontSize: 13 }}>
          <span>{p.name}</span>
          <span style={{ fontWeight: 700, color: COLORS.accent }}>{count} removed</span>
        </div>
      ))}
      {topMovers.length === 0 && <div style={{ color: COLORS.textMuted, fontSize: 12, padding: 12, textAlign: "center" }}>No removal data yet</div>}

      <div style={{ color: COLORS.textMuted, fontSize: 11, letterSpacing: 2, marginBottom: 8, marginTop: 24 }}>📈 STOCK FORECAST</div>
      <div style={{ color: COLORS.textDim, fontSize: 11, marginBottom: 8 }}>Estimated days until stockout based on {rangeDays}-day removal rate</div>
      {forecast.slice(0, 10).map(p => (
        <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${COLORS.border}11`, fontSize: 13 }}>
          <div>
            <span>{p.name}</span>
            <span style={{ color: COLORS.textMuted, fontSize: 10, marginLeft: 6 }}>{p.rate}/day</span>
          </div>
          <span style={{ fontWeight: 700, color: p.daysLeft < 14 ? COLORS.danger : p.daysLeft < 30 ? COLORS.accent : COLORS.success }}>
            {p.daysLeft === Infinity ? "∞" : `${p.daysLeft}d`}
          </span>
        </div>
      ))}
      {forecast.length === 0 && <div style={{ color: COLORS.textMuted, fontSize: 12, padding: 12, textAlign: "center" }}>Need removal data to forecast</div>}
    </div>
  );
}
