import { GeneInfo } from '../types';

const ENSEMBL_BASE = "https://rest.ensembl.org";
const MYVARIANT_URL = "https://myvariant.info/v1/query";

export async function resolveGene(geneSymbol: string): Promise<GeneInfo> {
  // 1. Resolve Symbol to ID
  const xrefResponse = await fetch(
    `${ENSEMBL_BASE}/xrefs/symbol/saccharomyces_cerevisiae/${geneSymbol}?content-type=application/json`
  );
  if (!xrefResponse.ok) throw new Error("Gene symbol lookup failed");
  const xrefData = await xrefResponse.json();
  if (!xrefData.length) throw new Error(`Gene '${geneSymbol}' not found in Yeast database.`);

  const id = xrefData[0].id;

  // 2. Get Sequence
  const seqResponse = await fetch(
    `${ENSEMBL_BASE}/sequence/id/${id}?content-type=text/plain`
  );
  if (!seqResponse.ok) throw new Error("Sequence lookup failed");
  const sequence = await seqResponse.text();

  // 3. Get Gene Description
  let description = "No description available.";
  try {
      const lookupResponse = await fetch(
        `${ENSEMBL_BASE}/lookup/id/${id}?content-type=application/json`
      );
      if (lookupResponse.ok) {
          const lookupData = await lookupResponse.json();
          if (lookupData.description) {
              description = lookupData.description;
          }
      }
  } catch (e) {
      console.warn("Failed to fetch gene description", e);
  }

  return {
    id,
    symbol: geneSymbol,
    sequence: sequence.trim(),
    description
  };
}

export interface AlphaMissenseResult {
    score: number;
    pred_class: string;
}

export async function fetchAlphaMissense(gene: string, residue: number, mutation: string): Promise<AlphaMissenseResult | null> {
    try {
        // Query MyVariant for dbNSFP data matching gene and residue
        // Note: dbnsfp.aapos is strictly string matching in some versions, so we use the number directly.
        // We fetch the 'dbnsfp' field which contains the scores.
        const query = `q=dbnsfp.genename:${gene} AND dbnsfp.aapos:${residue}&fields=dbnsfp`;
        const response = await fetch(`${MYVARIANT_URL}?${query}`);
        
        if (!response.ok) return null;
        
        const data = await response.json();
        if (!data.hits || data.hits.length === 0) return null;

        // Iterate through hits to find the specific amino acid change
        for (const hit of data.hits) {
            if (!hit.dbnsfp) continue;
            
            // dbnsfp can be an object or an array of objects (for multiple transcripts/variants)
            const records = Array.isArray(hit.dbnsfp) ? hit.dbnsfp : [hit.dbnsfp];
            
            for (const record of records) {
                // Check if the alternative amino acid matches our target mutation
                if (record.aaalt === mutation || record.aaalt === mutation.toUpperCase()) {
                    // Extract AlphaMissense data
                    // Structure is typically dbnsfp.alphamissense.score
                    if (record.alphamissense) {
                        return {
                            score: parseFloat(record.alphamissense.score),
                            pred_class: record.alphamissense.pred_class
                        };
                    }
                }
            }
        }
        return null;
    } catch (error) {
        console.error("Error fetching AlphaMissense score:", error);
        return null;
    }
}