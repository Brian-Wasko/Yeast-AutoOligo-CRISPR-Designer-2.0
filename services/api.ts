import { GeneInfo, Ortholog, VariantEffectResult, HumanAnalysisResult } from '../types';
import { toThreeLetterAA, codonToAA } from './utils';

const ENSEMBL_BASE = "https://rest.ensembl.org";

export async function resolveGene(geneSymbol: string): Promise<GeneInfo> {
  const xrefResponse = await fetch(
    `${ENSEMBL_BASE}/xrefs/symbol/saccharomyces_cerevisiae/${geneSymbol}?content-type=application/json`
  );
  if (!xrefResponse.ok) throw new Error("Gene symbol lookup failed");
  const xrefData = await xrefResponse.json();
  if (!xrefData.length) throw new Error(`Gene '${geneSymbol}' not found in Yeast database.`);

  const id = xrefData[0].id;
  const canonicalSymbol = xrefData[0].display_id || geneSymbol;

  const seqResponse = await fetch(
    `${ENSEMBL_BASE}/sequence/id/${id}?type=cds;content-type=text/plain`
  );
  if (!seqResponse.ok) throw new Error("Sequence lookup failed");
  const sequence = await seqResponse.text();

  let description = "No description available.";
  let transcriptId = id;
  let entrezId: string | undefined;

  try {
      const [lookupResponse, entrezResponse] = await Promise.all([
          fetch(`${ENSEMBL_BASE}/lookup/id/${id}?expand=1&content-type=application/json`),
          fetch(`${ENSEMBL_BASE}/xrefs/id/${id}?external_db=EntrezGene;content-type=application/json`)
      ]);

      if (lookupResponse.ok) {
          const lookupData = await lookupResponse.json();
          if (lookupData.description) description = lookupData.description;
          if (lookupData.Transcript && lookupData.Transcript.length > 0) {
              transcriptId = lookupData.Transcript[0].id;
          }
      }

      if (entrezResponse.ok) {
          const entrezData = await entrezResponse.json();
          if (entrezData && entrezData.length > 0) {
              entrezId = entrezData[0].primary_id;
          }
      }

  } catch (e) {
      console.warn("Failed to fetch gene details or Entrez ID", e);
  }

  return { id, transcriptId, entrezId, symbol: canonicalSymbol, sequence: sequence.trim(), description };
}

export async function fetchVepScore(
    transcriptId: string, 
    residue: number, 
    mutation: string, 
    originalSequence: string
): Promise<VariantEffectResult | null> {
    try {
        const codonIndex = (residue - 1) * 3;
        if (codonIndex >= originalSequence.length) return null;
        
        const originalCodon = originalSequence.substring(codonIndex, codonIndex + 3);
        const originalAA = codonToAA(originalCodon);
        
        if (!originalAA) return null;

        if (originalAA === mutation) {
            return { prediction: "synonymous_variant", source: "Calculated (Identity)" };
        }
        
        const threeLetterRef = toThreeLetterAA(originalAA);
        const threeLetterAlt = toThreeLetterAA(mutation);
        const hgvs = `${transcriptId}:p.${threeLetterRef}${residue}${threeLetterAlt}`;
        
        // Yeast SIFT call
        const response = await fetch(
            `${ENSEMBL_BASE}/vep/saccharomyces_cerevisiae/hgvs/${hgvs}?content-type=application/json`
        );
        
        if (!response.ok) return null;
        
        const data = await response.json();
        if (!data || data.length === 0) return null;

        const consequences = data[0].transcript_consequences;
        if (consequences) {
            let match = consequences.find((c: any) => c.transcript_id === transcriptId && c.sift_score !== undefined);
            if (!match) match = consequences.find((c: any) => c.sift_score !== undefined);
            if (!match) match = consequences.find((c: any) => c.transcript_id === transcriptId);

            if (match) {
                 const prediction = match.sift_prediction 
                    || match.consequence_terms?.[0] 
                    || (match.sift_score !== undefined ? (match.sift_score <= 0.05 ? 'deleterious' : 'tolerated') : 'unknown effect');
                 
                 return {
                    score: match.sift_score,
                    prediction: prediction,
                    source: 'Ensembl VEP (Yeast)'
                };
            }
        }
        return null;
    } catch (e) {
        console.error("VEP Fetch Error:", e);
        return null;
    }
}

// --- ORTHOLOG & ALPHAMISSENSE PROXY LOGIC ---

