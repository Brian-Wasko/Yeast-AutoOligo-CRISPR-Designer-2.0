import React, { useState } from 'react';

interface InputFormProps {
  isLoading: boolean;
  onSubmit: (gene: string, residue: number, mutation: string, oligoLength: number) => void;
}

export const InputForm: React.FC<InputFormProps> = ({ isLoading, onSubmit }) => {
  const [gene, setGene] = useState('PHO13');
  const [residue, setResidue] = useState<string>('123');
  const [mutation, setMutation] = useState('R');
  const [oligoLength, setOligoLength] = useState<number>(75);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(gene, parseInt(residue), mutation, oligoLength);
  };

  // bg-slate-800 text-white ensures high contrast white text on dark background
  const inputClasses = "w-full px-4 py-2 bg-slate-800 text-white border border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-colors placeholder-slate-400";

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
      <h2 className="text-xl font-semibold text-slate-800 mb-4">Target Parameters</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Yeast Gene Name</label>
          <input
            type="text"
            value={gene}
            onChange={(e) => setGene(e.target.value)}
            className={inputClasses}
            placeholder="e.g., PHO13"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Residue Number</label>
          <input
            type="number"
            value={residue}
            onChange={(e) => setResidue(e.target.value)}
            className={inputClasses}
            placeholder="e.g., 123"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Desired Mutation (One Letter Code)</label>
          <input
            type="text"
            value={mutation}
            onChange={(e) => setMutation(e.target.value.toUpperCase())}
            maxLength={1}
            className={inputClasses}
            placeholder="e.g., R"
            required
          />
        </div>

        <div>
           <div className="flex justify-between mb-1">
              <label className="block text-sm font-medium text-slate-700">Repair Oligo Length</label>
              <span className="text-sm font-medium text-indigo-600 font-mono">{oligoLength} nt</span>
           </div>
           <input
             type="range"
             min="60"
             max="100"
             step="1"
             value={oligoLength}
             onChange={(e) => setOligoLength(parseInt(e.target.value))}
             className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
           />
           <div className="flex justify-between text-xs text-slate-400 mt-1">
             <span>60 nt</span>
             <span>100 nt</span>
           </div>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className={`w-full py-3 px-4 rounded-lg text-white font-medium shadow-md transition-all ${
            isLoading
              ? 'bg-indigo-400 cursor-not-allowed'
              : 'bg-indigo-600 hover:bg-indigo-700 active:scale-95'
          }`}
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Processing...
            </span>
          ) : (
            'Generate Designs'
          )}
        </button>
      </form>
    </div>
  );
};