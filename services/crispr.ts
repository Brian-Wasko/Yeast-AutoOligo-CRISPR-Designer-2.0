
import { Cas9Site, RepairResult } from '../types';
import { CODON_TABLE, codonToAA, reverseComplement, translate, generateSimpleAlignment } from './utils';

const WINDOW = 105;

export function findCas9Sites(geneSequence: string, aminoAcidPosition: number): Cas9Site[] {
  const nucleotidePosition = (aminoAcidPosition - 1) * 3;
  const start = Math.max(0, nucleotidePosition - Math.floor(WINDOW / 2));
  const end = Math.min(geneSequence.length, nucleotidePosition + Math.floor(WINDOW / 2));
  const region = geneSequence.substring(start, end);

  const sites: Cas9Site[] = [];

  // Forward: N(20)NGG
  const forwardRegex = /(?=([ACGT]{20}[ACGT]GG))/gi;
  let match;
  while ((match = forwardRegex.exec(region)) !== null) {
    sites.push({
      position: start + match.index,
      sequence: match[1],
      strand: 'forward'
    });
    forwardRegex.lastIndex = match.index + 1;
  }

  // Reverse: CC N(20)
  const reverseRegex = /(?=(CC[ACGT][ACGT]{20}))/gi;
  while ((match = reverseRegex.exec(region)) !== null) {
    sites.push({
      position: start + match.index,
      sequence: match[1],
      strand: 'reverse'
    });
    reverseRegex.lastIndex = match.index + 1;
  }

  // Sort by distance to mutation site
  return sites.sort((a, b) => {
    return Math.abs(a.position - nucleotidePosition) - Math.abs(b.position - nucleotidePosition);
  });
}

/**
 * Calculates a heuristic CRISPR efficiency score (0-100) based on established rules
 * (e.g. Doench 2014, Wang 2014, Graf 2019).
 * Robust for client-side calculation without heavy ML models.
 * @param guideWithPam 23nt sequence (20nt Spacer + NGG)
 */
function calculateEfficiencyScore(guideWithPam: string): number {
  const spacer = guideWithPam.substring(0, 20).toUpperCase();
  const pam = guideWithPam.substring(20, 23).toUpperCase();
  
  let score = 50; // Base score

  // 1. GC Content (Ideal 40-60%)
  // Extreme GC content is poor for PCR/binding efficiency.
  const gcCount = spacer.split('').filter(c => c === 'G' || c === 'C').length;
  const gcContent = gcCount / 20;

  if (gcContent >= 0.4 && gcContent <= 0.6) {
      score += 20;
  } else if (gcContent >= 0.3 && gcContent <= 0.8) {
      score += 10;
  } else {
      score -= 20;
  }

  // 2. Position 20 (Nucleotide immediately 5' of PAM) - Critical for Cas9 loading
  // G is highly favored, T is disfavored.
  const pos20 = spacer[19];
  if (pos20 === 'G') score += 15;
  else if (pos20 === 'C') score += 5;
  else if (pos20 === 'T') score -= 10; 

  // 3. Poly-T (Pol III Terminator)
  // 4 consecutive Ts terminate transcription from U6 promoters (standard for pML104)
  if (spacer.includes('TTTT')) {
      score -= 50; 
  }
  
  // 4. PAM Sequence Context (NGG)
  // CGG and TGG are often slightly more efficient than AGG/GGG in yeast.
  if (pam === 'CGG' || pam === 'TGG') score += 5;
  else if (pam === 'GGG') score -= 5;

  // 5. Seed Region Stability (Nucleotides 10-20)
  // Avoid T-rich seed regions which can lower Tm too much.
  const seed = spacer.substring(10);
  if (seed.split('T').length - 1 >= 4) {
      score -= 10;
  }

  // Clamp 0-100
  return Math.max(0, Math.min(100, score));
}

interface MutationAttempt {
    sequence: string[];
    mutated: boolean;
    strategy: 'PAM_SILENT' | 'SEED_SILENT' | null;
    mutationCount: number;
}

function mutatePam(
  homologyList: string[],
  strand: 'forward' | 'reverse',
  pamStart: number,
  homologyStart: number
): MutationAttempt {
  const pamPosInHomology = pamStart - homologyStart;
  const listCopy = [...homologyList];

  // Define critical indices (The GG of NGG or CC of CCN)
  const criticalIndices = strand === 'forward'
    ? [pamPosInHomology + 21, pamPosInHomology + 22]
    : [pamPosInHomology, pamPosInHomology + 1];

  const codonStarts = new Set<number>();
  criticalIndices.forEach(idx => {
    if (idx >= 0 && idx < listCopy.length) {
      codonStarts.add(Math.floor(idx / 3) * 3);
    }
  });

  const sortedCodonStarts = Array.from(codonStarts).sort((a, b) => a - b);

  let bestResult: MutationAttempt = { sequence: [], mutated: false, strategy: null, mutationCount: 0 };
  let minChanges = Infinity;

  for (const codonStart of sortedCodonStarts) {
    if (codonStart + 3 > listCopy.length) continue;

    const currentCodon = listCopy.slice(codonStart, codonStart + 3).join('').toUpperCase();
    const currentAA = codonToAA(currentCodon);
    if (!currentAA || currentAA === '*') continue;

    const synonymousCodons = CODON_TABLE[currentAA] || [];

    for (const synonym of synonymousCodons) {
      if (synonym === currentCodon) continue;
      if (codonToAA(synonym) !== currentAA) continue;

      let disrupts = false;
      let tempChanges = 0;

      for (let i = 0; i < 3; i++) {
        const pos = codonStart + i;
        if (criticalIndices.includes(pos)) {
            if (synonym[i] !== currentCodon[i]) {
                disrupts = true;
            }
        }
        if (synonym[i] !== currentCodon[i]) tempChanges++;
      }

      if (disrupts) {
        if (tempChanges < minChanges) {
             minChanges = tempChanges;
             const newList = [...homologyList];
             for (let i = 0; i < 3; i++) newList[codonStart + i] = synonym[i];
             bestResult = { sequence: newList, mutated: true, strategy: 'PAM_SILENT', mutationCount: tempChanges };
        }
      }
    }
  }

  return bestResult;
}