// 1. Fetch Human VEP (AlphaMissense)
export async function fetchHumanVariantEffect(
    humanGeneId: string,
    humanResidue: number,
    humanRefAA: string,
    mutationAA: string
): Promise<HumanAnalysisResult | null> {
    try {
        // 1. Get Canonical Transcript for Human Gene
        const lookupRes = await fetch(`${ENSEMBL_BASE}/lookup/id/${humanGeneId}?expand=1&content-type=application/json`);
        if (!lookupRes.ok) return null;
        const lookupData = await lookupRes.json();
        
        const transcript = lookupData.Transcript?.find((t: any) => t.is_canonical === 1) || lookupData.Transcript?.[0];
        if (!transcript) return null;

        // 2. Construct HGVS
        const threeRef = toThreeLetterAA(humanRefAA);
        const threeAlt = toThreeLetterAA(mutationAA);
        const hgvs = `${transcript.id}:p.${threeRef}${humanResidue}${threeAlt}`;

        // 3. Call Human VEP with AlphaMissense enabled
        // We use the POST endpoint for VEP sometimes to avoid URL length issues, but GET is fine for single HGVS
        const vepRes = await fetch(
            `${ENSEMBL_BASE}/vep/human/hgvs/${hgvs}?content-type=application/json&AlphaMissense=1`
        );
        if (!vepRes.ok) return null;
        const vepData = await vepRes.json();

        if (!vepData || vepData.length === 0) return null;
        
        const match = vepData[0].transcript_consequences?.find((c: any) => c.transcript_id === transcript.id) 
                   || vepData[0].transcript_consequences?.[0];

        if (!match) return null;

        // Extract AlphaMissense (keys can vary based on VEP plugin version)
        const amClass = match.am_class || match.alphamissense_class;
        const amScoreRaw = match.am_pathogenicity || match.alphamissense_score;
        const amScore = amScoreRaw !== undefined ? parseFloat(amScoreRaw) : undefined;

        return {
            orthologSymbol: lookupData.display_name || lookupData.id,
            humanResidue: humanResidue,
            humanRefAA: humanRefAA,
            isConserved: true, 
            amClass: amClass,
            amPathogenicity: amScore,
            siftScore: match.sift_score,
            siftPrediction: match.sift_prediction,
            polyphenScore: match.polyphen_score,
            polyphenPrediction: match.polyphen_prediction
        };

    } catch (e) {
        console.warn("Error fetching human variant effect", e);
        return null;
    }
}

// 2. Map Yeast Residue to Human Residue using Alignment
export function mapResidueToOrtholog(
    yeastResidueIndex: number, // 1-based
    alignment: { sourceSeq: string, targetSeq: string }
): { humanResidueIndex: number, humanAA: string } | null {
    const { sourceSeq, targetSeq } = alignment;
    
    // Iterate through source (Yeast) sequence to find the column corresponding to the residue
    // Note: alignment sequences contain gaps '-'.
    let currentYeastIndex = 0;
    let alignmentColumn = -1;

    for (let i = 0; i < sourceSeq.length; i++) {
        if (sourceSeq[i] !== '-') {
            currentYeastIndex++;
        }
        if (currentYeastIndex === yeastResidueIndex) {
            alignmentColumn = i;
            break;
        }
    }

    if (alignmentColumn === -1) return null;

    // Check target (Human) sequence at that column
    const humanAA = targetSeq[alignmentColumn];
    if (humanAA === '-' || humanAA === undefined) return null; // Gap in human, cannot map

    // Count human residues up to that column to get index
    let currentHumanIndex = 0;
    for (let i = 0; i <= alignmentColumn; i++) {
        if (targetSeq[i] !== '-') {
            currentHumanIndex++;
        }
    }

    return {
        humanResidueIndex: currentHumanIndex,
        humanAA: humanAA
    };
}

// Check similarity groupings
export function isResidueSimilar(aa1: string, aa2: string): boolean {
    if (aa1 === aa2) return true;
    const groups = [
        ['G', 'A', 'V', 'L', 'I'], // Aliphatic
        ['F', 'Y', 'W'], // Aromatic
        ['K', 'R', 'H'], // Positively charged
        ['D', 'E'], // Negatively charged
        ['S', 'T'], // Polar uncharged
        ['C', 'M'], // Sulfur
        ['N', 'Q']  // Amide
    ];
    return groups.some(group => group.includes(aa1) && group.includes(aa2));
}

