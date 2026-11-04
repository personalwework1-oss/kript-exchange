/**
 * Query-string builder. React Native's URLSearchParams is incomplete on some
 * versions (set/get may throw "not implemented"), so we build it by hand.
 */
export class Query {
  private parts: Array<[string, string]> = [];
  constructor(init: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(init)) this.set(k, v);
  }
  set(k: string, v: string): this {
    this.parts = this.parts.filter(([x]) => x !== k);
    this.parts.push([k, v]);
    return this;
  }
  toString(): string {
    return this.parts.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  }
}
