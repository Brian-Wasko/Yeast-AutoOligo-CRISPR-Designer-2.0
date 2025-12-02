import { CodonTable } from '../types';

export const CODON_TABLE: CodonTable = {
  'F': ['TTT', 'TTC'], 'L': ['TTA', 'TTG', 'CTT', 'CTC', 'CTA', 'CTG'],
  'I': ['ATT', 'ATC', 'ATA'], 'M': ['ATG'], 'V': ['GTT', 'GTC', 'GTA', 'GTG'],
  'S': ['TCT', 'TCC', 'TCA', 'TCG', 'AGT', 'AGC'], 'P': ['CCT', 'CCC', 'CCA', 'CCG'],
  'T': ['ACT', 'ACC', 'ACA', 'ACG'], 'A': ['GCT', 'GCC', 'GCA', 'GCG'],
  'Y': ['TAT', 'TAC'], 'H': ['CAT', 'CAC'], 'Q': ['CAA', 'CAG'],
  'N': ['AAT', 'AAC'], 'K': ['AAA', 'AAG'], 'D': ['GAT', 'GAC'],
  'E': ['GAA', 'GAG'], 'C': ['TGT', 'TGC'], 'W': ['TGG'],
  'R': ['CGT', 'CGC', 'CGA', 'CGG', 'AGA', 'AGG'], 'G': ['GGT', 'GGC', 'GGA', 'GGG'],
  '*': ['TAA', 'TAG', 'TGA'],
};

// Invert the map for codon -> AA lookup
export const AA_LOOKUP: { [codon: string]: string } = {};
Object.entries(CODON_TABLE).forEach(([aa, codons]) => {
  codons.forEach(codon => {
    AA_LOOKUP[codon] = aa;
  });
});

export function reverseComplement(seq: string): string {
  const complement: { [key: string]: string } = {
    'A': 'T', 'T': 'A', 'C': 'G', 'G': 'C',
    'a': 't', 't': 'a', 'c': 'g', 'g': 'c',
    'N': 'N', 'n': 'n', '-': '-'
  };
  return seq.split('').reverse().map(base => complement[base] || base).join('');
}

export function translate(seq: string): string {
  let protein = "";
  const cleanSeq = seq.toUpperCase();
  for (let i = 0; i < cleanSeq.length; i += 3) {
    if (i + 3 > cleanSeq.length) break;
    const codon = cleanSeq.substring(i, i + 3);
    protein += AA_LOOKUP[codon] || "X";
  }
  return protein;
}

export function codonToAA(codon: string): string | null {
  return AA_LOOKUP[codon.toUpperCase()] || null;
}

// A simple global alignment for display purposes (Hamming distance style with gap preservation)
// Since we are doing point mutations, the lengths are usually preserved or very close.
// This matches the Python script's logic which does a visual overlay.
export function generateSimpleAlignment(seq1: string, seq2: string): string {
  let match = "";
  const len = Math.max(seq1.length, seq2.length);
  for (let i = 0; i < len; i++) {
    const c1 = seq1[i] || '-';
    const c2 = seq2[i] || '-';
    if (c1 === c2 && c1 !== '-' && c2 !== '-') {
      match += "|";
    } else {
      match += " ";
    }
  }
  return match;
}

export function addCodonSpacing(seq: string, frame: number): string {
  let spaced = "";
  let nucCount = 0;
  for (let i = 0; i < seq.length; i++) {
    const char = seq[i];
    spaced += char;
    if (char !== '-') {
      nucCount++;
      // If we completed a codon based on frame
      if ((nucCount + frame) % 3 === 0) {
        spaced += " ";
      }
    }
  }
  return spaced.trimEnd();
}
