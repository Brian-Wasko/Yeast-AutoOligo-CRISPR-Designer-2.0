import React, { useState } from 'react';
import { InputForm } from './components/InputForm';
import { ResultCard } from './components/ResultCard';
import { resolveGene, fetchAlphaMissense, AlphaMissenseResult } from './services/api';
import { findCas9Sites, generateRepairTemplates } from './services/crispr';
import { RepairResult } from './types';

export default function App() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<RepairResult[] | null>(null);
  const [currentGene, setCurrentGene] = useState<string>("");
  const [geneDescription, setGeneDescription] = useState<string | null>(null);
  const [alphaMissense, setAlphaMissense] = useState<AlphaMissenseResult | null>(null);
  const [isFetchingAM, setIsFetchingAM] = useState(false);

  const handleGenerate = async (gene: string, residue: number, mutation: string, oligoLength: number) => {
    setLoading(true);
    setError(null);
    setResults(null);
    setGeneDescription(null);
    setAlphaMissense(null);
    setCurrentGene(gene);

    try {
      // 1. Fetch Gene Data (Symbol, ID, Sequence, Description)
      const geneInfo = await resolveGene(gene);
      setGeneDescription(geneInfo.description || null);
      
      // 2. Fetch AlphaMissense Data (Async, non-blocking for critical path)
      // Note: MyVariant dbNSFP is human-centric. We attempt to fetch if the user is designing for a conserved gene or human gene.
      setIsFetchingAM(true);
      fetchAlphaMissense(gene, residue, mutation).then(amData => {
          setAlphaMissense(amData);
          setIsFetchingAM(false);
      }).catch(e => {
          console.warn("Background AM fetch failed", e);
          setIsFetchingAM(false);
      });

      // 3. Find Sites
      const sites = findCas9Sites(geneInfo.sequence, residue);
      
      if (sites.length === 0) {
        throw new Error("No nearby Cas9 target sites found within window.");
      }

      // 4. Generate Templates
      const generatedResults = generateRepairTemplates(
        geneInfo.sequence,
        sites,
        residue,
        mutation,
        oligoLength
      );

      if (generatedResults.length === 0) {
        throw new Error("No sgRNAs available where a silent PAM mutation could be successfully created within the selected oligo length.");
      }
      
      // 5. Sort results
      const getScoreCategory = (score: number): number => {
          if (score >= 70) return 3; // Green
          if (score >= 50) return 2; // Yellow
          return 1; // Red
      };

      const getStrategyPriority = (strategy: RepairResult['strategy']): number => {
          if (strategy === 'PAM_DISRUPTED_BY_TARGET' || strategy === 'PAM_SILENT') return 2;
          if (strategy === 'SEED_SILENT') return 1;
          return 0;
      };

      generatedResults.sort((a, b) => {
          const categoryA = getScoreCategory(a.score);
          const categoryB = getScoreCategory(b.score);
          if (categoryA !== categoryB) {
              return categoryB - categoryA; // Descending category (Green > Yellow > Red)
          }

          const strategyA = getStrategyPriority(a.strategy);
          const strategyB = getStrategyPriority(b.strategy);
          if (strategyA !== strategyB) {
              return strategyB - strategyA; // Descending priority (PAM > SEED)
          }

          // If category and strategy are the same, sort by raw score descending
          return b.score - a.score;
      });

      setResults(generatedResults);

    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
      setIsFetchingAM(false);
    } finally {
      setLoading(false);
    }
  };

  const renderAlphaMissenseInfo = () => {
      if (isFetchingAM) {
          return (
             <div className="bg-white border border-slate-200 rounded-xl p-4 mb-8 flex items-center gap-3 animate-pulse">
                <div className="h-10 w-10 bg-indigo-100 rounded-full flex items-center justify-center">
                    <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                    </svg>
                </div>
                <div>
                   <div className="h-4 w-32 bg-slate-200 rounded mb-2"></div>
                   <div className="h-3 w-48 bg-slate-100 rounded"></div>
                </div>
             </div>
          );
      }
      
      if (!alphaMissense) return null;

      const { score, pred_class } = alphaMissense;
      
      let classification = "Ambiguous";
      let colorClass = "bg-yellow-50 border-yellow-200 text-yellow-800";
      let icon = (
          <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
      );

      // Thresholds: > 0.56 pathogenic, < 0.34 benign, else ambiguous
      // We prioritize the explicit pred_class if the API provides it.
      if (pred_class === 'pathogenic' || (!pred_class && score > 0.56)) {
          classification = "Likely Pathogenic";
          colorClass = "bg-red-50 border-red-200 text-red-800";
          icon = (
             <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
          );
      } else if (pred_class === 'benign' || (!pred_class && score < 0.34)) {
          classification = "Likely Benign";
          colorClass = "bg-green-50 border-green-200 text-green-800";
          icon = (
             <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
          );
      }

      return (
          <div className={`rounded-xl p-5 mb-8 border flex items-center justify-between shadow-sm ${colorClass}`}>
             <div className="flex items-center gap-4">
                 <div className="p-3 bg-white bg-opacity-60 rounded-full shadow-sm">
                     {icon}
                 </div>
                 <div>
                     <h4 className="font-bold text-xs uppercase tracking-wider opacity-70 mb-1">AlphaMissense Prediction</h4>
                     <div className="flex items-baseline gap-3">
                        <span className="text-3xl font-bold tracking-tight">{score.toFixed(3)}</span>
                        <span className="font-semibold text-lg border-l border-current pl-3 opacity-90">{classification}</span>
                     </div>
                 </div>
             </div>
             <div className="text-right">
                <a href="https://github.com/google-deepmind/alphamissense" target="_blank" rel="noopener noreferrer" className="text-xs font-medium underline opacity-60 hover:opacity-100 block mb-1">
                   Source: dbNSFP
                </a>
                <span className="text-[10px] uppercase opacity-50 font-bold tracking-wider">Human Homolog Data</span>
             </div>
          </div>
      );
  };

  return (
    <div className="min-h-screen bg-slate-100 font-sans text-slate-900 pb-20">
      {/* Header */}
      <header className="bg-indigo-700 text-white py-8 shadow-lg">
        <div className="container mx-auto px-4 max-w-5xl">
          <h1 className="text-3xl font-bold tracking-tight mb-2">Yeast AutoOligo CRISPR Designer</h1>
          <p className="text-indigo-200">Automated repair template and cloning oligo design for point mutations in <span className="italic">S. cerevisiae</span>.</p>
        </div>
      </header>

      <main className="container mx-auto px-4 max-w-5xl -mt-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column: Input */}
          <div className="lg:col-span-1 space-y-6">
            <InputForm isLoading={loading} onSubmit={handleGenerate} />
            
            {/* Context Info Box */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
               <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-2">Instructions</h3>
               <ul className="text-sm text-slate-600 space-y-2 list-disc pl-4">
                 <li>Enter the standard Yeast gene name (e.g., PHO13).</li>
                 <li>Enter the amino acid residue number to mutate.</li>
                 <li>Enter the single-letter code for the <strong>new</strong> amino acid.</li>
                 <li>Adjust the oligo length slider to match your synthesis constraints (e.g. 90-mer).</li>
                 <li>The tool finds Cas9 sites and designs silent PAM mutations.</li>
                 <li className="pt-2 border-t border-slate-100 mt-2">
                    <span className="font-semibold">Legend:</span>
                    <ul className="list-none pl-0 mt-1 space-y-1">
                        <li><span className="text-red-600 font-bold">Red</span> text indicates mutations.</li>
                        <li><span className="text-purple-600 font-bold">Purple</span> text indicates PAM sites.</li>
                    </ul>
                 </li>
               </ul>
            </div>
          </div>

          {/* Right Column: Results */}
          <div className="lg:col-span-2">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-xl mb-6 shadow-sm">
                <strong>Error:</strong> {error}
              </div>
            )}

            {loading && !results && (
                <div className="flex flex-col items-center justify-center py-20 space-y-4 text-slate-400">
                    <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                    <p>Analyzing gene sequence and calculating alignments...</p>
                </div>
            )}

            {!loading && !results && !error && (
              <div className="flex flex-col items-center justify-center py-20 bg-white rounded-xl border border-slate-200 border-dashed text-slate-400">
                 <svg className="w-16 h-16 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"></path>
                 </svg>
                 <p className="text-lg font-medium">Ready to design</p>
                 <p className="text-sm">Enter parameters to begin.</p>
              </div>
            )}

            {results && (
              <div className="animate-fade-in">
                 {/* Gene Context Card */}
                 <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-6 mb-4">
                    <div className="flex items-start gap-4">
                        <div className="p-2 bg-indigo-100 rounded-lg text-indigo-600">
                           <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-indigo-900 mb-1">Gene: {currentGene}</h3>
                            <p className="text-indigo-800 text-sm leading-relaxed">
                                {geneDescription || "No description available."}
                            </p>
                        </div>
                    </div>
                 </div>

                 {/* AlphaMissense Score Card - Placed AFTER Gene Card */}
                 {renderAlphaMissenseInfo()}

                <div className="flex items-center justify-between mb-6">
                   <h2 className="text-2xl font-bold text-slate-800">Design Results</h2>
                   <span className="bg-slate-200 text-slate-700 px-3 py-1 rounded-full text-xs font-bold">
                     {results.length} Options Found
                   </span>
                </div>

                {results.map((result, idx) => (
                  <ResultCard key={idx} result={result} index={idx} />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
