import React, { useState } from 'react';
import { InputForm } from './components/InputForm';
import { ResultCard } from './components/ResultCard';
import { resolveGene, fetchVepScore, fetchOrthologs, mapResidueToOrtholog, fetchHumanVariantEffect, isResidueSimilar } from './services/api';
import { findCas9Sites, generateRepairTemplates } from './services/crispr';
import { RepairResult, Ortholog, VariantEffectResult } from './types';

export default function App() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<RepairResult[] | null>(null);
  
  const [currentGene, setCurrentGene] = useState<string>("");
  const [currentEntrezId, setCurrentEntrezId] = useState<string | null>(null);
  const [geneDescription, setGeneDescription] = useState<string | null>(null);
  
  const [variantEffect, setVariantEffect] = useState<VariantEffectResult | null>(null);
  const [isFetchingEffect, setIsFetchingEffect] = useState(false);
  
  const [orthologs, setOrthologs] = useState<Ortholog[]>([]);
  const [isFetchingOrthologs, setIsFetchingOrthologs] = useState(false);

  const [residueForDisplay, setResidueForDisplay] = useState<string>("");
  const [mutationForDisplay, setMutationForDisplay] = useState<string>("");

  const handleGenerate = async (geneInput: string, residue: number, mutation: string, oligoLength: number) => {
    setLoading(true);
    setError(null);
    setResults(null);
    setGeneDescription(null);
    setVariantEffect(null);
    setOrthologs([]);
    setCurrentEntrezId(null);
    
    setCurrentGene(geneInput);
    setResidueForDisplay(residue.toString());
    setMutationForDisplay(mutation);

    try {
      // 1. Fetch Gene Data
      const geneInfo = await resolveGene(geneInput);
      
      setCurrentGene(geneInfo.symbol);
      setCurrentEntrezId(geneInfo.entrezId || null);
      setGeneDescription(geneInfo.description || null);
      
      // 2. Fetch Orthologs (Human) & Variant Effects in Parallel
      setIsFetchingOrthologs(true);
      setIsFetchingEffect(true);

      // We fetch orthologs completely first to ensure we have data for the Human AM check
      const orthologsData = await fetchOrthologs(geneInfo.symbol, geneInfo.id, geneInfo.entrezId);
      setOrthologs(orthologsData);
      setIsFetchingOrthologs(false);

      const yeastVepPromise = geneInfo.transcriptId 
          ? fetchVepScore(geneInfo.transcriptId, residue, mutation, geneInfo.sequence)
          : Promise.resolve(null);

      let combinedEffect = await yeastVepPromise;

      // 3. Try to fetch Human AlphaMissense if we have a good ortholog with alignment
      // Prioritize High Identity Matches
      if (orthologsData.length > 0) {
          const bestOrtholog = orthologsData.find(o => o.alignment && o.ensemblId && o.percentIdentity > 20);
          
          if (bestOrtholog && bestOrtholog.alignment && bestOrtholog.ensemblId) {
             const mapping = mapResidueToOrtholog(residue, bestOrtholog.alignment);
             
             if (mapping) {
                 const yeastAA = geneInfo.sequence[residue - 1]; // 0-based
                 const yeastAAChar = yeastAA ? yeastAA.toUpperCase() : '';
                 const humanAAChar = mapping.humanAA.toUpperCase();

                 // Check Conservation OR Similarity
                 const similar = isResidueSimilar(yeastAAChar, humanAAChar);
                 
                 if (similar) {
                     const humanAnalysis = await fetchHumanVariantEffect(
                         bestOrtholog.ensemblId,
                         mapping.humanResidueIndex,
                         humanAAChar,
                         mutation
                     );

                     if (humanAnalysis) {
                         combinedEffect = {
                             ...(combinedEffect || { prediction: 'unknown', source: 'Merged' }),
                             humanAnalysis: humanAnalysis
                         };
                     }
                 }
             }
          }
      }

      setVariantEffect(combinedEffect);
      setIsFetchingEffect(false);

      // 4. Find Sites & Generate Templates
      const sites = findCas9Sites(geneInfo.sequence, residue);
      if (sites.length === 0) throw new Error("No nearby Cas9 target sites found within window.");

      const generatedResults = generateRepairTemplates(
        geneInfo.sequence,
        sites,
        residue,
        mutation,
        oligoLength
      );

      if (generatedResults.length === 0) throw new Error("No sgRNAs available where a silent PAM mutation could be successfully created within the selected oligo length.");
      
      const getScoreCategory = (score: number) => score >= 70 ? 3 : (score >= 50 ? 2 : 1);
      const getStrategyPriority = (s: string) => (s.includes('PAM') ? 2 : 1);

      generatedResults.sort((a, b) => {
          const catDiff = getScoreCategory(b.score) - getScoreCategory(a.score);
          if (catDiff !== 0) return catDiff;
          const stratDiff = getStrategyPriority(b.strategy) - getStrategyPriority(a.strategy);
          if (stratDiff !== 0) return stratDiff;
          return b.score - a.score;
      });

      setResults(generatedResults);

    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
      setIsFetchingEffect(false);
      setIsFetchingOrthologs(false);
    } finally {
      setLoading(false);
    }
  };

  const renderOrthologs = () => {
      if (isFetchingOrthologs) {
          return (
             <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4 flex items-center gap-3 animate-pulse">
                <div className="h-8 w-8 bg-sky-100 rounded-full"></div>
                <div className="flex-1 space-y-2">
                   <div className="h-3 w-32 bg-slate-200 rounded"></div>
                   <div className="h-2 w-48 bg-slate-100 rounded"></div>
                </div>
             </div>
          );
      }
      
      if (!results && !loading) return null;
      const hasOrthologs = orthologs.length > 0;
      const dioptLink = currentEntrezId 
        ? `https://www.flyrnai.org/cgi-bin/DRSC_orthologs.pl?sc=1&species=4932&input=${currentEntrezId}`
        : `https://www.flyrnai.org/cgi-bin/DRSC_orthologs.pl?sc=1&species=Yeast&input=${currentGene}`;

      return (
          <div className="bg-sky-50 border border-sky-100 rounded-xl p-5 mb-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-sky-100 rounded-lg text-sky-600">
                         <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                      </div>
                      <div>
                          <h3 className="font-bold text-sky-900 text-sm uppercase tracking-wider">Human Orthologs</h3>
                          <p className="text-xs text-slate-500">Merged from DIOPT & Ensembl</p>
                      </div>
                  </div>
                  <a href={dioptLink} target="_blank" rel="noopener noreferrer" className="text-xs text-sky-600 font-medium hover:underline flex items-center gap-1">
                      View in DIOPT
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                  </a>
              </div>
              
              <div className="overflow-x-auto max-h-64 overflow-y-auto border rounded-lg border-sky-100">
                {hasOrthologs ? (
                  <table className="w-full text-sm text-left bg-white">
                      <thead className="text-xs text-sky-800 uppercase bg-sky-50 sticky top-0 shadow-sm z-10">
                          <tr>
                              <th className="px-3 py-2">Symbol</th>
                              <th className="px-3 py-2">% Identity</th>
                              <th className="px-3 py-2">% Similarity</th>
                              <th className="px-3 py-2">DIOPT Score</th>
                          </tr>
                      </thead>
                      <tbody>
                          {orthologs.map((orth, idx) => (
                              <tr key={idx} className="border-b border-sky-50 last:border-0 hover:bg-sky-50 transition-colors">
                                  <td className="px-3 py-2 font-bold text-slate-700">
                                      {orth.symbol}
                                      {orth.bestScore && <span className="ml-2 text-[10px] bg-sky-200 text-sky-800 px-1.5 py-0.5 rounded-full" title="Best Score">Best</span>}
                                  </td>
                                  <td className="px-3 py-2 text-slate-600 font-mono">
                                      {orth.percentIdentity ? `${orth.percentIdentity.toFixed(0)}%` : '-'}
                                  </td>
                                  <td className="px-3 py-2 text-slate-600 font-mono">
                                      {orth.percentSimilarity ? `${orth.percentSimilarity.toFixed(0)}%` : '-'}
                                  </td>
                                  <td className="px-3 py-2">
                                      <div className="flex items-center gap-2">
                                         <div className="h-1.5 w-12 bg-slate-200 rounded-full overflow-hidden">
                                             <div className="h-full bg-sky-500" style={{ width: `${Math.min(100, (orth.score / 15) * 100)}%` }}></div>
                                         </div>
                                         <span className="text-xs text-slate-700 font-medium">{orth.score > 0 ? orth.score : '-'}</span>
                                      </div>
                                  </td>
                              </tr>
                          ))}
                      </tbody>
                  </table>
                  ) : (
                      <div className="text-center py-4 text-sm text-slate-500 italic">
                          No orthologs found directly.
                      </div>
                  )}
              </div>
          </div>
      );
  };

  const renderVariantEffectInfo = () => {
      if (isFetchingEffect) {
          return (
             <div className="bg-white border border-slate-200 rounded-xl p-4 mb-8 flex items-center gap-3 animate-pulse">
                <div className="h-10 w-10 bg-indigo-100 rounded-full"></div>
                <div><div className="h-4 w-32 bg-slate-200 rounded mb-2"></div><div className="h-3 w-48 bg-slate-100 rounded"></div></div>
             </div>
          );
      }
      
      if (!variantEffect) {
          return (
             <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 mb-8 flex items-center gap-4 opacity-75">
                 <div className="p-3 bg-slate-200 rounded-full text-slate-400">
                     <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                 </div>
                 <div>
                     <h4 className="font-bold text-slate-700 text-sm uppercase tracking-wider mb-1">Effect Prediction</h4>
                     <p className="text-sm text-slate-500">
                        No effect scores found for <strong>{currentGene}</strong> p.{residueForDisplay}{mutationForDisplay}.
                     </p>
                 </div>
            </div>
          );
      }

      const { score, prediction, humanAnalysis } = variantEffect;
      
      // Determine overall status based on Yeast SIFT OR Human AM
      const isYeastDeleterious = (score !== undefined && score <= 0.05) || (prediction && prediction.includes('deleterious'));
      
      const humanAMScore = humanAnalysis?.amPathogenicity;
      const humanAMClass = humanAnalysis?.amClass;
      const isHumanDeleterious = (humanAMScore !== undefined && humanAMScore >= 0.56) || (humanAMClass && humanAMClass.includes('pathogenic'));

      const isBad = isYeastDeleterious || isHumanDeleterious;

      let colorClass = isBad 
        ? "bg-red-50 border-red-200 text-red-800"
        : "bg-green-50 border-green-200 text-green-800";

      let icon = isBad ? (
         <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
      ) : (
         <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
      );

      return (
          <div className={`rounded-xl p-5 mb-8 border flex flex-col gap-4 shadow-sm ${colorClass}`}>
             <div className="flex items-center gap-4">
                 <div className="p-3 bg-white bg-opacity-60 rounded-full shadow-sm shrink-0">
                     {icon}
                 </div>
                 <div>
                     <h4 className="font-bold text-xs uppercase tracking-wider opacity-70 mb-1">Yeast SIFT Score</h4>
                     <div className="flex items-baseline gap-3">
                        {score !== undefined ? (
                            <span className="text-2xl font-bold tracking-tight">{score.toFixed(2)}</span>
                        ) : (
                            <span className="text-lg italic opacity-50">Not available</span>
                        )}
                        <span className="font-semibold text-sm border-l border-current pl-3 opacity-90 capitalize">{prediction.replace(/_/g, ' ')}</span>
                     </div>
                 </div>
             </div>

             {/* Human Inferred Data */}
             {humanAnalysis && (
                 <div className="bg-white bg-opacity-50 rounded-lg p-3 border border-current border-opacity-10 mt-2">
                     <div className="flex items-center justify-between mb-2">
                         <h5 className="font-bold text-xs uppercase tracking-wider opacity-80">
                             Inferred from Human ({humanAnalysis.orthologSymbol})
                         </h5>
                         <span className="text-[10px] px-2 py-0.5 rounded-full bg-white bg-opacity-80 font-mono border border-current border-opacity-20">
                             Conserved Residue: {humanAnalysis.humanRefAA}{humanAnalysis.humanResidue}
                         </span>
                     </div>
                     
                     <div className="grid grid-cols-2 gap-4">
                         <div>
                             <span className="text-xs opacity-60 block mb-0.5">AlphaMissense</span>
                             <div className="flex items-baseline gap-2">
                                {humanAnalysis.amPathogenicity !== undefined ? (
                                    <span className="text-xl font-bold">{humanAnalysis.amPathogenicity.toFixed(2)}</span>
                                ) : <span className="text-sm opacity-50">--</span>}
                                {humanAnalysis.amClass && (
                                    <span className="text-xs font-semibold capitalize">{humanAnalysis.amClass.replace(/_/g, ' ')}</span>
                                )}
                             </div>
                         </div>
                         <div>
                             <span className="text-xs opacity-60 block mb-0.5">Human SIFT</span>
                             <div className="flex items-baseline gap-2">
                                {humanAnalysis.siftScore !== undefined ? (
                                    <span className="text-xl font-bold">{humanAnalysis.siftScore.toFixed(2)}</span>
                                ) : <span className="text-sm opacity-50">--</span>}
                                {humanAnalysis.siftPrediction && (
                                    <span className="text-xs font-semibold capitalize">{humanAnalysis.siftPrediction.replace(/_/g, ' ')}</span>
                                )}
                             </div>
                         </div>
                     </div>
                     <p className="text-[10px] opacity-60 mt-2 italic">
                         *Score derived from mapping Yeast residue {residueForDisplay} to Human {humanAnalysis.humanRefAA}{humanAnalysis.humanResidue} due to high similarity/conservation.
                     </p>
                 </div>
             )}
          </div>
      );
  };

  return (
    <div className="min-h-screen bg-slate-100 font-sans text-slate-900 pb-20">
      <header className="bg-indigo-700 text-white py-8 shadow-lg">
        <div className="container mx-auto px-4 max-w-5xl">
          <h1 className="text-3xl font-bold tracking-tight mb-2">CODY - CRISPR Oligo Designer for Yeast</h1>
          <p className="text-indigo-200">Automated repair template and cloning oligo design for point mutations in <span className="italic">S. cerevisiae</span>.</p>
        </div>
      </header>

      <main className="container mx-auto px-4 max-w-5xl -mt-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 space-y-6">
            <InputForm isLoading={loading} onSubmit={handleGenerate} />
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
               <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-2">Instructions</h3>
               <ul className="text-sm text-slate-600 space-y-2 list-disc pl-4">
                 <li>Enter the standard Yeast gene name (e.g., PHO13).</li>
                 <li>Enter the amino acid residue number to mutate.</li>
                 <li>Enter the single-letter code for the <strong>new</strong> amino acid.</li>
                 <li>Adjust the oligo length slider to match your synthesis constraints.</li>
                 <li className="pt-2 mt-2 border-t border-slate-100">
                    <span className="font-semibold block mb-1">Color Key:</span>
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-red-600 font-bold bg-slate-100 px-1 rounded">Red Text</span>
                        <span className="text-xs">= Point Mutation</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-purple-600 font-bold bg-slate-100 px-1 rounded">Purple Text</span>
                        <span className="text-xs">= PAM Site</span>
                    </div>
                 </li>
               </ul>
            </div>
          </div>

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
                 <p className="text-lg font-medium">Ready to design</p>
                 <p className="text-sm">Enter parameters to begin.</p>
              </div>
            )}

            {results && (
              <div className="animate-fade-in">
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

                 {renderOrthologs()}
                 {renderVariantEffectInfo()}

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
