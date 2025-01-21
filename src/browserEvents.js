export class EventEmitter {
  constructor() {
    this._events = new Map();
  }

  on(eventName, listener) {
    if (!this._events.has(eventName)) {
      this._events.set(eventName, new Set());
    }
    this._events.get(eventName).add(listener);
    return this;
  }

  off(eventName, listener) {
    if (!this._events.has(eventName)) {
      return this;
    }
    if (!listener) {
      this._events.delete(eventName);
    } else {
      this._events.get(eventName).delete(listener);
    }
    return this;
  }

  emit(eventName, ...args) {
    if (!this._events.has(eventName)) {
      return false;
    }
    this._events.get(eventName).forEach((listener) => {
      try {
        listener.apply(this, args);
      } catch (err) {
        console.error(`Error in event listener for ${eventName}:`, err);
      }
    });
    return true;
  }

  removeAllListeners() {
    this._events.clear();
    return this;
  }
}