function mutateSeed(
  homologyList: string[],
  strand: 'forward' | 'reverse',
  pamStart: number,
  homologyStart: number
): MutationAttempt {
    const pamPosInHomology = pamStart - homologyStart;
    const listCopy = [...homologyList];

    // Seed: 10nt proximal to PAM
    const seedIndices = new Set<number>();
    if (strand === 'forward') {
        for(let i=10; i<=19; i++) seedIndices.add(pamPosInHomology + i);
    } else {
        for(let i=3; i<=12; i++) seedIndices.add(pamPosInHomology + i);
    }

    const codonStarts = new Set<number>();
    seedIndices.forEach(idx => {
         if(idx >= 0 && idx < listCopy.length) {
            codonStarts.add(Math.floor(idx/3)*3);
        }
    });

    const sortedCodonStarts = Array.from(codonStarts).sort((a,b)=>a-b);
    let totalMutations = 0;

    for (const codonStart of sortedCodonStarts) {
         if (codonStart + 3 > listCopy.length) continue;
         
         const currentCodon = listCopy.slice(codonStart, codonStart+3).join('').toUpperCase();
         const currentAA = codonToAA(currentCodon);
         if (!currentAA || currentAA === '*') continue;
         
         const synonyms = CODON_TABLE[currentAA] || [];
         
         let bestSynonym = null;
         let maxNewSeedChanges = 0;
         let bestTotalChanges = 0; 

         for (const synonym of synonyms) {
             if (synonym === currentCodon) continue;
             if (codonToAA(synonym) !== currentAA) continue;

             let seedChanges = 0;
             let totalChanges = 0;
             for(let i=0; i<3; i++) {
                 if (synonym[i] !== currentCodon[i]) {
                     totalChanges++;
                     if (seedIndices.has(codonStart + i)) {
                         seedChanges++;
                     }
                 }
             }
             
             if (seedChanges > maxNewSeedChanges) {
                 maxNewSeedChanges = seedChanges;
                 bestTotalChanges = totalChanges;
                 bestSynonym = synonym;
             }
         }
         
         if (bestSynonym && maxNewSeedChanges > 0) {
             for(let i=0; i<3; i++) listCopy[codonStart+i] = bestSynonym[i];
             totalMutations += bestTotalChanges; 
         }
         
         if (totalMutations >= 2) break; 
    }

    if (totalMutations >= 2) {
        return { sequence: listCopy, mutated: true, strategy: 'SEED_SILENT', mutationCount: totalMutations };
    }

    return { sequence: [], mutated: false, strategy: null, mutationCount: 0 };
}

