class TimePublisher {
  private listeners = new Set<(timeUs: number) => void>();
  private timeUs = 0;

  setTime(timeUs: number) {
    this.timeUs = timeUs;
    this.listeners.forEach(l => l(timeUs));
  }

  getTime() {
    return this.timeUs;
  }

  subscribe(listener: (timeUs: number) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const timePublisher = new TimePublisher();
