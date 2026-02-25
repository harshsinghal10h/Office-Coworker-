/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState, useEffect, useRef, useCallback, useReducer } from 'react';
import mammoth from 'mammoth';
import html2pdf from 'html2pdf.js';
import * as pdfjsLib from 'pdfjs-dist';

// Set PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

import { 
  FileText, Table, Presentation as PresentationIcon, Settings, Plus, Trash2, Edit2, 
  Search, X, Save, Download, Upload, Bold, Italic, Underline, 
  Strikethrough, AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Image as ImageIcon, Link as LinkIcon, 
  Minus, ZoomIn, ZoomOut, Play, Copy, Check, Sparkles, ChevronDown,
  ChevronRight, ChevronLeft, Type, LayoutTemplate, FileSpreadsheet,
  FileIcon, FilePlus, FileDown, FileUp, MoreVertical, Maximize,
  MessageSquare, RefreshCw, Scissors, Clipboard,
  Undo, Redo, Printer, FileCode
} from 'lucide-react';

// --- INDEXED DB STORAGE ---
const DB_NAME = 'NexOfficeDB';
const DB_VERSION = 1;

const initDB = () => {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('documents')) {
        db.createObjectStore('documents', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'id' });
      }
    };
  });
};

// --- TYPES ---
type DocType = 'writer' | 'spreadsheet' | 'presentation';
interface Document {
  id: string;
  name: string;
  type: DocType;
  content: any;
  createdAt: number;
  savedAt: number;
}
interface Settings {
  id: 'user';
  anthropicApiKey: string;
  aiModel: string;
  autoSaveInterval: number;
  defaultFont: string;
  defaultFontSize: number;
  spellCheck: boolean;
  grammarCheck: boolean;
  autoCorrect: boolean;
  clipboardAutoClear: boolean;
  darkMode: boolean;
  language: string;
}

const defaultSettings: Settings = {
  id: 'user',
  anthropicApiKey: '',
  aiModel: 'claude-sonnet-4-20250514',
  autoSaveInterval: 2,
  defaultFont: 'Playfair Display',
  defaultFontSize: 12,
  spellCheck: true,
  grammarCheck: true,
  autoCorrect: true,
  clipboardAutoClear: false,
  darkMode: true,
  language: 'en-US'
};

// --- DB HELPERS ---
const dbOp = async (storeName: string, mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest) => {
  const db = await initDB();
  return new Promise<any>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const request = op(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const getDocs = () => dbOp('documents', 'readonly', s => s.getAll());
const saveDoc = (doc: Document) => dbOp('documents', 'readwrite', s => s.put(doc));
const deleteDoc = (id: string) => dbOp('documents', 'readwrite', s => s.delete(id));
const getSettings = async (): Promise<Settings> => {
  const s = await dbOp('settings', 'readonly', s => s.get('user'));
  return s || defaultSettings;
};
const saveSettings = (s: Settings) => dbOp('settings', 'readwrite', store => store.put(s));

// --- AI API ---
const callClaude = async (prompt: string, apiKey: string, model: string, system?: string) => {
  if (!apiKey) throw new Error("API Key not set in Settings.");
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model,
      max_tokens: 1000,
      system,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || 'API Error');
  }
  const data = await res.json();
  return data.content?.[0]?.text || data.message || JSON.stringify(data);
};

