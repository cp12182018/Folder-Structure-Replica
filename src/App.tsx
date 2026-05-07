/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState } from 'react';
import JSZip from 'jszip';
import { Upload, Download, Folder, FolderOpen, AlertCircle, ChevronRight, ChevronDown, Copy } from 'lucide-react';

export interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
}

const TreeView: React.FC<{ node: TreeNode, level?: number }> = ({ node, level = 0 }) => {
  const [isOpen, setIsOpen] = useState(level < 2);
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div className={level > 0 ? "tree-line font-mono" : "font-mono"}>
      <div 
        className={`flex items-center gap-2 mb-2 cursor-pointer transition-colors select-none ${level === 0 ? 'text-white' : 'text-slate-400 hover:text-slate-200'}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? (
          <FolderOpen size={16} className={level === 0 ? 'text-blue-400' : 'text-blue-400/60'} />
        ) : (
          <Folder size={16} className={level === 0 ? 'text-blue-400' : 'text-blue-400/60'} />
        )}
        <span>{node.name}</span>
        {level === 0 && <span className="text-xs text-slate-600 font-sans ml-1">/ root</span>}
      </div>
      
      {hasChildren && isOpen && (
        <div className="flex flex-col">
          {node.children.map((child, idx) => (
            <TreeView key={`${child.path}-${idx}`} node={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

export default function App() {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maxDepth, setMaxDepth] = useState<number | ''>('');

  const resetState = () => {
    setTree(null);
    setError(null);
  };

  // 1: File API recursive scanning
  const scanDirHandle = async (dirHandle: any, currentPath: string, currentDepth: number): Promise<TreeNode> => {
    const node: TreeNode = {
      name: dirHandle.name,
      path: currentPath ? `${currentPath}/${dirHandle.name}` : dirHandle.name,
      children: [],
    };
    
    const depthLimit = typeof maxDepth === 'number' ? maxDepth : Infinity;

    if (currentDepth < depthLimit) {
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'directory') {
          node.children.push(await scanDirHandle(entry, node.path, currentDepth + 1));
        }
      }
      node.children.sort((a, b) => a.name.localeCompare(b.name));
    }
    return node;
  };

  const handleDirectoryPicker = async () => {
    try {
      resetState();
      if (!('showDirectoryPicker' in window)) {
        throw new Error('File System Access API not supported in this browser. Try dragging and dropping the folder instead.');
      }
      
      const dirHandle = await (window as any).showDirectoryPicker();
      setIsScanning(true);
      const rootNode = await scanDirHandle(dirHandle, '', 0);
      setTree(rootNode);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        if (err.name === 'SecurityError' || err.message?.includes('Cross origin') || err.message?.includes('showDirectoryPicker')) {
          setError("The modern File Picker is blocked inside preview iframes. Please open the app in a new tab (using the button in the top right), or use the Drag & Drop zone below which works perfectly here.");
        } else {
          setError(err.message || 'Failed to read directory.');
        }
      }
    } finally {
      setIsScanning(false);
    }
  };

  // 2: Drag & Drop recursive scanning
  const scanDropEntry = async (entry: any, currentPath: string, currentDepth: number): Promise<TreeNode | null> => {
    if (entry.isDirectory) {
      const node: TreeNode = {
        name: entry.name,
        path: currentPath ? `${currentPath}/${entry.name}` : entry.name,
        children: [],
      };
      
      const depthLimit = typeof maxDepth === 'number' ? maxDepth : Infinity;

      if (currentDepth < depthLimit) {
        const dirReader = entry.createReader();
        const readAllEntries = async () => {
          let entries: any[] = [];
          let hasMore = true;
          while (hasMore) {
            const batch = await new Promise<any[]>((resolve, reject) => {
              dirReader.readEntries(resolve, reject);
            });
            if (batch.length === 0) {
              hasMore = false;
            } else {
              entries.push(...batch);
            }
          }
          return entries;
        };

        const entries = await readAllEntries();
        for (const child of entries) {
          if (child.isDirectory) {
            const childNode = await scanDropEntry(child, node.path, currentDepth + 1);
            if (childNode) node.children.push(childNode);
          }
        }
        node.children.sort((a, b) => a.name.localeCompare(b.name));
      }
      return node;
    }
    return null;
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    resetState();
    
    const items = e.dataTransfer.items;
    if (!items || items.length === 0) return;

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
            const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : (item as any).getAsEntry();
            if (entry && entry.isDirectory) {
               setIsScanning(true);
               try {
                   const rootNode = await scanDropEntry(entry, '', 0);
                   if (rootNode) setTree(rootNode);
               } catch (err: any) {
                   setError(err.message || 'Error parsing dropped folder.');
               } finally {
                   setIsScanning(false);
               }
               return; // Only process the first folder dropped
            } else if (entry && entry.isFile) {
               setError("Please drop a folder, not a file.");
               return;
            }
        }
    }
  };

  const handleExport = async () => {
    if (!tree) return;
    try {
      const zip = new JSZip();
      
      const addNodeToZip = (node: TreeNode, parentFolder: JSZip) => {
        const folder = parentFolder.folder(node.name);
        if (folder) {
          for (const child of node.children) {
            addNodeToZip(child, folder);
          }
        }
      };
      
      addNodeToZip(tree, zip);
      
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${tree.name}_structure.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch(err: any) {
        setError('Failed to generate ZIP: ' + err.message);
    }
  };

  const countFolders = (node: TreeNode): number => {
    return 1 + node.children.reduce((acc, child) => acc + countFolders(child), 0);
  };
  
  const totalFolders = tree ? countFolders(tree) : 0;

  return (
    <div className="h-screen w-full flex flex-col gap-4 p-6 box-border font-sans">
      <header className="flex flex-col sm:flex-row justify-between sm:items-end gap-4 pb-2 border-b border-[#30363D] shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Copy className="w-6 h-6 text-blue-500" />
            Folder Structure Replicator
            <span className="text-xs font-mono bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded border border-blue-500/20 ml-2">
              v1.0.4-client
            </span>
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Offline-first recursive structure cloning via File System Access API
          </p>
        </div>
        <div className="flex gap-6 text-xs font-mono">
          <div className="text-right">
            <div className="text-slate-500 uppercase">Status</div>
            <div className={isScanning ? "text-blue-400" : "text-green-400"}>
              ● {isScanning ? "SCANNING" : "ACTIVE / IDLE"}
            </div>
          </div>
          <div className="text-right hidden sm:block">
            <div className="text-slate-500 uppercase">Last Scan</div>
            <div className="text-white">{totalFolders > 0 ? `${totalFolders} nodes` : "N/A"}</div>
          </div>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 h-full min-h-0 overflow-hidden">
        <aside className="col-span-1 lg:col-span-4 flex flex-col gap-4 overflow-y-auto lg:overflow-hidden pb-4 lg:pb-0 scrollbar-hide">
          <div className="bento-card p-5 flex flex-col shrink-0">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">
              1. Source Input
            </h3>
            <button 
              onClick={handleDirectoryPicker}
              className={`w-full py-6 border-2 border-dashed border-[#30363D] rounded-lg hover:bg-slate-800/30 flex flex-col items-center justify-center gap-2 group transition-all ${isScanning ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <div className="w-10 h-10 bg-[#161B22] rounded-full flex items-center justify-center group-hover:bg-blue-500/20 transition-all">
                <FolderOpen className="w-5 h-5 text-blue-500" />
              </div>
              <span className="text-sm font-medium text-white">Open Directory Picker</span>
              <span className="text-[10px] text-slate-500 font-mono text-center px-4">
                window.showDirectoryPicker()<br />
                <span className="text-yellow-500/70 block mt-1">(Requires opening app in new tab)</span>
              </span>
            </button>
            <div 
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`mt-4 p-4 border rounded-lg flex items-center gap-3 transition-colors ${dragOver ? 'bg-blue-500/10 border-blue-500/50' : 'bg-[#161B22] border-[#30363D]'} ${isScanning ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <div className="w-8 h-8 flex-shrink-0 bg-slate-800 rounded flex items-center justify-center">
                <Upload className="w-4 h-4 text-slate-400" />
              </div>
              <div>
                <div className="text-xs font-bold text-white">Drag & Drop Zone</div>
                <div className="text-[10px] text-slate-500">Recursive drop supported</div>
              </div>
            </div>
            
            {error && (
               <div className="mt-4 border border-red-500/20 bg-red-500/5 rounded-lg p-3 flex gap-2 text-red-400">
                 <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                 <p className="text-xs leading-relaxed">{error}</p>
               </div>
            )}
          </div>

          <div className="bento-card p-5 shrink-0">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">
              2. Scan Logic
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-300">Recursive Depth</span>
                <input 
                  type="number" 
                  min="0"
                  placeholder="Unlimited"
                  value={maxDepth}
                  onChange={(e) => {
                    const val = e.target.value;
                    setMaxDepth(val === '' ? '' : parseInt(val, 10));
                    setTree(null); // Reset tree on depth change so they rescan
                  }}
                  className="w-24 bg-[#161B22] border border-[#30363D] rounded px-2 py-1 text-xs font-mono text-blue-400 font-bold focus:outline-none focus:border-blue-500 text-right placeholder:text-blue-400/50"
                  disabled={isScanning}
                />
              </div>
              <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 w-full opacity-50"></div>
              </div>
              <div className="flex items-center gap-3 mt-4">
                <input type="checkbox" checked readOnly className="accent-blue-500 w-4 h-4 rounded border-slate-700 bg-slate-900"/>
                <label className="text-xs text-slate-300">Preserve Empty Directories</label>
              </div>
              <div className="flex items-center gap-3">
                <input type="checkbox" readOnly className="accent-blue-500 w-4 h-4 rounded border-slate-700 bg-slate-900 opacity-50"/>
                <label className="text-xs text-slate-500">Include Hidden Folders (.git, etc) - N/A</label>
              </div>
            </div>
          </div>

          <div className="bento-card p-5 bg-blue-500/5 border-blue-500/30 flex flex-col justify-between shrink-0">
            <div>
              <h3 className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-4">
                3. Export
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed mb-4">
                Generates a JSZip object containing the empty directory tree. No file content is read or exported.
              </p>
            </div>
            <button 
              onClick={handleExport}
              disabled={!tree || isScanning}
              className={`w-full py-3 rounded-lg font-bold text-sm flex items-center justify-center gap-2 shadow-lg transition-all ${tree && !isScanning ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/20 active:scale-95' : 'bg-[#1a1a1a] text-slate-500 shadow-none cursor-not-allowed'}`}
            >
              Download Replicated ZIP <Download className="w-4 h-4" />
            </button>
          </div>
        </aside>

        <section className="col-span-1 lg:col-span-8 flex flex-col gap-4 h-full min-h-0 overflow-hidden">
          <div className="bento-card flex flex-col h-full overflow-hidden">
            <div className="p-4 border-b border-[#30363D] flex justify-between items-center bg-[#0D1117] shrink-0">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${isScanning ? 'bg-blue-500 animate-pulse' : (tree ? 'bg-green-500' : 'bg-slate-500')}`}></div>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                  Visual Tree Preview
                </h3>
              </div>
              <div className="text-[10px] font-mono text-slate-500 truncate max-w-[200px] hidden sm:block">
                {tree ? tree.name : ""}
              </div>
            </div>
            
            <div className="flex-1 p-6 font-mono text-sm scrollbar-hide overflow-y-auto w-full relative">
              {!tree && !isScanning && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 opacity-50">
                   <FolderOpen size={48} className="mb-4 text-slate-600" />
                   <p className="uppercase tracking-widest text-xs font-bold">Awaiting Input</p>
                </div>
              )}
              {isScanning && (
                 <div className="absolute inset-0 flex flex-col items-center justify-center text-blue-500">
                    <div className="w-8 h-8 rounded-full border-2 border-blue-500/20 border-t-blue-500 animate-spin mb-4" />
                    <p className="uppercase tracking-widest text-xs font-bold">Scanning...</p>
                 </div>
              )}
              {tree && (
                <div className="max-w-4xl min-w-max pb-12">
                  <TreeView node={tree} />
                </div>
              )}
            </div>

            <div className="p-3 bg-black/40 border-t border-[#30363D] flex justify-between items-center px-6 shrink-0">
              <div className="flex gap-4 text-[10px] font-mono text-slate-500 uppercase tracking-widest font-bold">
                <span>Folders: {totalFolders}</span>
                <span>Max Depth: ~</span>
                <span>Size: 0.0 KB</span>
              </div>
              <div className="text-[10px] text-blue-400 italic font-mono hidden sm:block">
                Auto-updates as structure changes
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
