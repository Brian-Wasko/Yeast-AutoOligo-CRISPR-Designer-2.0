
export interface GeneInfo {
  id: string;
  transcriptId?: string;
  entrezId?: string;
  symbol: string;
  sequence: string;
  description?: string;
}

export interface Cas9Site {
  position: number;
  sequence: string;
  strand: 'forward' | 'reverse';
}

export interface RepairResult {
  site: Cas9Site;
  cloningOligoA: string;
  cloningOligoB: string;
  repairTemplate: string;
  repairTemplateRevComp: string;
  originalRegion: string;
  homologyStart: number;
  mutationPosition: number;
  aaChangeStatus: 'success' | 'warning';
  aaChangesCount: number;
  dnaAlignment: AlignmentData;
  aaAlignment: AlignmentData;
  strategy: 'PAM_DISRUPTED_BY_TARGET' | 'PAM_SILENT' | 'SEED_SILENT';
  silentMutationCount: number;
  score: number;
}

export interface AlignmentData {
  original: string;
  modified: string;
  matchString: string;
}

export interface CodonTable {
  [key: string]: string[];
}

export interface Ortholog {
  symbol: string;
  geneId: string; // Entrez ID or Ensembl ID
  ensemblId?: string; // Specific field for ENSG ID to help merging
  score: number; // DIOPT Score
  bestScore: boolean;
  percentIdentity: number;
  percentSimilarity: number;
  source: 'DIOPT' | 'Ensembl' | 'Merged';
  // Alignment data for mapping residues
  alignment?: {
      sourceSeq: string; // Yeast Aligned Seq (with gaps)
      targetSeq: string; // Human Aligned Seq (with gaps)
  };
}

export interface HumanAnalysisResult {
    orthologSymbol: string;
    humanResidue: number;
    humanRefAA: string;
    isConserved: boolean;
    amClass?: string;
    amPathogenicity?: number;
    siftScore?: number;
    siftPrediction?: string;
    polyphenScore?: number;
    polyphenPrediction?: string;
}

export interface VariantEffectResult {
    score?: number; // Yeast SIFT Score
    prediction: string; // 'tolerated' | 'deleterious'
    source: string;
    // Proxied Human Data
    humanAnalysis?: HumanAnalysisResult;
}
