/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState } from 'react';
import JSZip from 'jszip';
import { Upload, Download, Folder, FolderOpen, AlertCircle, ChevronRight, ChevronDown, Copy, Settings, HardDrive, Files, RefreshCw } from 'lucide-react';

export interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
}

const TreeView: React.FC<{ node: TreeNode, level?: number }> = ({ node, level = 0 }) => {
  const [isOpen, setIsOpen] = useState(level < 2);
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div className="font-mono text-[13px] leading-6">
      <div 
        className={`flex items-center gap-2 cursor-pointer select-none group w-fit py-0.5 pr-2 rounded transition-colors
          ${level === 0 ? 'text-[#ededed] font-medium' : 'text-[#a1a1aa] hover:text-[#ededed]'}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className={`flex items-center justify-center w-4 h-4 transition-colors ${level === 0 ? 'text-indigo-400' : 'text-[#71717a] group-hover:text-[#a1a1aa]'}`}>
          {hasChildren ? (
            isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          ) : (
            <span className="w-1 h-1 rounded-full bg-[#52525b]" />
          )}
        </span>
        <span className={`${level === 0 ? 'text-indigo-400' : 'text-[#71717a] group-hover:text-[#a1a1aa]'}`}>
          {isOpen ? <FolderOpen size={14} /> : <Folder size={14} />}
        </span>
        <span>{node.name}</span>
      </div>
      
      {hasChildren && isOpen && (
        <div className="ml-2 pl-4 border-l border-[#262626]">
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
  const scanDirHandle = async (dirHandle: any, currentPath: string): Promise<TreeNode> => {
    const node: TreeNode = {
      name: dirHandle.name,
      path: currentPath ? `${currentPath}/${dirHandle.name}` : dirHandle.name,
      children: [],
    };
    
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'directory') {
        node.children.push(await scanDirHandle(entry, node.path));
      }
    }
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    
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
      const rootNode = await scanDirHandle(dirHandle, '');
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
  const scanDropEntry = async (entry: any, currentPath: string): Promise<TreeNode | null> => {
    if (entry.isDirectory) {
      const node: TreeNode = {
        name: entry.name,
        path: currentPath ? `${currentPath}/${entry.name}` : entry.name,
        children: [],
      };
      
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
          const childNode = await scanDropEntry(child, node.path);
          if (childNode) node.children.push(childNode);
        }
      }
      node.children.sort((a, b) => a.name.localeCompare(b.name));
      
      return node;
    }
    return null;
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    resetState();
    
    // Check if dropping on the window works correctly
    const items = e.dataTransfer.items;
    if (!items || items.length === 0) return;

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
            const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : (item as any).getAsEntry();
            if (entry && entry.isDirectory) {
               setIsScanning(true);
               try {
                   const rootNode = await scanDropEntry(entry, '');
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

  const getPrunedTree = (node: TreeNode, currentDepth: number, depthLimit: number): TreeNode => {
    if (currentDepth >= depthLimit) {
      return { ...node, children: [] };
    }
    return {
      ...node,
      children: node.children.map(child => getPrunedTree(child, currentDepth + 1, depthLimit))
    };
  };

  const displayTree = tree && typeof maxDepth === 'number' ? getPrunedTree(tree, 0, maxDepth) : tree;

  const handleExport = async () => {
    if (!displayTree) return;
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
      
      addNodeToZip(displayTree, zip);
      
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
  
  const totalFolders = displayTree ? countFolders(displayTree) : 0;

  return (
    <div 
      className="flex h-screen w-full bg-[#050505] text-[#ededed] font-sans overflow-hidden"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={(e) => {
        // Only reset if dragging leaves the window
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setDragOver(false);
        }
      }}
      onDrop={handleDrop}
    >
      {/* Sidebar */}
      <div className="w-full sm:w-[340px] flex-shrink-0 border-r border-[#262626] bg-[#0a0a0a] flex flex-col pt-4 z-20">
        {/* Header */}
        <div className="px-6 pb-6 border-b border-[#262626]">
           <div className="flex items-center gap-2 mb-1">
              <FolderOpen size={20} className="text-indigo-400" />
              <h1 className="font-semibold text-white tracking-tight">StructClone</h1>
           </div>
           <p className="text-xs text-[#a1a1aa] leading-relaxed">
             Replicate directory structures without files.
           </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-hide">
          {/* 1. Source */}
          <section>
            <h2 className="text-[11px] font-semibold text-[#71717a] uppercase tracking-wider mb-3 flex items-center gap-2">
               <HardDrive size={12} /> Input Source
            </h2>
            
            <div 
              className={`relative overflow-hidden border rounded-xl p-6 flex flex-col items-center justify-center gap-3 transition-all cursor-pointer
                ${dragOver ? 'border-indigo-500/50 bg-indigo-500/10' : 'border-[#262626] bg-[#121212] hover:bg-[#1a1a1a]'} 
                ${isScanning ? 'opacity-50 pointer-events-none' : ''}`}
              onClick={() => {
                // Clicking the drag/drop zone also triggers picker if they want
                // Better UX than just doing nothing
                handleDirectoryPicker();
              }}
            >
               <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${dragOver ? 'bg-indigo-500/20 text-indigo-400' : 'bg-[#262626] text-[#a1a1aa]'}`}>
                 <Upload size={20} />
               </div>
               <div className="text-center pointer-events-none">
                 <div className="text-sm font-medium text-[#ededed] mb-1">Drag & drop folder</div>
                 <div className="text-xs text-[#71717a]">or click to browse</div>
               </div>
            </div>

            <p className="text-[10px] text-[#71717a] text-center mt-3 px-2 leading-tight">
               File Picker API behaves best when opened in a new tab.
            </p>

            {error && (
               <div className="mt-4 border border-red-900/30 bg-red-900/10 rounded-lg p-3 flex items-start gap-2 text-red-400">
                 <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                 <p className="text-xs leading-relaxed">{error}</p>
               </div>
            )}
          </section>

          {/* 2. Options */}
          <section>
            <h2 className="text-[11px] font-semibold text-[#71717a] uppercase tracking-wider mb-3 flex items-center gap-2">
               <Settings size={12} /> Configuration
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="flex items-center justify-between text-sm text-[#ededed] mb-1.5">
                  <span>Max Depth</span>
                  <span className="text-xs text-[#71717a] font-mono">{maxDepth === '' ? 'Unlimited' : maxDepth}</span>
                </label>
                <input 
                  type="number" 
                  min="0"
                  placeholder="Leave empty for unlimited"
                  value={maxDepth}
                  onChange={(e) => {
                    const val = e.target.value;
                    setMaxDepth(val === '' ? '' : parseInt(val, 10));
                  }}
                  className="w-full bg-[#121212] border border-[#262626] focus:border-indigo-500/50 rounded-lg px-3 py-2 text-sm text-[#ededed] placeholder:text-[#71717a] focus:outline-none transition-colors"
                  disabled={isScanning}
                />
              </div>
              
              <label className="flex items-center gap-3 cursor-pointer group">
                <div className="relative flex items-center justify-center w-4 h-4">
                   <input type="checkbox" defaultChecked className="sr-only peer" />
                   <div className="w-4 h-4 border border-[#3f3f46] rounded peer-checked:bg-indigo-500 peer-checked:border-indigo-500 transition-colors"></div>
                   <svg className="absolute w-3 h-3 text-white opacity-0 peer-checked:opacity-100 pointer-events-none transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                   </svg>
                </div>
                <span className="text-sm text-[#a1a1aa] group-hover:text-[#ededed] transition-colors select-none">Include empty folders</span>
              </label>
            </div>
          </section>
        </div>

        {/* Footer action */}
        <div className="p-6 border-t border-[#262626] bg-[#0a0a0a]">
           <button 
              onClick={handleExport}
              disabled={!displayTree || isScanning}
              className={`w-full py-3 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-all duration-200
                ${displayTree && !isScanning 
                  ? 'bg-[#ededed] text-[#0a0a0a] hover:bg-white shadow-[0_0_15px_rgba(255,255,255,0.05)] hover:shadow-[0_0_20px_rgba(255,255,255,0.1)] active:scale-[0.98]' 
                  : 'bg-[#121212] border border-[#262626] text-[#71717a] cursor-not-allowed'}`}
            >
              <Download size={16} />
              Download ZIP
           </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 hidden sm:flex flex-col relative bg-[#050505]">
        {dragOver && (
          <div className="absolute inset-0 bg-indigo-500/5 backdrop-blur-[2px] z-30 flex items-center justify-center border-2 border-indigo-500/50 border-dashed m-4 rounded-3xl">
            <div className="bg-[#121212] px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-4 text-indigo-400">
               <Upload size={24} className="animate-bounce" />
               <span className="font-medium">Drop directory to clone mapping</span>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="h-14 border-b border-[#262626] flex items-center justify-between px-8 absolute top-0 w-full bg-[#050505]/95 backdrop-blur z-10">
           <div className="flex items-center gap-3">
             <Files size={16} className="text-[#a1a1aa]" />
             <span className="text-sm font-medium text-[#ededed]">Preview Explorer</span>
           </div>
           <div className="flex items-center gap-4 text-xs font-mono">
             {isScanning ? (
               <span className="flex items-center gap-2 text-indigo-400">
                 <RefreshCw size={12} className="animate-spin" /> Scanning...
               </span>
             ) : displayTree ? (
               <span className="text-[#a1a1aa] bg-[#1a1a1a] px-2.5 py-1 rounded-md border border-[#262626]">
                 {totalFolders} directories
               </span>
             ) : null}
           </div>
        </div>

        {/* Tree Content */}
        <div className="flex-1 overflow-auto pt-20 px-8 pb-12 relative">
          {!tree && !isScanning && (
             <div className="h-full flex flex-col items-center justify-center text-[#71717a] gap-4">
               <FolderOpen size={48} className="opacity-20" />
               <p className="text-sm font-medium">Select a root directory to map structure</p>
             </div>
          )}
          
          {displayTree && (
             <div className="max-w-5xl">
                <TreeView node={displayTree} />
             </div>
          )}
        </div>
      </div>
    </div>
  );
}
