import React, { useState } from 'react';
import { RepairResult } from '../types';
import { addCodonSpacing } from '../services/utils';

interface ResultCardProps {
  result: RepairResult;
  index: number;
}

interface CopyButtonProps {
    textToCopy: string;
    label?: string;
    variant?: 'primary' | 'secondary';
    className?: string;
}

const CopyToClipboardButton: React.FC<CopyButtonProps> = ({ textToCopy, label = 'Copy', variant = 'secondary', className = '' }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(textToCopy).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000); // Reset after 2 seconds
        }).catch(err => console.error('Failed to copy text: ', err));
    };

    const baseClasses = "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-all font-medium border shadow-sm";
    const variantClasses = variant === 'primary' 
        ? (copied ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-indigo-600 text-white border-indigo-700 hover:bg-indigo-700')
        : (copied ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50');

    return (
        <button
            onClick={handleCopy}
            className={`${baseClasses} ${variantClasses} ${className}`}
        >
            {copied ? (
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
            ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
            )}
            <span>{copied ? 'Copied!' : label}</span>
        </button>
    );
};


export const ResultCard: React.FC<ResultCardProps> = ({ result, index }) => {
  const frame = result.homologyStart % 3;

  // Calculate PAM indices relative to the homology/repair template start
  const pamStartOffset = result.site.position - result.homologyStart;
  const pamIndices = new Set<number>();
  if (result.site.strand === 'forward') {
      pamIndices.add(pamStartOffset + 20);
      pamIndices.add(pamStartOffset + 21);
      pamIndices.add(pamStartOffset + 22);
  } else {
      pamIndices.add(pamStartOffset + 0);
      pamIndices.add(pamStartOffset + 1);
      pamIndices.add(pamStartOffset + 2);
  }

  const renderStrategyBadge = () => {
    switch (result.strategy) {
      case 'PAM_DISRUPTED_BY_TARGET':
        return (
           <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 border border-purple-200 ml-2">
             Target Disrupts PAM
           </span>
        );
      case 'PAM_SILENT':
        return (
           <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200 ml-2">
             Silent PAM ({result.silentMutationCount} mut)
           </span>
        );
      case 'SEED_SILENT':
        return (
           <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 border border-orange-200 ml-2">
             Silent Seed ({result.silentMutationCount} mut)
           </span>
        );
      default:
        return null;
    }
  };

  const renderScoreBadge = () => {
    const { score } = result;
    let colorClass = "";
    let label = "";

    if (score >= 70) {
        colorClass = "bg-green-100 text-green-800 border-green-200";
        label = "High Efficiency";
    } else if (score >= 50) {
        colorClass = "bg-yellow-100 text-yellow-800 border-yellow-200";
        label = "Medium Efficiency";
    } else {
        colorClass = "bg-red-100 text-red-800 border-red-200";
        label = "Low Efficiency";
    }

    return (
        <a 
          href="https://www.nature.com/articles/nbt.3026"
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ml-2 hover:opacity-80 transition-opacity cursor-pointer ${colorClass}`}
          title="Heuristic score based on Doench 2014 rules"
        >
            Score: {score} ({label})
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        </a>
    );
  };

  const renderSeqWithHighlights = (seq: string, isRevComp: boolean = false) => {
    const seqLen = seq.length;
    return seq.split('').map((char, i) => {
      const rawIndex = isRevComp ? seqLen - 1 - i : i;

      if (char === char.toLowerCase() && /[a-z]/.test(char)) {
        return <span key={i} className="text-red-600 font-bold">{char}</span>;
      }
      
      if (pamIndices.has(rawIndex)) {
        return <span key={i} className="text-purple-600 font-bold">{char}</span>;
      }

      return <span key={i}>{char}</span>;
    });
  };

  const spacedOrig = addCodonSpacing(result.dnaAlignment.original, frame);
  const spacedMod = addCodonSpacing(result.dnaAlignment.modified, frame);
  const spacedMatch = addCodonSpacing(result.dnaAlignment.matchString, frame);

  let origRawIndexCounter = 0;
  const renderedOrig = spacedOrig.split('').map((char, i) => {
    if (char === ' ') return ' ';
    const currentRawIndex = origRawIndexCounter;
    origRawIndexCounter++;
    if (pamIndices.has(currentRawIndex)) {
        return <span key={i} className="text-purple-500 font-bold">{char}</span>;
    }
    return char;
  });

  let rawIndexCounter = 0;
  const renderedAlignedTemplate = spacedMod.split('').map((char, i) => {
    if (char === ' ') return ' ';
    const currentRawIndex = rawIndexCounter;
    rawIndexCounter++;
    const origChar = spacedOrig[i];
    if (char !== origChar) {
        return <span key={i} className="text-red-500 font-bold">{char}</span>;
    }
    if (pamIndices.has(currentRawIndex)) {
        return <span key={i} className="text-purple-500 font-bold">{char}</span>;
    }
    return char; 
  });

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-6">
      <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex flex-wrap gap-4 justify-between items-center">
        <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
                <h3 className="font-bold text-slate-800 text-lg">Option {index + 1}</h3>
                {renderStrategyBadge()}
                {renderScoreBadge()}
            </div>
            <p className="text-sm text-slate-500">
                Site: {result.site.position} | Strand: {result.site.strand}
            </p>
        </div>
        <div>
            {result.aaChangeStatus === 'success' ? (
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">
                    ✅ Verified: 1 AA Change
                </span>
            ) : (
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-200">
                    ❌ Warning: {result.aaChangesCount} AA Changes
                </span>
            )}
        </div>
      </div>

      <div className="p-6 space-y-6">
        <div className="space-y-3">
            <div>
                 <h4 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">
                     <a href="https://www.addgene.org/67638/" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">pML104</a> Cloning Oligos
                 </h4>
                 <p className="text-xs text-slate-500 mt-1">
                    Ref: <a href="https://doi.org/10.1002/yea.3098" target="_blank" rel="noopener noreferrer" className="hover:underline">Laughery et al Yeast. 2015</a>
                 </p>
            </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="bg-slate-800 rounded-lg p-3 group relative">
              <CopyToClipboardButton textToCopy={result.cloningOligoA} className="absolute top-2 right-2 bg-slate-700 text-slate-300 border-none hover:bg-slate-600" />
              <span className="text-xs text-slate-400 block mb-1">Oligo A</span>
              <code className="text-indigo-300 text-sm font-mono break-all pr-12 block">{result.cloningOligoA}</code>
            </div>
            <div className="bg-slate-800 rounded-lg p-3 relative">
               <CopyToClipboardButton textToCopy={result.cloningOligoB} className="absolute top-2 right-2 bg-slate-700 text-slate-300 border-none hover:bg-slate-600" />
               <span className="text-xs text-slate-400 block mb-1">Oligo B</span>
              <code className="text-indigo-300 text-sm font-mono break-all pr-12 block">{result.cloningOligoB}</code>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">Genomic Repair Template</h4>
          <div className="bg-slate-100 rounded-lg p-4 border border-slate-200 relative">
              <div className="absolute top-2 right-2 flex gap-2">
                  <CopyToClipboardButton textToCopy={result.repairTemplateRevComp.toUpperCase()} label="Copy Rev Comp" variant="secondary" />
                  <CopyToClipboardButton textToCopy={result.repairTemplate.toUpperCase()} label="Copy" variant="primary" />
              </div>
              <span className="text-xs text-slate-500 block mb-1">Repair Oligo ({result.repairTemplate.length} nt)</span>
              <code className="text-slate-700 text-xs font-mono break-all leading-relaxed block mt-8">
                  {renderSeqWithHighlights(result.repairTemplate, false)}
              </code>
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">DNA Alignment (Partial)</h4>
          <div className="bg-slate-900 rounded-lg p-4 overflow-x-auto">
            <pre className="text-xs font-mono leading-relaxed">
              <div className="text-slate-400 mb-1">Original (Top) vs. Template (Bottom)</div>
              <div className="text-sky-300 whitespace-pre">{renderedOrig}</div>
              <div className="text-slate-600 whitespace-pre">{spacedMatch}</div>
              <div className="text-emerald-400 whitespace-pre">
                {renderedAlignedTemplate}
              </div>
            </pre>
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">Protein Verification</h4>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 overflow-x-auto">
             <pre className="text-xs font-mono leading-relaxed whitespace-pre text-slate-700">
                <div><span className="text-slate-400 select-none">Original: </span>{result.aaAlignment.original}</div>
                <div><span className="text-slate-400 select-none">Match:    </span><span className="text-slate-300">{result.aaAlignment.matchString}</span></div>
                <div>
                    <span className="text-slate-400 select-none">Repaired: </span>
                    <span>
                        {result.aaAlignment.modified.split('').map((char, i) => (
                            char !== result.aaAlignment.original[i] ? <span key={i} className="text-red-600 font-bold">{char}</span> : char
                        ))}
                    </span>
                </div>
             </pre>
          </div>
        </div>
      </div>
    </div>
  );
};