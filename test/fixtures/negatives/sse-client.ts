// A generic Server-Sent-Events client for a stock ticker. It legitimately uses
// the Last-Event-ID header and resumability — the scanner must NOT flag any of
// it, because nothing in this file relates to the protocol this tool vets.
// (Deliberately: this file never names that protocol — the resumability rule
// is gated on that file-level context.)

export class TickerStream {
  private lastEventId: string | undefined;

  connect(url: string) {
    const headers: Record<string, string> = {};
    if (this.lastEventId) headers['Last-Event-ID'] = this.lastEventId;
    return fetch(url, { headers });
  }

  onEvent(id: string, data: string) {
    this.lastEventId = id;
    return JSON.parse(data);
  }
}

export const eventStore = new Map<string, string[]>(); // plain event-sourcing store
export function resumptionToken(): string | undefined {
  return undefined;
}
