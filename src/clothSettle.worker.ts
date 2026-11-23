import { solveCloth, type ClothInput } from './clothSettle';

self.onmessage = (event: MessageEvent<ClothInput>) => {
  try { self.postMessage(solveCloth(event.data)); }
  catch(e) { self.postMessage({error:e instanceof Error ? e.message : String(e)}); }
};
