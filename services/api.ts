import { GeneInfo } from '../types';

const ENSEMBL_BASE = "https://rest.ensembl.org";

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