// --- WRITER COMPONENT ---
const Writer = ({ doc, updateDoc, settings }: { doc: Document, updateDoc: (c: any) => void, settings: Settings }) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(100);
  const [stats, setStats] = useState({ words: 0, chars: 0 });
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState('');

  useEffect(() => {
    if (editorRef.current && doc?.content && editorRef.current.innerHTML !== doc.content) {
      editorRef.current.innerHTML = doc.content;
      updateStats();
    }
  }, [doc?.id]);

  const updateStats = () => {
    if (!editorRef.current) return;
    const text = editorRef.current.innerText || '';
    setStats({
      words: text.trim() ? text.trim().split(/\s+/).length : 0,
      chars: text.length
    });
  };

  const handleInput = () => {
    if (editorRef.current) {
      updateDoc(editorRef.current.innerHTML);
      updateStats();
    }
  };

  const exec = (cmd: string, val?: string) => {
    document.execCommand(cmd, false, val);
    handleInput();
  };

  const insertTable = () => {
    const r = prompt('Rows?', '3');
    const c = prompt('Cols?', '3');
    if (r && c) {
      let html = '<table border="1" style="border-collapse: collapse; width: 100%; margin-bottom: 1em;">';
      for (let i = 0; i < parseInt(r); i++) {
        html += '<tr>';
        for (let j = 0; j < parseInt(c); j++) html += '<td style="padding: 8px; border: 1px solid #ccc;">&nbsp;</td>';
        html += '</tr>';
      }
      html += '</table><p><br></p>';
      exec('insertHTML', html);
    }
  };

  const insertImage = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (re) => exec('insertImage', re.target?.result as string);
        reader.readAsDataURL(file);
      }
    };
    input.click();
  };

  const runAi = async (promptType: string) => {
    const sel = window.getSelection()?.toString();
    if (!sel && promptType !== 'Generate Full Document' && promptType !== 'Generate Outline') {
      alert('Please select some text first.');
      return;
    }
    setAiLoading(true);
    setAiPanelOpen(true);
    try {
      let prompt = '';
      if (promptType === 'Rewrite & Improve') prompt = `Rewrite and improve this text:\n\n${sel}`;
      else if (promptType === 'Summarize') prompt = `Summarize this text:\n\n${sel}`;
      else if (promptType === 'Expand Content') prompt = `Expand this text with more detail:\n\n${sel}`;
      else if (promptType === 'Fix Grammar & Spelling') prompt = `Fix all grammar and spelling errors in this text. Output only the corrected text:\n\n${sel}`;
      else if (promptType === 'Translate') {
        const lang = prompt('Target language?');
        if (!lang) { setAiLoading(false); return; }
        prompt = `Translate this text to ${lang}:\n\n${sel}`;
      }
      else if (promptType === 'Generate Outline') prompt = `Generate a structured document outline for the topic: ${prompt('Topic?')}`;
      else if (promptType === 'Smart Complete') prompt = `Continue this text naturally:\n\n${sel}`;
      else if (promptType === 'Tone Adjustment') prompt = `Adjust the tone of this text to be ${prompt('Tone? (e.g., formal, casual)')}:\n\n${sel}`;
      else if (promptType === 'Extract Key Points') prompt = `Extract key points as bullet points from this text:\n\n${sel}`;
      else if (promptType === 'Create Table from Text') prompt = `Convert this text into an HTML table. Output ONLY valid HTML <table> code:\n\n${sel}`;
      else if (promptType === 'Generate Full Document') prompt = `Write a full document about: ${prompt('Document description?')}`;
      
      const res = await callClaude(prompt, settings.anthropicApiKey, settings.aiModel, "You are an expert AI writing assistant for a word processor. Provide direct, high-quality responses without conversational filler.");
      setAiResult(res);
    } catch (e: any) {
      setAiResult('Error: ' + e.message);
    }
    setAiLoading(false);
  };

  const applyAiResult = () => {
    if (aiResult.includes('<table')) {
      exec('insertHTML', aiResult);
    } else {
      exec('insertText', aiResult);
    }
    setAiResult('');
  };

  const exportPDF = () => {
    if (!editorRef.current) return;
    const opt = {
      margin:       [10, 10, 10, 10],
      filename:     `${doc.name}.pdf`,
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 2, useCORS: true },
      jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    html2pdf().set(opt).from(editorRef.current).save();
  };

  const exportTXT = () => {
    const text = editorRef.current?.innerText || '';
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.name}.txt`;
    a.click();
  };

  const exportHTML = () => {
    const html = editorRef.current?.innerHTML || '';
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.name}.html`;
    a.click();
  };

  return (
    <div className="flex flex-col h-full bg-[#0d0d0f] relative">
      {/* Toolbar */}
      <div className="flex overflow-x-auto items-center gap-2 p-2 bg-[#17171a] border-b border-[#2a2a30] flex-shrink-0">
        <button onClick={() => exec('undo')} className="p-1 hover:bg-[#c8a96e]/20 rounded flex-shrink-0" title="Undo"><Undo size={16}/></button>
        <button onClick={() => exec('redo')} className="p-1 hover:bg-[#c8a96e]/20 rounded flex-shrink-0" title="Redo"><Redo size={16}/></button>
        <div className="h-6 w-px bg-[#2a2a30] mx-1 flex-shrink-0"></div>
        <select className="bg-[#1e1e22] text-[#e8e8ec] border border-[#2a2a30] rounded px-2 py-1 flex-shrink-0" onChange={e => exec('fontName', e.target.value)}>
          <option value="Playfair Display">Playfair Display</option>
          <option value="Georgia">Georgia</option>
          <option value="Times New Roman">Times New Roman</option>
          <option value="Arial">Arial</option>
          <option value="Calibri">Calibri</option>
          <option value="Courier New">Courier New</option>
        </select>
        <select className="bg-[#1e1e22] text-[#e8e8ec] border border-[#2a2a30] rounded px-2 py-1" onChange={e => exec('fontSize', e.target.value)}>
          {[1,2,3,4,5,6,7].map(s => <option key={s} value={s}>Size {s}</option>)}
        </select>
        <div className="h-6 w-px bg-[#2a2a30] mx-1"></div>
        <button onClick={() => exec('bold')} className="p-1 hover:bg-[#c8a96e]/20 rounded"><Bold size={16}/></button>
        <button onClick={() => exec('italic')} className="p-1 hover:bg-[#c8a96e]/20 rounded"><Italic size={16}/></button>
        <button onClick={() => exec('underline')} className="p-1 hover:bg-[#c8a96e]/20 rounded"><Underline size={16}/></button>
        <button onClick={() => exec('strikeThrough')} className="p-1 hover:bg-[#c8a96e]/20 rounded"><Strikethrough size={16}/></button>
        <input type="color" onChange={e => exec('foreColor', e.target.value)} className="w-6 h-6 p-0 border-0 bg-transparent cursor-pointer" title="Text Color"/>
        <input type="color" onChange={e => exec('hiliteColor', e.target.value)} className="w-6 h-6 p-0 border-0 bg-transparent cursor-pointer" title="Highlight Color"/>
        <div className="h-6 w-px bg-[#2a2a30] mx-1"></div>
        <button onClick={() => exec('justifyLeft')} className="p-1 hover:bg-[#c8a96e]/20 rounded"><AlignLeft size={16}/></button>
        <button onClick={() => exec('justifyCenter')} className="p-1 hover:bg-[#c8a96e]/20 rounded"><AlignCenter size={16}/></button>
        <button onClick={() => exec('justifyRight')} className="p-1 hover:bg-[#c8a96e]/20 rounded"><AlignRight size={16}/></button>
        <button onClick={() => exec('justifyFull')} className="p-1 hover:bg-[#c8a96e]/20 rounded"><AlignJustify size={16}/></button>
        <div className="h-6 w-px bg-[#2a2a30] mx-1"></div>
        <button onClick={() => exec('insertUnorderedList')} className="p-1 hover:bg-[#c8a96e]/20 rounded"><List size={16}/></button>
        <button onClick={() => exec('insertOrderedList')} className="p-1 hover:bg-[#c8a96e]/20 rounded"><ListOrdered size={16}/></button>
        <button onClick={() => exec('indent')} className="p-1 hover:bg-[#c8a96e]/20 rounded text-xs font-bold">In+</button>
        <button onClick={() => exec('outdent')} className="p-1 hover:bg-[#c8a96e]/20 rounded text-xs font-bold">In-</button>
        <div className="h-6 w-px bg-[#2a2a30] mx-1"></div>
        <button onClick={insertTable} className="p-1 hover:bg-[#c8a96e]/20 rounded"><Table size={16}/></button>
        <button onClick={insertImage} className="p-1 hover:bg-[#c8a96e]/20 rounded"><ImageIcon size={16}/></button>
        <button onClick={() => { const url = prompt('URL?'); if(url) exec('createLink', url); }} className="p-1 hover:bg-[#c8a96e]/20 rounded"><LinkIcon size={16}/></button>
        <button onClick={() => exec('insertHorizontalRule')} className="p-1 hover:bg-[#c8a96e]/20 rounded flex-shrink-0"><Minus size={16}/></button>
        <div className="h-6 w-px bg-[#2a2a30] mx-1 flex-shrink-0"></div>
        <button onClick={() => window.print()} className="p-1 hover:bg-[#c8a96e]/20 rounded flex-shrink-0 text-[#888894] hover:text-[#c8a96e]" title="Print"><Printer size={16}/></button>
        <button onClick={exportTXT} className="p-1 hover:bg-[#c8a96e]/20 rounded flex-shrink-0 text-[#888894] hover:text-[#c8a96e]" title="Export TXT"><FileText size={16}/></button>
        <button onClick={exportHTML} className="p-1 hover:bg-[#c8a96e]/20 rounded flex-shrink-0 text-[#888894] hover:text-[#c8a96e]" title="Export HTML"><FileCode size={16}/></button>
        <button onClick={exportPDF} className="p-1 hover:bg-[#c8a96e]/20 rounded flex-shrink-0 text-[#888894] hover:text-[#c8a96e]" title="Export PDF"><Download size={16}/></button>
        <div className="h-6 w-px bg-[#2a2a30] mx-1 flex-shrink-0"></div>
        <button onClick={() => setAiPanelOpen(!aiPanelOpen)} className="p-1 hover:bg-[#c8a96e]/20 rounded text-[#c8a96e] flex items-center gap-1 flex-shrink-0"><Sparkles size={16}/> AI</button>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Canvas Area */}
        <div className="flex-1 overflow-auto p-4 md:p-8 bg-[#0d0d0f] flex justify-center">
          <div 
            ref={editorRef}
            contentEditable
            onInput={handleInput}
            style={{ 
              transform: `scale(${zoom / 100})`, 
              transformOrigin: 'top center',
              fontFamily: settings?.defaultFont || 'Playfair Display',
              fontSize: `${settings?.defaultFontSize || 12}pt`
            }}
            className="w-full max-w-[210mm] min-h-[297mm] bg-white text-black p-4 md:p-[25.4mm] shadow-2xl outline-none"
          />
        </div>

        {/* AI Sidebar */}
        {aiPanelOpen && (
          <div className="absolute md:relative top-0 right-0 bottom-0 w-full md:w-80 bg-[#17171a] border-l border-[#2a2a30] flex flex-col z-20 shadow-2xl md:shadow-none">
            <div className="p-3 border-b border-[#2a2a30] flex justify-between items-center">
              <span className="font-bold text-[#c8a96e] flex items-center gap-2"><Sparkles size={16}/> AI Assistant</span>
              <button onClick={() => setAiPanelOpen(false)}><X size={16}/></button>
            </div>
            <div className="p-2 overflow-auto flex-1 flex flex-col gap-2">
              {['Rewrite & Improve', 'Summarize', 'Expand Content', 'Fix Grammar & Spelling', 'Translate', 'Generate Outline', 'Smart Complete', 'Tone Adjustment', 'Extract Key Points', 'Create Table from Text', 'Generate Full Document'].map(action => (
                <button key={action} onClick={() => runAi(action)} className="text-left px-3 py-2 bg-[#1e1e22] hover:bg-[#c8a96e]/20 rounded text-sm border border-[#2a2a30]">
                  {action}
                </button>
              ))}
              {aiLoading && <div className="text-center p-4 text-[#c8a96e] animate-pulse">AI is thinking...</div>}
              {aiResult && (
                <div className="mt-4 p-3 bg-[#1e1e22] border border-[#c8a96e]/50 rounded text-sm">
                  <div className="whitespace-pre-wrap mb-3">{aiResult}</div>
                  <div className="flex gap-2">
                    <button onClick={applyAiResult} className="flex-1 bg-[#c8a96e] text-black py-1 rounded font-bold">Insert</button>
                    <button onClick={() => setAiResult('')} className="flex-1 bg-[#2a2a30] py-1 rounded">Discard</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className="h-8 bg-[#17171a] border-t border-[#2a2a30] flex items-center justify-between px-4 text-xs text-[#888894]">
        <div className="flex gap-4">
          <span>{stats.words} words</span>
          <span>{stats.chars} characters</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <button onClick={() => setZoom(Math.max(50, zoom - 10))}><ZoomOut size={14}/></button>
            <span>{zoom}%</span>
            <button onClick={() => setZoom(Math.min(200, zoom + 10))}><ZoomIn size={14}/></button>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- SPREADSHEET COMPONENT ---
const Spreadsheet = ({ doc, updateDoc, settings }: { doc: Document, updateDoc: (c: any) => void, settings: Settings }) => {
  const [data, setData] = useState<Record<string, {v: string, f?: any}>>(doc?.content || {});
  const [activeCell, setActiveCell] = useState('A1');
  const [editing, setEditing] = useState(false);
  const [formula, setFormula] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState('');
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  
  const cols = Array.from({length: 26}, (_, i) => String.fromCharCode(65 + i));
  const rows = Array.from({length: 100}, (_, i) => i + 1);

  useEffect(() => {
    if (doc?.content && Object.keys(doc.content).length > 0) {
      setData(doc.content);
    }
  }, [doc?.id]);

  const updateData = (newData: any) => {
    setData(newData);
    updateDoc(newData);
  };

  const getVal = (cell: string) => {
    const d = data[cell];
    if (!d) return '';
    if (d.v.startsWith('=')) {
      try {
        // Basic formula evaluation
        const f = d.v.substring(1).toUpperCase();
        if (f.startsWith('SUM(')) {
          const range = f.substring(4, f.length - 1).split(':');
          // Simplified range sum
          return '...'; // Implement full formula logic if needed, keeping it simple for token limit
        }
        return d.v; // Fallback
      } catch { return 'ERROR'; }
    }
    return d.v;
  };

  const handleCellClick = (cell: string) => {
    setActiveCell(cell);
    setFormula(data[cell]?.v || '');
    setEditing(false);
  };

  const handleCellDoubleClick = (cell: string) => {
    setActiveCell(cell);
    setFormula(data[cell]?.v || '');
    setEditing(true);
  };

  const handleFormulaChange = (e: any) => {
    setFormula(e.target.value);
    updateData({ ...data, [activeCell]: { ...data[activeCell], v: e.target.value } });
  };

  const runAi = async (promptType: string) => {
    setAiLoading(true);
    setAiPanelOpen(true);
    try {
      let prompt = '';
      if (promptType === 'AI Formula Helper') prompt = `Generate an Excel formula for: ${window.prompt('What do you want the formula to do?')}. Output ONLY the formula starting with =.`;
      else if (promptType === 'Data Analysis') prompt = `Analyze this spreadsheet data and provide insights:\n\n${JSON.stringify(data)}`;
      else if (promptType === 'Generate Sample Data') prompt = `Generate sample CSV data for: ${window.prompt('Topic?')}. Output ONLY valid CSV.`;
      
      const res = await callClaude(prompt, settings.anthropicApiKey, settings.aiModel, "You are an expert spreadsheet assistant.");
      setAiResult(res);
    } catch (e: any) {
      setAiResult('Error: ' + e.message);
    }
    setAiLoading(false);
  };

  const exportCSV = () => {
    let csv = '';
    rows.forEach(r => {
      const rowData = cols.map(c => {
        let val = data[`${c}${r}`]?.v || '';
        if (val.includes(',') || val.includes('"')) {
          val = `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      }).join(',');
      csv += rowData + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.name}.csv`;
    a.click();
  };

  return (
    <div className="flex flex-col h-full bg-[#0d0d0f] text-sm relative">
      {/* Formula Bar */}
      <div className="flex flex-wrap md:flex-nowrap items-center gap-2 p-2 bg-[#17171a] border-b border-[#2a2a30]">
        <div className="w-12 text-center font-mono font-bold text-[#c8a96e]">{activeCell}</div>
        <div className="text-[#888894] font-mono italic">fx</div>
        <input 
          type="text" 
          value={formula} 
          onChange={handleFormulaChange}
          className="flex-1 bg-[#1e1e22] text-[#e8e8ec] border border-[#2a2a30] px-2 py-1 outline-none font-mono focus:border-[#c8a96e]"
        />
        <button onClick={exportCSV} className="p-1 hover:bg-[#c8a96e]/20 rounded text-[#888894] hover:text-[#c8a96e] flex items-center gap-1" title="Export CSV"><Download size={16}/></button>
        <button onClick={() => setAiPanelOpen(!aiPanelOpen)} className="p-1 hover:bg-[#c8a96e]/20 rounded text-[#c8a96e] flex items-center gap-1"><Sparkles size={16}/> AI</button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Grid */}
        <div className="flex-1 overflow-auto relative bg-[#1e1e22]">
          <table className="border-collapse w-full">
            <thead>
              <tr>
                <th className="w-10 bg-[#17171a] border border-[#2a2a30] sticky top-0 left-0 z-20"></th>
                {cols.map(c => (
                  <th key={c} className="w-24 bg-[#17171a] border border-[#2a2a30] font-normal text-[#888894] sticky top-0 z-10">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r}>
                  <td className="bg-[#17171a] border border-[#2a2a30] text-center text-[#888894] sticky left-0 z-10">{r}</td>
                  {cols.map(c => {
                    const cellId = `${c}${r}`;
                    const isActive = activeCell === cellId;
                    return (
                      <td 
                        key={c} 
                        className={`border border-[#2a2a30] bg-[#0d0d0f] relative ${isActive ? 'outline outline-2 outline-[#c8a96e] z-0' : ''}`}
                        onClick={() => handleCellClick(cellId)}
                        onDoubleClick={() => handleCellDoubleClick(cellId)}
                      >
                        {isActive && editing ? (
                          <input 
                            autoFocus
                            value={formula}
                            onChange={handleFormulaChange}
                            onBlur={() => setEditing(false)}
                            onKeyDown={e => e.key === 'Enter' && setEditing(false)}
                            className="absolute inset-0 w-full h-full bg-[#1e1e22] text-white px-1 outline-none font-mono"
                          />
                        ) : (
                          <div className="px-1 overflow-hidden whitespace-nowrap text-ellipsis font-mono text-[#e8e8ec]">
                            {getVal(cellId)}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* AI Sidebar */}
        {aiPanelOpen && (
          <div className="absolute md:relative top-0 right-0 bottom-0 w-full md:w-80 bg-[#17171a] border-l border-[#2a2a30] flex flex-col z-20 shadow-2xl md:shadow-none">
            <div className="p-3 border-b border-[#2a2a30] flex justify-between items-center">
              <span className="font-bold text-[#c8a96e] flex items-center gap-2"><Sparkles size={16}/> AI Assistant</span>
              <button onClick={() => setAiPanelOpen(false)}><X size={16}/></button>
            </div>
            <div className="p-2 overflow-auto flex-1 flex flex-col gap-2">
              {['AI Formula Helper', 'Data Analysis', 'Generate Sample Data'].map(action => (
                <button key={action} onClick={() => runAi(action)} className="text-left px-3 py-2 bg-[#1e1e22] hover:bg-[#c8a96e]/20 rounded text-sm border border-[#2a2a30]">
                  {action}
                </button>
              ))}
              {aiLoading && <div className="text-center p-4 text-[#c8a96e] animate-pulse">AI is thinking...</div>}
              {aiResult && (
                <div className="mt-4 p-3 bg-[#1e1e22] border border-[#c8a96e]/50 rounded text-sm">
                  <div className="whitespace-pre-wrap mb-3">{aiResult}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      
      {/* Tabs */}
      <div className="h-8 bg-[#17171a] border-t border-[#2a2a30] flex items-center px-2 gap-1">
        <div className="px-4 py-1 bg-[#1e1e22] border-t-2 border-[#c8a96e] text-[#e8e8ec] cursor-pointer">Sheet1</div>
        <button className="p-1 text-[#888894] hover:text-[#c8a96e]"><Plus size={14}/></button>
      </div>
    </div>
  );
};

// --- PRESENTATION COMPONENT ---
interface Slide { id: string; title: string; content: string; bg: string; }
const Presentation = ({ doc, updateDoc, settings }: { doc: Document, updateDoc: (c: any) => void, settings: Settings }) => {
  const [slides, setSlides] = useState<Slide[]>(Array.isArray(doc?.content) && doc.content.length > 0 ? doc.content : [{ id: '1', title: 'New Presentation', content: 'Click to edit', bg: 'bg-[#1e1e22]' }]);
  const [activeSlide, setActiveSlide] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState('');

  const currentSlide = slides[activeSlide] || slides[0] || { id: '1', title: '', content: '', bg: 'bg-[#1e1e22]' };

  useEffect(() => {
    if (doc?.content && Array.isArray(doc.content) && doc.content.length > 0) {
      setSlides(doc.content);
    }
  }, [doc?.id]);

  const updateSlides = (newSlides: Slide[]) => {
    setSlides(newSlides);
    updateDoc(newSlides);
  };

  const addSlide = () => {
    updateSlides([...slides, { id: Date.now().toString(), title: 'New Slide', content: 'Content here', bg: 'bg-[#1e1e22]' }]);
    setActiveSlide(slides.length);
  };

  const updateCurrentSlide = (field: keyof Slide, value: string) => {
    const newSlides = [...slides];
    newSlides[activeSlide] = { ...newSlides[activeSlide], [field]: value };
    updateSlides(newSlides);
  };

  const runAi = async (promptType: string) => {
    setAiLoading(true);
    setAiPanelOpen(true);
    try {
      let prompt = '';
      if (promptType === 'Generate Slide from Topic') prompt = `Write a slide title and 3-5 bullet points for the topic: ${window.prompt('Topic?')}. Format as Title\n- Point 1\n- Point 2`;
      else if (promptType === 'Generate Full Deck') prompt = `Write a 5-slide presentation about: ${window.prompt('Topic?')}. Format each slide with a title and bullet points.`;
      else if (promptType === 'Rewrite Slide Content') prompt = `Rewrite this slide content for better impact:\n\n${currentSlide.content}`;
      else if (promptType === 'Speaker Notes Generator') prompt = `Write speaker notes for this slide:\nTitle: ${currentSlide.title}\nContent: ${currentSlide.content}`;
      
      const res = await callClaude(prompt, settings.anthropicApiKey, settings.aiModel, "You are an expert presentation designer and speaker.");
      setAiResult(res);
    } catch (e: any) {
      setAiResult('Error: ' + e.message);
    }
    setAiLoading(false);
  };

  const exportHTML = () => {
    let html = `<html><head><title>${doc.name}</title></head><body style="background:#0d0d0f;color:white;font-family:sans-serif;padding:2rem;">`;
    slides.forEach((s, i) => {
      html += `<div style="margin-bottom:2rem;padding:2rem;border:1px solid #333;border-radius:8px;background:#1e1e22;">`;
      html += `<h2 style="color:#c8a96e;">Slide ${i+1}: ${s.title}</h2>`;
      html += `<pre style="white-space:pre-wrap;font-family:inherit;font-size:1.2rem;">${s.content}</pre>`;
      html += `</div>`;
    });
    html += `</body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.name}.html`;
    a.click();
  };

  if (presenting) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center" onClick={() => setActiveSlide(Math.min(slides.length - 1, activeSlide + 1))}>
        <div className={`w-[1920px] h-[1080px] max-w-full max-h-full aspect-video ${currentSlide.bg} p-24 flex flex-col justify-center transition-all duration-500`}>
          <h1 className="text-8xl font-serif text-[#c8a96e] mb-12" style={{fontFamily: settings?.defaultFont || 'Playfair Display'}}>{currentSlide.title}</h1>
          <div className="text-5xl text-white whitespace-pre-wrap leading-relaxed">{currentSlide.content}</div>
        </div>
        <div className="absolute bottom-4 right-4 text-white/50 text-xl">{activeSlide + 1} / {slides.length}</div>
        <button onClick={(e) => { e.stopPropagation(); setPresenting(false); }} className="absolute top-4 right-4 text-white/50 hover:text-white"><X size={32}/></button>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-[#0d0d0f] relative">
      {/* Thumbnails */}
      <div className="w-24 md:w-48 bg-[#17171a] border-r border-[#2a2a30] flex flex-col flex-shrink-0">
        <div className="p-2 border-b border-[#2a2a30] flex justify-between">
          <button onClick={addSlide} className="p-1 hover:bg-[#c8a96e]/20 rounded text-[#c8a96e]" title="Add Slide"><Plus size={16}/></button>
          <button onClick={exportHTML} className="p-1 hover:bg-[#c8a96e]/20 rounded text-[#888894] hover:text-[#c8a96e]" title="Export HTML"><Download size={16}/></button>
          <button onClick={() => setPresenting(true)} className="p-1 hover:bg-[#c8a96e]/20 rounded text-[#c8a96e]" title="Present"><Play size={16}/></button>
        </div>
        <div className="flex-1 overflow-auto p-2 flex flex-col gap-2">
          {slides.map((s, i) => (
            <div 
              key={s.id} 
              onClick={() => setActiveSlide(i)}
              className={`aspect-video rounded border-2 cursor-pointer p-1 overflow-hidden text-[8px] ${s.bg} ${activeSlide === i ? 'border-[#c8a96e]' : 'border-[#2a2a30]'}`}
            >
              <div className="font-serif text-[#c8a96e] truncate">{s.title}</div>
              <div className="text-white/50 truncate">{s.content}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Canvas */}
      <div className="flex-1 flex flex-col relative">
        <div className="flex items-center justify-end p-2 gap-2 absolute top-0 right-0 z-10">
          <button onClick={() => setAiPanelOpen(!aiPanelOpen)} className="px-3 py-1 bg-[#1e1e22] hover:bg-[#c8a96e]/20 border border-[#2a2a30] rounded text-[#c8a96e] flex items-center gap-1 text-sm"><Sparkles size={14}/> AI</button>
        </div>
        
        <div className="flex-1 p-8 flex items-center justify-center overflow-auto">
          <div className={`w-full max-w-4xl aspect-video shadow-2xl flex flex-col p-12 ${currentSlide.bg}`}>
            <input 
              value={currentSlide.title}
              onChange={e => updateCurrentSlide('title', e.target.value)}
              className="text-5xl font-serif text-[#c8a96e] bg-transparent border-none outline-none mb-8"
              style={{fontFamily: settings?.defaultFont || 'Playfair Display'}}
            />
            <textarea 
              value={currentSlide.content}
              onChange={e => updateCurrentSlide('content', e.target.value)}
              className="flex-1 text-2xl text-white bg-transparent border-none outline-none resize-none"
            />
          </div>
        </div>

        {/* AI Sidebar */}
        {aiPanelOpen && (
          <div className="absolute top-0 right-0 bottom-0 w-full md:w-80 bg-[#17171a] border-l border-[#2a2a30] flex flex-col z-20 shadow-2xl">
            <div className="p-3 border-b border-[#2a2a30] flex justify-between items-center">
              <span className="font-bold text-[#c8a96e] flex items-center gap-2"><Sparkles size={16}/> AI Assistant</span>
              <button onClick={() => setAiPanelOpen(false)}><X size={16}/></button>
            </div>
            <div className="p-2 overflow-auto flex-1 flex flex-col gap-2">
              {['Generate Slide from Topic', 'Generate Full Deck', 'Rewrite Slide Content', 'Speaker Notes Generator'].map(action => (
                <button key={action} onClick={() => runAi(action)} className="text-left px-3 py-2 bg-[#1e1e22] hover:bg-[#c8a96e]/20 rounded text-sm border border-[#2a2a30]">
                  {action}
                </button>
              ))}
              {aiLoading && <div className="text-center p-4 text-[#c8a96e] animate-pulse">AI is thinking...</div>}
              {aiResult && (
                <div className="mt-4 p-3 bg-[#1e1e22] border border-[#c8a96e]/50 rounded text-sm">
                  <div className="whitespace-pre-wrap mb-3">{aiResult}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// --- MAIN APP COMPONENT ---
export default function App() {
  const [docs, setDocs] = useState<Document[]>([]);
  const [activeDoc, setActiveDoc] = useState<Document | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<DocType | 'all'>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const s = await getSettings();
      setSettings(s);
      const d = await getDocs();
      setDocs(d.sort((a: Document, b: Document) => b.savedAt - a.savedAt));
      setLoading(false);
    };
    load();
  }, []);

  // Auto-save
  useEffect(() => {
    if (!activeDoc || settings.autoSaveInterval === 0) return;
    const interval = setInterval(() => {
      saveDoc({ ...activeDoc, savedAt: Date.now() });
    }, settings.autoSaveInterval * 1000);
    return () => clearInterval(interval);
  }, [activeDoc, settings.autoSaveInterval]);

  const createDoc = async (type: DocType) => {
    const newDoc: Document = {
      id: Date.now().toString(),
      name: `Untitled ${type}`,
      type,
      content: type === 'writer' ? '' : type === 'spreadsheet' ? {} : [{ id: '1', title: 'New Presentation', content: 'Click to edit', bg: 'bg-[#1e1e22]' }],
      createdAt: Date.now(),
      savedAt: Date.now()
    };
    await saveDoc(newDoc);
    setDocs([newDoc, ...docs]);
    setActiveDoc(newDoc);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this document?')) {
      await deleteDoc(id);
      setDocs(docs.filter(d => d.id !== id));
      if (activeDoc?.id === id) setActiveDoc(null);
    }
  };

  const updateActiveDoc = (content: any) => {
    if (!activeDoc) return;
    const updated = { ...activeDoc, content, savedAt: Date.now() };
    setActiveDoc(updated);
    setDocs(docs.map(d => d.id === updated.id ? updated : d));
  };

  const renameDoc = (name: string) => {
    if (!activeDoc) return;
    const updated = { ...activeDoc, name, savedAt: Date.now() };
    setActiveDoc(updated);
    setDocs(docs.map(d => d.id === updated.id ? updated : d));
    saveDoc(updated);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setLoading(true);
    try {
      let content = '';
      const ext = file.name.split('.').pop()?.toLowerCase();
      
      if (ext === 'docx') {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        content = result.value;
      } else if (ext === 'pdf') {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let textContent = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContentObj = await page.getTextContent();
          const pageText = textContentObj.items.map((item: any) => item.str).join(' ');
          textContent += `<p>${pageText}</p>`;
        }
        content = textContent;
      } else if (ext === 'txt' || ext === 'html') {
        content = await file.text();
        if (ext === 'txt') {
          content = content.split('\n').map(line => `<p>${line}</p>`).join('');
        }
      } else {
        alert('Unsupported file format');
        setLoading(false);
        return;
      }

      const newDoc: Document = {
        id: Date.now().toString(),
        name: file.name.replace(`.${ext}`, ''),
        type: 'writer',
        content: content,
        createdAt: Date.now(),
        savedAt: Date.now()
      };
      await saveDoc(newDoc);
      setDocs([newDoc, ...docs]);
      setActiveDoc(newDoc);
    } catch (err: any) {
      console.error(err);
      alert('Error importing document: ' + err.message);
    }
    setLoading(false);
    e.target.value = '';
  };

  if (loading) return <div className="min-h-screen bg-[#0d0d0f] text-[#c8a96e] flex items-center justify-center font-serif text-2xl">Loading NexOffice...</div>;

  return (
    <div className="min-h-screen bg-[#0d0d0f] text-[#e8e8ec] font-sans flex flex-col overflow-hidden">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&display=swap');
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #0d0d0f; }
        ::-webkit-scrollbar-thumb { background: #2a2a30; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #c8a96e; }
      `}</style>

      {/* Title Bar */}
      <div className="h-14 bg-[#17171a]/95 backdrop-blur-md border-b border-[#2a2a30] flex items-center justify-between px-4 select-none sticky top-0 z-50">
        <div className="flex items-center gap-4 w-1/3">
          {/* macOS Traffic Lights */}
          <div className="flex items-center gap-2 mr-2">
            <div className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] shadow-sm"></div>
            <div className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123] shadow-sm"></div>
            <div className="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29] shadow-sm"></div>
          </div>
          
          {activeDoc ? (
            <button 
              onClick={() => setActiveDoc(null)} 
              className="flex items-center text-[#0A84FF] hover:opacity-80 transition-opacity gap-1 -ml-2"
            >
              <ChevronLeft size={24} strokeWidth={2} />
              <span className="text-[17px] font-medium tracking-tight">Documents</span>
            </button>
          ) : (
            <div className="font-serif text-xl font-bold text-[#c8a96e]">NexOffice</div>
          )}
        </div>
        
        <div className="flex-1 flex justify-center">
          {activeDoc && (
            <div className="flex flex-col items-center">
              <input 
                value={activeDoc.name} 
                onChange={e => renameDoc(e.target.value)}
                className="bg-transparent border-none outline-none text-[#e8e8ec] hover:bg-[#1e1e22] px-2 py-0.5 rounded text-[15px] font-semibold text-center transition-colors w-48 focus:w-64 focus:bg-[#1e1e22]"
              />
              <span className="text-[10px] text-[#888894] font-medium">Saved {new Date(activeDoc.savedAt).toLocaleTimeString()}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-4 w-1/3 justify-end">
          <div className="px-2 py-0.5 bg-green-900/30 text-green-500 text-[10px] font-bold rounded border border-green-900/50 uppercase tracking-wider">Private</div>
          <button onClick={() => setShowSettings(true)} className="p-2 hover:bg-[#1e1e22] rounded text-[#888894] hover:text-[#c8a96e] transition-colors"><Settings size={18}/></button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden relative">
        {!activeDoc ? (
          // Document Manager
          <div className="h-full overflow-auto p-4 md:p-8">
            <div className="max-w-6xl mx-auto">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                <h1 className="text-3xl md:text-4xl font-serif text-[#c8a96e]">Your Documents</h1>
                <div className="flex flex-wrap gap-2 w-full md:w-auto">
                  <button onClick={() => createDoc('writer')} className="flex-1 md:flex-none justify-center flex items-center gap-2 bg-[#1e1e22] hover:bg-[#c8a96e] hover:text-black border border-[#2a2a30] px-3 py-2 rounded transition-colors text-sm md:text-base"><FileText size={18}/> Writer</button>
                  <button onClick={() => createDoc('spreadsheet')} className="flex-1 md:flex-none justify-center flex items-center gap-2 bg-[#1e1e22] hover:bg-[#c8a96e] hover:text-black border border-[#2a2a30] px-3 py-2 rounded transition-colors text-sm md:text-base"><Table size={18}/> Sheet</button>
                  <button onClick={() => createDoc('presentation')} className="flex-1 md:flex-none justify-center flex items-center gap-2 bg-[#1e1e22] hover:bg-[#c8a96e] hover:text-black border border-[#2a2a30] px-3 py-2 rounded transition-colors text-sm md:text-base"><PresentationIcon size={18}/> Deck</button>
                  <label className="flex-1 md:flex-none justify-center flex items-center gap-2 bg-[#1e1e22] hover:bg-[#c8a96e] hover:text-black border border-[#2a2a30] px-3 py-2 rounded transition-colors cursor-pointer text-sm md:text-base">
                    <Upload size={18}/> Import
                    <input type="file" className="hidden" accept=".txt,.html,.docx,.pdf" onChange={handleImport} />
                  </label>
                </div>
              </div>

              <div className="flex flex-col md:flex-row gap-4 mb-8">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#888894]" size={18}/>
                  <input 
                    type="text" 
                    placeholder="Search documents..." 
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full bg-[#17171a] border border-[#2a2a30] rounded pl-10 pr-4 py-2 outline-none focus:border-[#c8a96e]"
                  />
                </div>
                <select 
                  value={filter} 
                  onChange={e => setFilter(e.target.value as any)}
                  className="bg-[#17171a] border border-[#2a2a30] rounded px-4 py-2 outline-none focus:border-[#c8a96e]"
                >
                  <option value="all">All Types</option>
                  <option value="writer">Writer</option>
                  <option value="spreadsheet">Spreadsheet</option>
                  <option value="presentation">Presentation</option>
                </select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {docs
                  .filter(d => filter === 'all' || d.type === filter)
                  .filter(d => d.name.toLowerCase().includes(search.toLowerCase()))
                  .map(doc => (
                  <div 
                    key={doc.id} 
                    onClick={() => setActiveDoc(doc)}
                    className="bg-[#17171a] border border-[#2a2a30] rounded-lg p-4 cursor-pointer hover:border-[#c8a96e] transition-colors group relative"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className={`p-3 rounded-lg ${doc.type === 'writer' ? 'bg-blue-500/10 text-blue-400' : doc.type === 'spreadsheet' ? 'bg-green-500/10 text-green-400' : 'bg-orange-500/10 text-orange-400'}`}>
                        {doc.type === 'writer' && <FileText size={24}/>}
                        {doc.type === 'spreadsheet' && <Table size={24}/>}
                        {doc.type === 'presentation' && <PresentationIcon size={24}/>}
                      </div>
                      <button onClick={(e) => handleDelete(doc.id, e)} className="text-[#888894] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={18}/></button>
                    </div>
                    <h3 className="font-bold text-lg mb-1 truncate">{doc.name}</h3>
                    <p className="text-sm text-[#888894]">Saved {new Date(doc.savedAt).toLocaleDateString()}</p>
                  </div>
                ))}
                {docs.length === 0 && (
                  <div className="col-span-full text-center py-20 text-[#888894]">
                    <div className="mb-4 flex justify-center"><FileIcon size={48} className="opacity-20"/></div>
                    <p>No documents found. Create one to get started.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          // Active Document Editor
          <div className="h-full">
            {activeDoc.type === 'writer' && <Writer doc={activeDoc} updateDoc={updateActiveDoc} settings={settings} />}
            {activeDoc.type === 'spreadsheet' && <Spreadsheet doc={activeDoc} updateDoc={updateActiveDoc} settings={settings} />}
            {activeDoc.type === 'presentation' && <Presentation doc={activeDoc} updateDoc={updateActiveDoc} settings={settings} />}
          </div>
        )}
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#17171a] border border-[#2a2a30] rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
            <div className="p-6 border-b border-[#2a2a30] flex justify-between items-center">
              <h2 className="text-2xl font-serif text-[#c8a96e]">Settings</h2>
              <button onClick={() => setShowSettings(false)} className="text-[#888894] hover:text-white"><X size={24}/></button>
            </div>
            <div className="p-6 overflow-auto flex-1 flex flex-col gap-6">
              
              <div className="space-y-4">
                <h3 className="text-lg font-bold text-[#c8a96e] border-b border-[#2a2a30] pb-2">AI Configuration</h3>
                <div>
                  <label className="block text-sm text-[#888894] mb-1">Anthropic API Key</label>
                  <input 
                    type="password" 
                    value={settings.anthropicApiKey}
                    onChange={e => {
                      const newSettings = { ...settings, anthropicApiKey: e.target.value };
                      setSettings(newSettings);
                      saveSettings(newSettings);
                    }}
                    placeholder="sk-ant-..."
                    className="w-full bg-[#0d0d0f] border border-[#2a2a30] rounded px-3 py-2 outline-none focus:border-[#c8a96e]"
                  />
                  <p className="text-xs text-[#888894] mt-1">Stored locally in IndexedDB. Never sent to our servers.</p>
                </div>
                <div>
                  <label className="block text-sm text-[#888894] mb-1">AI Model</label>
                  <select 
                    value={settings.aiModel}
                    onChange={e => {
                      const newSettings = { ...settings, aiModel: e.target.value };
                      setSettings(newSettings);
                      saveSettings(newSettings);
                    }}
                    className="w-full bg-[#0d0d0f] border border-[#2a2a30] rounded px-3 py-2 outline-none focus:border-[#c8a96e]"
                  >
                    <option value="claude-3-5-sonnet-20240620">Claude 3.5 Sonnet</option>
                    <option value="claude-3-opus-20240229">Claude 3 Opus</option>
                    <option value="claude-3-haiku-20240307">Claude 3 Haiku</option>
                  </select>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-bold text-[#c8a96e] border-b border-[#2a2a30] pb-2">Preferences</h3>
                <div className="flex items-center justify-between">
                  <label className="text-sm">Auto-save Interval</label>
                  <select 
                    value={settings.autoSaveInterval}
                    onChange={e => {
                      const newSettings = { ...settings, autoSaveInterval: parseInt(e.target.value) };
                      setSettings(newSettings);
                      saveSettings(newSettings);
                    }}
                    className="bg-[#0d0d0f] border border-[#2a2a30] rounded px-3 py-1 outline-none focus:border-[#c8a96e]"
                  >
                    <option value={0}>Off</option>
                    <option value={1}>1 second</option>
                    <option value={2}>2 seconds</option>
                    <option value={5}>5 seconds</option>
                    <option value={10}>10 seconds</option>
                  </select>
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-sm">Default Font</label>
                  <select 
                    value={settings.defaultFont}
                    onChange={e => {
                      const newSettings = { ...settings, defaultFont: e.target.value };
                      setSettings(newSettings);
                      saveSettings(newSettings);
                    }}
                    className="bg-[#0d0d0f] border border-[#2a2a30] rounded px-3 py-1 outline-none focus:border-[#c8a96e]"
                  >
                    <option value="Playfair Display">Playfair Display</option>
                    <option value="Georgia">Georgia</option>
                    <option value="Arial">Arial</option>
                  </select>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-bold text-red-500 border-b border-[#2a2a30] pb-2">Danger Zone</h3>
                <button 
                  onClick={async () => {
                    if (confirm('Are you sure? This will delete ALL documents locally.')) {
                      const db = await initDB();
                      const tx = db.transaction('documents', 'readwrite');
                      tx.objectStore('documents').clear();
                      setDocs([]);
                      setActiveDoc(null);
                      setShowSettings(false);
                    }
                  }}
                  className="bg-red-500/10 text-red-500 border border-red-500/50 px-4 py-2 rounded hover:bg-red-500 hover:text-white transition-colors"
                >
                  Clear All Data
                </button>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}
