
export interface GeneInfo {
  id: string;
  symbol: string;
  sequence: string;
  description?: string;
}

export interface Cas9Site {
  position: number;
  sequence: string; // The full match including PAM
  strand: 'forward' | 'reverse';
}

export interface RepairResult {
  site: Cas9Site;
  cloningOligoA: string;
  cloningOligoB: string;
  repairTemplate: string; // The mutated homology arm
  repairTemplateRevComp: string; // For ordering
  originalRegion: string;
  homologyStart: number;
  mutationPosition: number; // Nucleotide index relative to start of gene
  aaChangeStatus: 'success' | 'warning';
  aaChangesCount: number;
  dnaAlignment: AlignmentData;
  aaAlignment: AlignmentData;
  strategy: 'PAM_DISRUPTED_BY_TARGET' | 'PAM_SILENT' | 'SEED_SILENT';
  silentMutationCount: number;
  score: number; // Efficiency Score (0-100)
}

export interface AlignmentData {
  original: string;
  modified: string;
  matchString: string; // String of '|' and ' '
}

export interface CodonTable {
  [key: string]: string[];
}