export function generateRepairTemplates(
  geneSequence: string,
  cas9Sites: Cas9Site[],
  aminoAcidPosition: number,
  newAminoAcid: string
): RepairResult[] {
  const results: RepairResult[] = [];
  const mutationPosition = (aminoAcidPosition - 1) * 3;

  for (const site of cas9Sites) {
    const cas9CutPosition = site.position + 17;
    const pamStart = site.position;

    const minFlankingLength = 30;
    const homologyStart = Math.max(0, Math.min(cas9CutPosition, mutationPosition) - minFlankingLength);
    const homologyEnd = Math.min(geneSequence.length, Math.max(cas9CutPosition, mutationPosition) + minFlankingLength);

    const originalHomologyRegion = geneSequence.substring(homologyStart, homologyEnd);
    const homologyList = originalHomologyRegion.split('');

    // 1. Apply Desired Mutation
    const codonStartInHomology = mutationPosition - homologyStart;
    if (codonStartInHomology >= 0 && codonStartInHomology < homologyList.length) {
      const originalCodon = homologyList.slice(codonStartInHomology, codonStartInHomology + 3).join('').toUpperCase();
      const newCodonOptions = CODON_TABLE[newAminoAcid.toUpperCase()];

      if (!newCodonOptions || newCodonOptions.length === 0) continue; 

      let newCodon = newCodonOptions[0];
      for (const opt of newCodonOptions) {
        if (opt !== originalCodon) {
          newCodon = opt;
          break;
        }
      }

      for (let i = 0; i < 3; i++) {
        homologyList[codonStartInHomology + i] = newCodon[i];
      }
    }

    let finalHomologyList = [...homologyList];
    let strategy: RepairResult['strategy'] | null = null;
    let silentMutationCount = 0;

    // 2. Check if Target Mutation disrupted PAM already
    const pamPosInHomology = pamStart - homologyStart;
    const criticalIndices = site.strand === 'forward'
        ? [pamPosInHomology + 21, pamPosInHomology + 22]
        : [pamPosInHomology, pamPosInHomology + 1];
    
    let pamAlreadyDisrupted = false;
    for(const idx of criticalIndices) {
        if (idx >= 0 && idx < homologyList.length) {
            if (homologyList[idx].toUpperCase() !== originalHomologyRegion[idx].toUpperCase()) {
                pamAlreadyDisrupted = true;
                break;
            }
        }
    }

    if (pamAlreadyDisrupted) {
        strategy = 'PAM_DISRUPTED_BY_TARGET';
        silentMutationCount = 0;
    } else {
        const pamAttempt = mutatePam(homologyList, site.strand, pamStart, homologyStart);
        if (pamAttempt.mutated && pamAttempt.strategy) {
            finalHomologyList = pamAttempt.sequence;
            strategy = pamAttempt.strategy;
            silentMutationCount = pamAttempt.mutationCount;
        } else {
            const seedAttempt = mutateSeed(homologyList, site.strand, pamStart, homologyStart);
            if (seedAttempt.mutated && seedAttempt.strategy) {
                finalHomologyList = seedAttempt.sequence;
                strategy = seedAttempt.strategy;
                silentMutationCount = seedAttempt.mutationCount;
            }
        }
    }

    if (!strategy) continue; 

    // 5. Format Case
    const finalCasedList: string[] = [];
    for (let i = 0; i < finalHomologyList.length; i++) {
      const finalChar = finalHomologyList[i];
      const originalChar = originalHomologyRegion[i];
      if (finalChar.toUpperCase() !== originalChar.toUpperCase()) {
        finalCasedList.push(finalChar.toLowerCase());
      } else {
        finalCasedList.push(finalChar.toUpperCase());
      }
    }
    const mutatedHomology = finalCasedList.join('');
    const revComp = reverseComplement(mutatedHomology);

    // 6. Generate Oligos
    const sgRNASeqWithPam = site.strand === 'reverse'
      ? reverseComplement(site.sequence)
      : site.sequence;
    
    // Calculate Score based on the canonical guide sequence
    const efficiencyScore = calculateEfficiencyScore(sgRNASeqWithPam);

    const guideSeq20nt = sgRNASeqWithPam.substring(0, 20).toUpperCase(); 
    
    const cloningOligoA = `gatc${guideSeq20nt}gttttagagctag`;
    const cloningOligoB = `ctagctctaaaac${reverseComplement(guideSeq20nt).toUpperCase()}`;

    // 7. Verification
    const contextFlank = 150;
    const alignStart = Math.max(0, mutationPosition - contextFlank);
    const alignEnd = Math.min(geneSequence.length, mutationPosition + 3 + contextFlank);
    const originalLargeDna = geneSequence.substring(alignStart, alignEnd);
    const repairedLargeList = originalLargeDna.split('');
    const tempStartInLarge = homologyStart - alignStart;

    for (let i = 0; i < mutatedHomology.length; i++) {
        if (tempStartInLarge + i >= 0 && tempStartInLarge + i < repairedLargeList.length) {
            repairedLargeList[tempStartInLarge + i] = mutatedHomology[i];
        }
    }
    const repairedLargeDna = repairedLargeList.join('');
    const frame = alignStart % 3;
    const originalLargeAA = translate(originalLargeDna.substring(frame));
    const repairedLargeAA = translate(repairedLargeDna.substring(frame));

    let aaDiffCount = 0;
    const len = Math.min(originalLargeAA.length, repairedLargeAA.length);
    for(let k=0; k<len; k++) {
        if (originalLargeAA[k] !== repairedLargeAA[k]) aaDiffCount++;
    }

    if (aaDiffCount !== 1) continue;

    results.push({
      site,
      cloningOligoA,
      cloningOligoB,
      repairTemplate: mutatedHomology,
      repairTemplateRevComp: revComp,
      originalRegion: originalHomologyRegion,
      homologyStart,
      mutationPosition,
      aaChangeStatus: 'success',
      aaChangesCount: aaDiffCount,
      dnaAlignment: {
          original: originalHomologyRegion.toUpperCase(),
          modified: mutatedHomology.toUpperCase(),
          matchString: generateSimpleAlignment(originalHomologyRegion.toUpperCase(), mutatedHomology.toUpperCase())
      },
      aaAlignment: {
          original: originalLargeAA,
          modified: repairedLargeAA,
          matchString: generateSimpleAlignment(originalLargeAA, repairedLargeAA)
      },
      strategy: strategy,
      silentMutationCount: silentMutationCount,
      score: efficiencyScore
    });
  }

  return results.slice(0, 5);
}