async function fetchDioptData(url: string): Promise<any | null> {
    try {
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        const response = await fetch(proxyUrl);
        if (response.ok) return await response.json();
    } catch (e) {
        // console.warn("CorsProxy failed", e);
    }
    try {
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
        const response = await fetch(proxyUrl);
        if (response.ok) {
            const wrapper = await response.json();
            if (wrapper.contents) return JSON.parse(wrapper.contents);
        }
    } catch (e) {
        console.warn("AllOrigins failed", e);
    }
    return null;
}

export async function fetchOrthologs(geneSymbol: string, ensemblId: string, entrezId?: string): Promise<Ortholog[]> {
    const candidates: Map<string, Ortholog> = new Map();
    // Key by uppercase SYMBOL for easy merging

    const addOrUpdate = (o: Ortholog, key: string) => {
        if (!candidates.has(key)) {
            candidates.set(key, o);
        } else {
            const existing = candidates.get(key)!;
            candidates.set(key, {
                ...existing,
                // If we are merging Ensembl data into a DIOPT entry:
                ensemblId: o.ensemblId || existing.ensemblId, 
                // Prioritize Ensembl Identity stats if they exist (>0)
                percentIdentity: o.percentIdentity > 0 ? o.percentIdentity : existing.percentIdentity,
                percentSimilarity: o.percentSimilarity > 0 ? o.percentSimilarity : existing.percentSimilarity,
                alignment: o.alignment || existing.alignment,
                // Keep the better score/bestScore from DIOPT usually
                score: Math.max(existing.score, o.score),
                bestScore: existing.bestScore || o.bestScore,
                source: 'Merged'
            });
        }
    };

    // 1. DIOPT (for Scores)
    if (entrezId) {
        const url = `https://www.flyrnai.org/tools/diopt/web/diopt_api/v9/get_orthologs_from_entrez/4932/${entrezId}/9606/none`;
        const data = await fetchDioptData(url);
        if (data && data.results) {
            const resultsContainer = data.results;
            let entries = resultsContainer[entrezId] || resultsContainer[Number(entrezId)];
            if (!entries && Object.keys(resultsContainer).length > 0) entries = resultsContainer[Object.keys(resultsContainer)[0]];

            if (entries) {
                Object.values(entries).forEach((o: any) => {
                    const symbol = o.symbol || o.gene_symbol;
                    if (!symbol) return;
                    
                    addOrUpdate({
                        symbol: symbol,
                        geneId: String(o.geneid || o.entrez_id),
                        score: parseFloat(o.score) || 0,
                        bestScore: o.best_score === "Yes" || o.best_score === true,
                        percentIdentity: parseFloat(o.percent_identity) || 0,
                        percentSimilarity: parseFloat(o.percent_similarity) || 0,
                        source: 'DIOPT'
                    }, symbol.toUpperCase());
                });
            }
        }
    }

    // 2. Ensembl Homology (for Identity, IDs and Alignment)
    try {
        const r = await fetch(`${ENSEMBL_BASE}/homology/id/${ensemblId}?target_species=homo_sapiens;type=orthologues;content-type=application/json;sequence=1`);
        if (r.ok) {
            const data = await r.json();
            if (data?.data?.[0]?.homologies) {
                data.data[0].homologies.forEach((h: any) => {
                    const targetId = h.target.id;
                    const symbol = h.target.display_id || targetId;
                    
                    const ortholog: Ortholog = {
                        symbol: symbol,
                        geneId: targetId,
                        ensemblId: targetId,
                        score: 0,
                        bestScore: false,
                        percentIdentity: h.target.perc_id || 0,
                        percentSimilarity: h.target.perc_pos || 0,
                        source: 'Ensembl',
                        alignment: {
                            sourceSeq: h.source.align_seq,
                            targetSeq: h.target.align_seq
                        }
                    };
                    addOrUpdate(ortholog, symbol.toUpperCase());
                });
            }
        }
    } catch (e) {
        console.warn("Ensembl Homology fetch failed", e);
    }

    const finalResults = Array.from(candidates.values());
    
    return finalResults.sort((a, b) => {
        if (a.bestScore !== b.bestScore) return a.bestScore ? -1 : 1;
        if (a.score !== b.score) return b.score - a.score;
        return b.percentIdentity - a.percentIdentity;
    }).slice(0, 15);
}
