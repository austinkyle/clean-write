import type { SentenceSpan, TextFinding } from '../types';
import { PASSIVE_ADJECTIVE_EXCEPTIONS, PARTICIPLE_EXCEPTIONS } from '../dictionaries/participles';

const AUXILIARIES = new Set(['am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'get', 'gets', 'got', 'getting']);
function isParticiple(word: string) { return PARTICIPLE_EXCEPTIONS.has(word) || /(?:ed|en|wn|nt|lt|pt|ought)$/u.test(word); }

export function detectPassiveVoice(sentences: SentenceSpan[]): TextFinding[] {
  return sentences.flatMap((sentence) => {
    const words = sentence.words;
    for (let index = 0; index < words.length - 1; index += 1) {
      const auxiliary = words[index].text.toLowerCase();
      if (!AUXILIARIES.has(auxiliary)) continue;
      let participleIndex = index + 1;
      if (/^(not|being)$/iu.test(words[participleIndex]?.text ?? '')) participleIndex += 1;
      const participle = words[participleIndex]?.text.toLowerCase() ?? '';
      if (!isParticiple(participle) || PASSIVE_ADJECTIVE_EXCEPTIONS.has(participle)) continue;
      const start = words[index].textStart;
      const end = words[participleIndex].textEnd;
      return [{ id: '', category: 'passive_voice', severity: 'warning', textStart: start, textEnd: end, excerpt: sentence.text.slice(start - sentence.textStart, end - sentence.textStart), message: 'Possible passive voice', explanation: 'This construction may hide who performed the action.', confidence: 'low', metadata: { auxiliary, participle } } satisfies TextFinding];
    }
    return [];
  });
}
